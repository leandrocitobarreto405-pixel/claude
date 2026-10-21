// Gravador de áudio da barra de resposta: toque para gravar, toque para parar. Grava já em
// OGG/Opus 40 kbit/s no navegador (opus-recorder, WebAssembly, o mesmo gravador do Chatwoot) e
// o arquivo sobe pronto, sem ffmpeg. Se o navegador não suportar, grava no que ele permite
// (WebM/Opus ou MP4/AAC) e o servidor converte.
import { useEffect, useRef, useState } from "react";
import type Recorder from "opus-recorder";
import { Mic, Square, X } from "lucide-react";
import { Botao } from "@/components/nexa";

const MAX_SEGUNDOS = 120;

/** Formato que o navegador consegue gravar (o servidor converte qualquer um). */
function formatoDeGravacao(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

export function GravadorAudio({
  desabilitado,
  aoGravar,
  aoMudarGravacao,
}: {
  desabilitado: boolean;
  /** Recebe o arquivo gravado (já parado). */
  aoGravar: (arquivo: File) => void;
  /** Avisa quando começa e termina de gravar (a barra de navegação some enquanto grava). */
  aoMudarGravacao?: (gravando: boolean) => void;
}) {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const cancelado = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function limpar() {
    if (timer.current) clearInterval(timer.current);
    if (opus.current) {
      try {
        opus.current.close();
      } catch {
        /* já fechado */
      }
      opus.current = null;
    }
    timer.current = null;
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setGravando(false);
    setSegundos(0);
  }
  useEffect(() => () => limpar(), []);
  useEffect(() => {
    aoMudarGravacao?.(gravando);
  }, [gravando, aoMudarGravacao]);

  const opus = useRef<Recorder | null>(null);
  // Trava contra início duplo (dois toques, evento repetido): em 21/10 dois gravadores Opus
  // rodaram ao mesmo tempo e o arquivo saiu com as páginas dos dois intercaladas.
  const iniciando = useRef(false);

  function contar(aoEstourar: () => void) {
    if (timer.current) clearInterval(timer.current);
    setGravando(true);
    setSegundos(0);
    timer.current = setInterval(() => {
      setSegundos((s) => {
        if (s + 1 >= MAX_SEGUNDOS) aoEstourar();
        return s + 1;
      });
    }, 1000);
  }

  /** OGG/Opus direto no navegador: mono 48 kHz, 40 kbit/s, quadros de 60 ms, páginas de 3 s. */
  async function comecarOpus(): Promise<boolean> {
    let r: Recorder | null = null;
    try {
      const { default: Recorder } = await import("opus-recorder");
      if (!Recorder.isRecordingSupported()) return false;
      // Páginas deste gravador (array próprio: nunca se mistura com outro).
      const partes: Uint8Array[] = [];
      r = new Recorder({
        encoderPath: "/opus-recorder/encoderWorker.min.js",
        encoderSampleRate: 48000,
        encoderBitRate: 40000,
        encoderApplication: 2048,
        encoderFrameSize: 60,
        maxFramesPerPage: 50,
        numberOfChannels: 1,
        streamPages: true,
      });
      const gravador = r;
      cancelado.current = false;
      gravador.ondataavailable = (pagina) => {
        if (pagina.length) partes.push(new Uint8Array(pagina));
      };
      gravador.onstop = () => {
        const blob = new Blob(partes as BlobPart[], { type: "audio/ogg" });
        const foiCancelado = cancelado.current;
        if (!foiCancelado && blob.size >= 1000)
          aoGravar(new File([blob], "gravacao.ogg", { type: "audio/ogg" }));
        gravador.close();
        if (opus.current === gravador) opus.current = null;
        limpar();
      };
      opus.current = gravador;
      await gravador.start();
      contar(() => void gravador.stop());
      return true;
    } catch (e) {
      console.warn("Gravador Opus indisponível; usando o do navegador", e);
      try {
        r?.close();
      } catch {
        /* já fechado */
      }
      if (opus.current === r) opus.current = null;
      return false;
    }
  }

  async function comecar() {
    if (iniciando.current || opus.current || rec.current) return;
    iniciando.current = true;
    try {
      await comecarDeFato();
    } finally {
      iniciando.current = false;
    }
  }

  async function comecarDeFato() {
    setErro(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErro("Este navegador não grava áudio. Use o Chrome ou o Safari atualizados.");
      return;
    }
    if (await comecarOpus()) return;
    const formato = formatoDeGravacao();
    if (formato === null) {
      setErro("Este navegador não grava áudio. Use o Chrome ou o Safari atualizados.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined);
      partes.current = [];
      cancelado.current = false;
      r.ondataavailable = (ev) => ev.data.size && partes.current.push(ev.data);
      r.onstop = () => {
        const tipo = r.mimeType || formato || "audio/webm";
        const blob = new Blob(partes.current, { type: tipo });
        const foiCancelado = cancelado.current;
        // O envio começa antes de qualquer atualização da tela.
        if (!foiCancelado && blob.size >= 1000) {
          const ext = tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : "webm";
          aoGravar(new File([blob], `gravacao.${ext}`, { type: tipo }));
        }
        limpar();
      };
      rec.current = r;
      r.start(250);
      contar(() => {
        if (r.state === "recording") r.stop();
      });
    } catch {
      setErro("Sem acesso ao microfone. Libere nas permissões do navegador.");
    }
  }

  function parar(cancelar: boolean) {
    cancelado.current = cancelar;
    if (opus.current) void opus.current.stop();
    else if (rec.current?.state === "recording") rec.current.stop();
    else limpar();
  }

  if (!gravando)
    return (
      <>
        <Botao
          variante="neutro"
          tamanho="icone"
          aria-label="Gravar áudio"
          disabled={desabilitado}
          onClick={() => void comecar()}
        >
          <Mic aria-hidden />
        </Botao>
        {erro ? <p className="w-full text-[11px] text-problema-foreground">{erro}</p> : null}
      </>
    );

  const mm = String(Math.floor(segundos / 60)).padStart(2, "0");
  const ss = String(segundos % 60).padStart(2, "0");
  return (
    <div className="flex min-h-11 flex-1 items-center gap-2 rounded-[22px] bg-problema/15 px-3">
      <span className="size-2.5 animate-pulse rounded-full bg-problema-foreground" aria-hidden />
      <span className="flex-1 text-sm font-semibold tabular-nums" aria-live="polite">
        Gravando {mm}:{ss}
      </span>
      <Botao
        variante="neutro"
        tamanho="icone"
        aria-label="Cancelar gravação"
        onClick={() => parar(true)}
      >
        <X aria-hidden />
      </Botao>
      <Botao tamanho="icone" aria-label="Parar e enviar" onClick={() => parar(false)}>
        <Square aria-hidden />
      </Botao>
    </div>
  );
}
