import * as React from "react";
import { cn } from "@/lib/utils";

export type TomChip = "neutro" | "sucesso" | "atencao" | "problema";

const TONS: Record<TomChip, string> = {
  neutro: "bg-muted text-muted-foreground",
  sucesso: "bg-marca-claro text-marca",
  atencao: "bg-atencao text-atencao-foreground",
  problema: "bg-problema text-problema-foreground",
};

/** Etiqueta curta de situação ("A caminho", "Alice agendou"). Cantos de 8 px. */
export function Chip({
  tom = "neutro",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tom?: TomChip }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-chip px-2 py-1 text-xs font-bold leading-none",
        TONS[tom],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Badge de alerta (laranja, texto branco): número de pendências ou só um ponto.
 * Sem número (ou zero com `ponto`), vira um ponto de 9 px.
 */
export function BadgeAlerta({
  numero,
  ponto,
  className,
  rotulo,
}: {
  numero?: number;
  ponto?: boolean;
  className?: string;
  /** Texto para leitor de tela, ex.: "2 conversas esperando". */
  rotulo?: string;
}) {
  if (!ponto && !numero) return null;
  if (ponto && !numero) {
    return (
      <span
        role={rotulo ? "status" : undefined}
        aria-label={rotulo}
        className={cn("block size-[9px] rounded-full bg-alerta ring-2 ring-card", className)}
      />
    );
  }
  return (
    <span
      aria-label={rotulo}
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-alerta px-[5px] text-[11px] font-bold leading-none text-alerta-foreground",
        className,
      )}
    >
      {numero! > 99 ? "99+" : numero}
    </span>
  );
}
