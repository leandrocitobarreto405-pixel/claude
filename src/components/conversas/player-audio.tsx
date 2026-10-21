// Player de áudio das conversas (iPhone e Android, enviados e recebidos). O Safari não toca
// OGG/Opus direto, então o arquivo é decodificado no navegador (ogg-opus-decoder, WebAssembly)
// e tocado pela Web Audio API; outros formatos (m4a gravado no iPhone, mp3) usam o decodificador
// nativo. Barra de progresso, tempo e velocidade 1×/1,5×/2×.
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const VELOCIDADES = [1, 1.5, 2] as const;

type Fonte = Blob | (() => Promise<Blob>);

type DecodificadorOgg = {
  OggOpusDecoder: new () => {
    ready: Promise<void>;
    decodeFile: (
      dados: Uint8Array,
    ) => Promise<{ channelData: Float32Array[]; samplesDecoded: number; sampleRate: number }>;
    free: () => void;
  };
};

let decodificador: Promise<DecodificadorOgg> | null = null;

/**
 * ogg-opus-decoder (WebAssembly) servido de /ogg-opus-decoder/ como script comum: importado
 * como módulo, o empacotador do servidor travava; e ele só é preciso no navegador, ao tocar.
 */
function carregarDecodificador(): Promise<DecodificadorOgg> {
  if (!decodificador) {
    decodificador = new Promise<DecodificadorOgg>((ok, falha) => {
      const chave = "ogg-opus-decoder" as const;
      const w = window as unknown as Record<string, DecodificadorOgg | undefined>;
      if (w[chave]) return ok(w[chave]!);
      const script = document.createElement("script");
      script.src = "/ogg-opus-decoder/ogg-opus-decoder.min.js";
      script.async = true;
      script.onload = () => (w[chave] ? ok(w[chave]!) : falha(new Error("decodificador vazio")));
      script.onerror = () => falha(new Error("decodificador não carregou"));
      document.head.appendChild(script);
    });
    decodificador.catch(() => (decodificador = null));
  }
  return decodificador;
}

async function decodificar(ctx: AudioContext, blob: Blob): Promise<AudioBuffer> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ogg = bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "OggS";
  if (ogg) {
    const { OggOpusDecoder } = await carregarDecodificador();
    const dec = new OggOpusDecoder();
    await dec.ready;
    try {
      const { channelData, samplesDecoded, sampleRate } = await dec.decodeFile(bytes);
      if (!samplesDecoded || !channelData.length) throw new Error("áudio vazio");
      const buf = ctx.createBuffer(channelData.length, samplesDecoded, sampleRate);
      channelData.forEach((canal, i) =>
        buf.copyToChannel(canal as unknown as Float32Array<ArrayBuffer>, i),
      );
      return buf;
    } finally {
      dec.free();
    }
  }
  return ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

