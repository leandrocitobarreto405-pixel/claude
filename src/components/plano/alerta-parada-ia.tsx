// Aviso vermelho no Painel Nexa enquanto a conta da IA (ou da voz) recusar por falta de crédito ou
// chave: aparece em todas as telas do painel e some sozinho quando a Alice volta a responder.
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { resumoDasParadas, useParadasIa } from "@/lib/paradas-ia";

export function AlertaParadaIa() {
  const q = useParadasIa();
  const linhas = resumoDasParadas(q.data ?? []);
  if (!linhas.length) return null;
  return (
    <div className="mb-4 grid gap-2" role="alert">
      {linhas.map((l) => (
        <Link
          key={l.provedor}
          to={"/nexa/consumo" as never}
          className="flex min-h-11 items-start gap-3 rounded-card border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span className="grid gap-0.5">
            <strong className="text-sm">{l.titulo}</strong>
            <span className="text-xs text-foreground/80">{l.corpo}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
