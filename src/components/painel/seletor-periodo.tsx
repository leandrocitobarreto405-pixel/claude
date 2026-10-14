import { PERIODOS, type Periodo } from "@/lib/painel";
import { cn } from "@/lib/utils";

/** Hoje · Semana · Mês (cada botão com 44 px). */
export function SeletorPeriodo({
  valor,
  aoMudar,
}: {
  valor: Periodo;
  aoMudar: (p: Periodo) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Período"
      className="grid grid-cols-3 gap-1 rounded-botao bg-muted p-1"
    >
      {PERIODOS.map((p) => {
        const ativo = valor === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={ativo}
            onClick={() => aoMudar(p.id)}
            className={cn(
              "min-h-11 rounded-botao text-sm transition-colors",
              ativo
                ? "bg-card font-bold text-foreground shadow-card"
                : "font-medium text-muted-foreground",
            )}
          >
            {p.rotulo}
          </button>
        );
      })}
    </div>
  );
}
