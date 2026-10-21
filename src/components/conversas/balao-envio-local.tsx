// Balão otimista de anexo enviado pelo app: player de áudio, miniatura da foto ou nome do
// documento, com "enviando…", "✓ enviada · 1,8 s" ou "falhou" + tentar de novo / descartar.
import { useState } from "react";
import { FileText, RotateCcw, X } from "lucide-react";
import { Botao } from "@/components/nexa";
import { descartarEnvio, tentarDeNovo, type EnvioLocal } from "@/lib/envios-locais";
import { dateTimeBR } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A mídia em si (sem balão): usada dentro do balão da mensagem confirmada e no balão local. */
export function MidiaLocal({ envio }: { envio: EnvioLocal }) {
  const [semImagem, setSemImagem] = useState(false);
  if (envio.tipo === "audio")
    return (
      <audio controls preload="metadata" src={envio.url} className="h-11 w-full max-w-[280px]">
        Áudio gravado
      </audio>
    );
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

export function BalaoEnvioLocal({ envio }: { envio: EnvioLocal }) {
  const falhou = envio.estado === "falhou";
  return (
    <div className="flex w-full justify-end pl-8">
      <div
        className={cn(
          "ml-auto max-w-[85%] rounded-card rounded-br-md px-3.5 py-2.5 text-[15px] leading-snug",
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
