import * as React from "react";
import { cn } from "@/lib/utils";

const TAMANHOS = {
  /** 22 px: números em blocos lado a lado. */
  pequeno: "text-[22px]",
  /** 34 px: valor principal de um cartão (meta do mês). */
  medio: "text-[34px]",
  /** 56 px: o número da tela (conversas agora). */
  grande: "text-[56px] leading-[0.9]",
} as const;

/** Valor em destaque (Bricolage Grotesque) com a legenda ao lado ou embaixo. */
export function NumeroGrande({
  valor,
  legenda,
  complemento,
  tamanho = "medio",
  disposicao = "abaixo",
  sobreEscuro = false,
  className,
}: {
  valor: React.ReactNode;
  legenda?: React.ReactNode;
  /** Texto menor logo depois do valor, ex.: "de R$ 20.000". */
  complemento?: React.ReactNode;
  tamanho?: keyof typeof TAMANHOS;
  /** "abaixo" (blocos) ou "ao-lado" (número grande com texto à direita). */
  disposicao?: "abaixo" | "ao-lado";
  /** Dentro de um CardEscuro: legenda em verde-claro em vez de cinza. */
  sobreEscuro?: boolean;
  className?: string;
}) {
  const corLegenda = sobreEscuro ? "text-marca-foreground/75" : "text-muted-foreground";
  return (
    <div
      className={cn(
        "flex min-w-0",
        disposicao === "abaixo" ? "flex-col gap-0.5" : "items-baseline gap-2.5",
        className,
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cn("font-titulo leading-tight", TAMANHOS[tamanho])}>{valor}</span>
        {complemento ? <span className={cn("text-sm", corLegenda)}>{complemento}</span> : null}
      </span>
      {legenda ? (
        <span
          className={cn(
            disposicao === "abaixo" ? "text-xs" : "text-base font-medium leading-snug",
            disposicao === "abaixo" ? corLegenda : undefined,
          )}
        >
          {legenda}
        </span>
      ) : null}
    </div>
  );
}
