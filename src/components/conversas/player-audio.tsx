// Player de áudio das conversas (iPhone e Android, enviados e recebidos). Toca sempre por <audio>,
// que sai som mesmo com o iPhone no silencioso (a Web Audio API, usada antes, ficava muda nesse
// modo). Chrome e Android tocam o OGG/Opus direto; o Safari não toca OGG, então o arquivo é
// decodificado no aparelho (ogg-opus-decoder, WebAssembly) e vira WAV. m4a e mp3 vão direto.
// Mostra "Carregando…", e depois de 15 s sem tocar (ou num erro) mostra a falha com
// "Tentar de novo". Barra de progresso, tempo e velocidade 1×/1,5×/2×.
import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { registrarTemposAudio, type TemposAudio } from "@/lib/anexos";
import { prepararAudio, urlSilencio } from "@/lib/audio-reproducao";

const VELOCIDADES = [1, 1.5, 2] as const;
const LIMITE_MS = 15_000;

type Fonte = Blob | (() => Promise<Blob>);

function mmss(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function comLimite<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, falha) => {
    const t = setTimeout(() => falha(new Error("tempo esgotado")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        ok(v);
      },
      (e) => {
        clearTimeout(t);
        falha(e);
      },
    );
  });
}

/**
 * Põe o arquivo no <audio> e começa a tocar. O play() já carrega o arquivo (o iPhone ignora o
 * pré-carregamento) e falha se o navegador não souber tocar o formato.
 */
async function iniciar(audio: HTMLAudioElement, url: string, taxa: number): Promise<void> {
  audio.src = url;
  audio.playbackRate = taxa;
  await audio.play();
  audio.playbackRate = taxa;
}

