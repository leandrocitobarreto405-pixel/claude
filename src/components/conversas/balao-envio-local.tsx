// Balão otimista de anexo enviado pelo app: player de áudio, miniatura da foto ou nome do
// documento, com "enviando…", "✓ enviada · 1,8 s" ou "falhou" + tentar de novo / descartar.
import { useState } from "react";
import { FileText, RotateCcw, X } from "lucide-react";
import { Botao } from "@/components/nexa";
import { descartarEnvio, tentarDeNovo, type EnvioLocal } from "@/lib/envios-locais";
import { PlayerAudio } from "@/components/conversas/player-audio";
import { dateTimeBR } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A mídia em si (sem balão): usada dentro do balão da mensagem confirmada e no balão local. */
export function MidiaLocal({ envio }: { envio: EnvioLocal }) {
  const [semImagem, setSemImagem] = useState(false);
  if (envio.tipo === "audio") return <PlayerAudio fonte={envio.arquivo} />;
  if (envio.tipo === "imagem" && !semImagem)
    return (
      <img
        src={envio.url}
        alt="Foto enviada"
        className="max-h-64 max-w-full rounded-botao object-contain"
        onError={() => setSemImagem(true)}
      />
    );
  return (
    <span className="flex items-center gap-2 break-all">
      <FileText className="size-5 shrink-0" aria-hidden />
      {envio.nome}
    </span>
  );
}

/** "celular→servidor 1,2 s · preparo 0,3 s (opus) · Chatwoot 1,9 s · registro 0,1 s". */
function linhaDeTempos(totalSegundos: number, t: EnvioLocal["tempos"] & object): string {
  const seg = (ms: number) =>
    `${(Math.max(0, ms) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
  const celular = totalSegundos * 1000 - t.totalMs;
  const via = t.via === "opus-recorder" ? "opus" : t.via === "ffmpeg" ? "ffmpeg" : null;
  return [
    `celular→servidor ${seg(celular)}`,
    t.preparoMs > 0 ? `preparo ${seg(t.preparoMs)}${via ? ` (${via})` : ""}` : null,
    `Chatwoot ${seg(t.chatwootMs)}`,
    `registro ${seg(t.registroMs)}`,
    `${Math.round(t.bytes / 1024)} KB`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function BalaoEnvioLocal({ envio }: { envio: EnvioLocal }) {
  const falhou = envio.estado === "falhou";
  return (
    <div className="flex w-full justify-end pl-8">
      <div
        className={cn(
          "ml-auto min-w-0 max-w-[85%] rounded-card rounded-br-md px-3.5 py-2.5 text-[15px] leading-snug",
          falhou ? "border border-problema-foreground/40 bg-problema/15" : "bg-marca-claro",
        )}
        aria-live="polite"
      >
        <p className="mb-0.5 text-[11px] font-semibold text-marca">você</p>
        <MidiaLocal envio={envio} />
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          {dateTimeBR(envio.em)}
          <span className={cn("ml-2", falhou && "font-semibold text-problema-foreground")}>
            {envio.estado === "enviando"
              ? "enviando…"
              : envio.estado === "enviada"
                ? `✓ enviada${envio.segundos != null ? ` · ${envio.segundos.toLocaleString("pt-BR")} s` : ""}`
                : "falhou"}
          </span>
        </p>
        {envio.estado === "enviada" && envio.tempos && envio.segundos != null ? (
          <p className="mt-0.5 break-words text-right text-[10px] text-muted-foreground">
            {linhaDeTempos(envio.segundos, envio.tempos)}
          </p>
        ) : null}
        {falhou ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {envio.erro ? (
              <p className="w-full text-[12px] text-problema-foreground">{envio.erro}</p>
            ) : null}
            <Botao onClick={() => tentarDeNovo(envio.id)}>
              <RotateCcw aria-hidden /> Tentar de novo
            </Botao>
            <Botao variante="neutro" onClick={() => descartarEnvio(envio.id)}>
              <X aria-hidden /> Descartar
            </Botao>
          </div>
        ) : null}
      </div>
    </div>
  );
}