function mmss(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function PlayerAudio({
  fonte,
  className,
  escuro = false,
}: {
  fonte: Fonte;
  className?: string;
  /** Balão escuro (mensagem do cliente): cores invertidas. */
  escuro?: boolean;
}) {
  const [estado, setEstado] = useState<"parado" | "carregando" | "tocando" | "pausado" | "erro">(
    "parado",
  );
  const [posicao, setPosicao] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [velocidade, setVelocidade] = useState<(typeof VELOCIDADES)[number]>(1);
  const ctxRef = useRef<AudioContext | null>(null);
  const bufRef = useRef<AudioBuffer | null>(null);
  const fonteRef = useRef<AudioBufferSourceNode | null>(null);
  const inicioRef = useRef({ quando: 0, deslocamento: 0, taxa: 1 });
  const rafRef = useRef<number | null>(null);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const velRef = useRef(velocidade);
  velRef.current = velocidade;

  function pararFonte() {
    if (fonteRef.current) {
      fonteRef.current.onended = null;
      try {
        fonteRef.current.stop();
      } catch {
        /* já parada */
      }
      fonteRef.current.disconnect();
      fonteRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  useEffect(
    () => () => {
      pararFonte();
      void ctxRef.current?.close();
    },
    [],
  );

  function posicaoAtual(): number {
    const ctx = ctxRef.current;
    const { quando, deslocamento, taxa } = inicioRef.current;
    if (!ctx || estadoRef.current !== "tocando") return deslocamento;
    return Math.min(
      deslocamento + (ctx.currentTime - quando) * taxa,
      bufRef.current?.duration ?? 0,
    );
  }

  function acompanhar() {
    setPosicao(posicaoAtual());
    rafRef.current = requestAnimationFrame(acompanhar);
  }

  function tocarDe(deslocamento: number) {
    const ctx = ctxRef.current;
    const buf = bufRef.current;
    if (!ctx || !buf) return;
    pararFonte();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = velRef.current;
    src.connect(ctx.destination);
    src.onended = () => {
      if (fonteRef.current !== src) return;
      pararFonte();
      inicioRef.current = { quando: 0, deslocamento: 0, taxa: velRef.current };
      setPosicao(0);
      setEstado("parado");
    };
    src.start(0, Math.min(deslocamento, Math.max(0, buf.duration - 0.05)));
    fonteRef.current = src;
    inicioRef.current = { quando: ctx.currentTime, deslocamento, taxa: velRef.current };
    setEstado("tocando");
    rafRef.current = requestAnimationFrame(acompanhar);
  }

  async function tocar() {
    try {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctxRef.current = new Ctx();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      if (!bufRef.current) {
        setEstado("carregando");
        const blob = typeof fonte === "function" ? await fonte() : fonte;
        bufRef.current = await decodificar(ctx, blob);
        setDuracao(bufRef.current.duration);
      }
      tocarDe(inicioRef.current.deslocamento);
    } catch (e) {
      console.error("Player: não tocou", e instanceof Error ? e.message : e);
      setEstado("erro");
    }
  }

  function pausar() {
    const pos = posicaoAtual();
    pararFonte();
    inicioRef.current = { quando: 0, deslocamento: pos, taxa: velRef.current };
    setPosicao(pos);
    setEstado("pausado");
  }

  function irPara(segundos: number) {
    const tocando = estadoRef.current === "tocando";
    pararFonte();
    inicioRef.current = { quando: 0, deslocamento: segundos, taxa: velRef.current };
    setPosicao(segundos);
    if (tocando) tocarDe(segundos);
    else if (bufRef.current) setEstado("pausado");
  }

  function mudarVelocidade() {
    const i = VELOCIDADES.indexOf(velocidade);
    const nova = VELOCIDADES[(i + 1) % VELOCIDADES.length]!;
    const pos = posicaoAtual();
    setVelocidade(nova);
    velRef.current = nova;
    if (estadoRef.current === "tocando") {
      // Recomeça do mesmo ponto com a nova taxa (mantém a conta do tempo certa).
      pararFonte();
      inicioRef.current = { quando: 0, deslocamento: pos, taxa: nova };
      tocarDe(pos);
    }
  }

  const tocando = estado === "tocando";
  const total = duracao || 0;
  const cor = escuro ? "text-foreground" : "text-foreground";
  return (
    <div
      className={cn("flex w-full min-w-[220px] max-w-[320px] items-center gap-2", cor, className)}
    >
      <button
        type="button"
        aria-label={tocando ? "Pausar" : "Tocar"}
        disabled={estado === "carregando"}
        onClick={() => (tocando ? pausar() : void tocar())}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-marca text-marca-foreground disabled:opacity-60"
      >
        {estado === "carregando" ? (
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
            {mmss(posicao)}
            {total ? ` / ${mmss(total)}` : ""}
          </span>
          {estado === "erro" ? (
            <span className="text-problema-foreground">Não deu para tocar</span>
          ) : (
            <button
              type="button"
              onClick={mudarVelocidade}
              aria-label={`Velocidade ${velocidade}×`}
              className="min-h-8 rounded-full border border-border px-2 text-[11px] font-semibold tabular-nums"
            >
              {velocidade.toLocaleString("pt-BR")}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
