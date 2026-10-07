import { useState } from "react";
import { ChevronDown, ChevronUp, UploadCloud } from "lucide-react";
import { ListaDeEnvios } from "@/components/os/campos-midia";
import { useEnvios } from "@/lib/fila-envios";

/**
 * Resumo dos envios de fotos e vídeos em qualquer tela do app (acima da barra de abas): mostra o
 * progresso e os erros mesmo depois de sair da OS ou fechar a conclusão.
 */
export function PainelEnvios() {
  const envios = useEnvios();
  const [aberto, setAberto] = useState(false);
  const ativos = envios.filter((e) => e.estado !== "pronto" && e.estado !== "erro");
  const erros = envios.filter((e) => e.estado === "erro");
  if (!ativos.length && !erros.length) return null;
  const total = ativos.reduce((s, e) => s + e.tamanho, 0);
  const feito = ativos.reduce((s, e) => s + e.enviados, 0);
  const pct = total ? Math.floor((feito / total) * 100) : 0;
  const resumo = ativos.length
    ? `Enviando ${ativos.length} ${ativos.length === 1 ? "arquivo" : "arquivos"} · ${pct}%`
    : `${erros.length} ${erros.length === 1 ? "envio não terminou" : "envios não terminaram"}`;
  return (
    <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-40 mx-auto max-w-md lg:bottom-4">
      <div className="rounded-card border border-border bg-card shadow-lg">
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm font-semibold"
          aria-expanded={aberto}
          onClick={() => setAberto((v) => !v)}
        >
          <UploadCloud
            className={`size-5 shrink-0 ${erros.length && !ativos.length ? "text-destructive" : "text-primary"}`}
            aria-hidden
          />
          <span className="flex-1">{resumo}</span>
          {aberto ? (
            <ChevronDown className="size-5" aria-hidden />
          ) : (
            <ChevronUp className="size-5" aria-hidden />
          )}
        </button>
        {aberto ? (
          <div className="max-h-[50vh] overflow-y-auto border-t border-border p-3">
            <ListaDeEnvios />
          </div>
        ) : null}
      </div>
    </div>
  );
}
