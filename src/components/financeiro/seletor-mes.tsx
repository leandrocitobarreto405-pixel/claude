import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabelPT } from "@/lib/format";
import { mesVizinho, primeiraMaiuscula } from "@/lib/financeiro";

/** Setas para trocar o mês, com o nome em português (o campo nativo aparece em inglês no celular). */
export function SeletorMes({ mes, onChange }: { mes: string; onChange: (mes: string) => void }) {
  const botao =
    "flex size-11 shrink-0 items-center justify-center rounded-botao border border-border bg-card";
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Mês">
      <button
        type="button"
        className={botao}
        aria-label="Mês anterior"
        onClick={() => onChange(mesVizinho(mes, -1))}
      >
        <ChevronLeft className="size-5" />
      </button>
      <span className="min-w-36 text-center text-[15px] font-bold">
        {primeiraMaiuscula(monthLabelPT(mes))}
      </span>
      <button
        type="button"
        className={botao}
        aria-label="Próximo mês"
        onClick={() => onChange(mesVizinho(mes, 1))}
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  );
}
