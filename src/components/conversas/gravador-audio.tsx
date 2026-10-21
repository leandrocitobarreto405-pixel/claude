// Gravador de áudio da barra de resposta: toque para gravar, toque para parar; o arquivo vai ao
// servidor, que converte para mensagem de voz (OGG/Opus). O navegador grava no que o celular
// permite (WebM/Opus ou MP4/AAC).
import { useEffect, useRef, useState } from "react";
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
}: {
  desabilitado: boolean;
  /** Recebe o arquivo gravado (já parado). */
  aoGravar: (arquivo: File) => void;
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
    timer.current = null;
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setGravando(false);
    setSegundos(0);
  }
  useEffect(() => () => limpar(), []);

  async function comecar() {
    setErro(null);
    const formato = formatoDeGravacao();
    if (formato === null || !navigator.mediaDevices?.getUserMedia) {
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
        limpar();
        if (foiCancelado || blob.size < 1000) return;
        const ext = tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : "webm";
        aoGravar(new File([blob], `gravacao.${ext}`, { type: tipo }));
      };
      rec.current = r;
      r.start(250);
      setGravando(true);
      setSegundos(0);
      timer.current = setInterval(() => {
        setSegundos((s) => {
          if (s + 1 >= MAX_SEGUNDOS && r.state === "recording") r.stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setErro("Sem acesso ao microfone. Libere nas permissões do navegador.");
    }
  }

  function parar(cancelar: boolean) {
    cancelado.current = cancelar;
    if (rec.current?.state === "recording") rec.current.stop();
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