export function PlayerAudio({
  fonte,
  aoTentarDeNovo,
  className,
}: {
  fonte: Fonte;
  /** "Tentar de novo": esquece o arquivo guardado antes de baixar outra vez. */
  aoTentarDeNovo?: () => void;
  className?: string;
}) {
  const [estado, setEstado] = useState<"parado" | "carregando" | "tocando" | "pausado" | "erro">(
    "parado",
  );
  const [erro, setErro] = useState("");
  const [posicao, setPosicao] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [velocidade, setVelocidade] = useState<(typeof VELOCIDADES)[number]>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const prontoRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  /** Cada toque em "tocar" é uma tentativa; a que passou dos 15 s não pode começar a tocar depois. */
  const tentativaRef = useRef(0);
  const velRef = useRef(velocidade);
  velRef.current = velocidade;

  function liberarUrl() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }

  function pararAcompanhar() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function acompanhar() {
    const a = audioRef.current;
    if (a) setPosicao(a.currentTime);
    rafRef.current = requestAnimationFrame(acompanhar);
  }

  useEffect(
    () => () => {
      pararAcompanhar();
      audioRef.current?.pause();
      liberarUrl();
    },
    [],
  );

  function audio(): HTMLAudioElement {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      a.addEventListener("ended", () => {
        if (!prontoRef.current) return; // fim do trecho mudo que libera o iPhone
        pararAcompanhar();
        a.currentTime = 0;
        setPosicao(0);
        setEstado("parado");
      });
      a.addEventListener("durationchange", () => {
        if (Number.isFinite(a.duration) && prontoRef.current) setDuracao(a.duration);
      });
      audioRef.current = a;
    }
    return audioRef.current;
  }

  async function preparar(a: HTMLAudioElement) {
    const t0 = performance.now();
    const tentativa = ++tentativaRef.current;
    const valendo = () => {
      if (tentativaRef.current !== tentativa) throw new Error("cancelado");
    };
    const tempos: TemposAudio = {
      baixarMs: 0,
      prepararMs: 0,
      iniciarMs: 0,
      via: "nenhum",
      resultado: "ok",
    };
    try {
      await comLimite(
        (async () => {
          const blob = typeof fonte === "function" ? await fonte() : fonte;
          valendo();
          const t1 = performance.now();
          tempos.baixarMs = Math.round(t1 - t0);
          let pronto = await prepararAudio(blob, false);
          valendo();
          let t2 = performance.now();
          try {
            await iniciar(a, pronto.url, velRef.current);
          } catch (e) {
            // O navegador disse que tocava OGG, mas não tocou: decodifica e tenta como WAV.
            if (pronto.via !== "nativo") throw e;
            URL.revokeObjectURL(pronto.url);
            pronto = await prepararAudio(blob, true);
            valendo();
            t2 = performance.now();
            await iniciar(a, pronto.url, velRef.current);
          }
          urlRef.current = pronto.url;
          tempos.via = pronto.via;
          tempos.prepararMs = Math.round(t2 - t1);
          tempos.iniciarMs = Math.round(performance.now() - t2);
        })(),
        LIMITE_MS,
      );
      prontoRef.current = true;
      if (Number.isFinite(a.duration)) setDuracao(a.duration);
    } catch (e) {
      tentativaRef.current++; // o que ainda estiver carregando não toca mais
      tempos.resultado = e instanceof Error && e.message === "tempo esgotado" ? "tempo" : "erro";
      throw e;
    } finally {
      registrarTemposAudio(tempos);
    }
  }

  async function tocar() {
    const a = audio();
    if (prontoRef.current) {
      a.playbackRate = velRef.current;
      try {
        await a.play();
      } catch (e) {
        console.error("Player: não retomou", e instanceof Error ? e.message : e);
        setErro("Não foi possível tocar este áudio.");
        setEstado("erro");
        return;
      }
      setEstado("tocando");
      rafRef.current = requestAnimationFrame(acompanhar);
      return;
    }
    setEstado("carregando");
    setErro("");
    // Ainda dentro do toque: o iPhone só deixa o <audio> tocar depois do download se ele já
    // tocou algo no próprio toque. Toca um trecho mudo e segue.
    a.src = urlSilencio();
    void a.play().catch(() => undefined);
    try {
      await preparar(a);
      setEstado("tocando");
      rafRef.current = requestAnimationFrame(acompanhar);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Player: não tocou", msg);
      a.pause();
      liberarUrl();
      setErro(
        msg === "tempo esgotado"
          ? "Demorou demais para carregar."
          : "Não foi possível tocar este áudio.",
      );
      setEstado("erro");
    }
  }

  function tentarDeNovo() {
    aoTentarDeNovo?.();
    prontoRef.current = false;
    void tocar();
  }

  function pausar() {
    const a = audioRef.current;
    pararAcompanhar();
    a?.pause();
    if (a) setPosicao(a.currentTime);
    setEstado("pausado");
  }

  function irPara(segundos: number) {
    const a = audioRef.current;
    if (!a || !prontoRef.current) return;
    a.currentTime = segundos;
    setPosicao(segundos);
  }

  function mudarVelocidade() {
    const i = VELOCIDADES.indexOf(velocidade);
    const nova = VELOCIDADES[(i + 1) % VELOCIDADES.length]!;
    setVelocidade(nova);
    velRef.current = nova;
    if (audioRef.current && prontoRef.current) audioRef.current.playbackRate = nova;
  }

  const tocando = estado === "tocando";
  const carregando = estado === "carregando";
  const total = duracao || 0;
  return (
    <div className={cn("flex w-full min-w-0 max-w-[320px] flex-col gap-1", className)}>
      <div className="flex w-full min-w-0 items-center gap-2 text-foreground">
        <button
          type="button"
          aria-label={tocando ? "Pausar" : carregando ? "Carregando" : "Tocar"}
          disabled={carregando}
          onClick={() => (tocando ? pausar() : estado === "erro" ? tentarDeNovo() : void tocar())}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-marca text-marca-foreground disabled:opacity-60"
        >
          {carregando ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : tocando ? (
            <Pause className="size-5" aria-hidden />
          ) : (
            <Play className="ml-0.5 size-5" aria-hidden />
          )}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <input
            type="range"
            aria-label="Posição"
            min={0}
            max={total || 1}
            step={0.1}
            value={Math.min(posicao, total || 1)}
            disabled={!total}
            onChange={(ev) => irPara(Number(ev.target.value))}
            className="h-11 w-full accent-marca"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {carregando ? "Carregando…" : `${mmss(posicao)}${total ? ` / ${mmss(total)}` : ""}`}
            </span>
            <button
              type="button"
              onClick={mudarVelocidade}
              aria-label={`Velocidade ${velocidade}×`}
              className="min-h-8 rounded-full border border-border px-2 text-[11px] font-semibold tabular-nums"
            >
              {velocidade.toLocaleString("pt-BR")}×
            </button>
          </div>
        </div>
      </div>
      {estado === "erro" ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-problema-foreground">
          <span>{erro}</span>
          <button
            type="button"
            onClick={tentarDeNovo}
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 font-semibold text-foreground"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Tentar de novo
          </button>
        </div>
      ) : null}
    </div>
  );
}
