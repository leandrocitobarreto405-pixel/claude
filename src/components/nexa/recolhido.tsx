import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BadgeAlerta } from "./chip";
import { cn } from "@/lib/utils";

/** Cartão que abre e fecha com um toque (fechado por padrão). */
export function Recolhido({
  titulo,
  contagem,
  extra,
  icone,
  abertoInicial = false,
  className,
  children,
}: {
  titulo: React.ReactNode;
  /** Número no badge de alerta ao lado do título. */
  contagem?: number;
  /** Algo à direita do título (ex.: um chip "Ligado"). */
  extra?: React.ReactNode;
  icone?: React.ReactNode;
  abertoInicial?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      defaultOpen={abertoInicial}
      className={cn("rounded-card border border-border bg-card", className)}
    >
      <CollapsibleTrigger className="group flex min-h-14 w-full items-center gap-3 rounded-card px-4 text-left">
        {icone}
        <span className="flex-1 text-[15px] font-bold">{titulo}</span>
        {contagem ? <BadgeAlerta numero={contagem} /> : null}
        {extra}
        <ChevronDown
          aria-hidden
          className="size-5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">{children}</CollapsibleContent>
    </Collapsible>
  );
}
