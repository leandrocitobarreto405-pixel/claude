import * as React from "react";
import { cn } from "@/lib/utils";

type CardProps = React.HTMLAttributes<HTMLElement> & {
  /** Elemento HTML (padrão: section). */
  as?: "section" | "div" | "article" | "li";
  /** Espaço interno: "normal" (18 px) ou "nenhum" (para listas com divisórias). */
  espaco?: "normal" | "nenhum";
};

/** Cartão branco com borda fina e cantos de 20 px. Sem sombra pesada. */
export function Card({ as = "section", espaco = "normal", className, ...props }: CardProps) {
  const Comp = as;
  return (
    <Comp
      className={cn(
        "rounded-card border border-border bg-card text-card-foreground",
        espaco === "normal" && "flex flex-col gap-3.5 p-[18px]",
        className,
      )}
      {...props}
    />
  );
}

/** Cartão no verde-escuro da marca, com texto branco (destaques como "Alice online"). */
export function CardEscuro({ as = "section", espaco = "normal", className, ...props }: CardProps) {
  const Comp = as;
  return (
    <Comp
      className={cn(
        "rounded-card-lg bg-marca text-marca-foreground",
        espaco === "normal" && "flex flex-col gap-4 p-5",
        // Títulos dentro do cartão escuro também ficam brancos.
        "[&_h1]:text-marca-foreground [&_h2]:text-marca-foreground [&_h3]:text-marca-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Bloco interno de um CardEscuro (ex.: os três números lado a lado). */
export function BlocoEscuro({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-botao bg-marca-foreground/8 px-2.5 py-3",
        className,
      )}
      {...props}
    />
  );
}
