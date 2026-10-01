import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho das telas do app: linha pequena acima (data, mês), título grande e uma ação à
 * direita (ex.: botão "Novo"). Com `voltarPara`, mostra a seta de voltar.
 */
export function CabecalhoDeTela({
  titulo,
  sobretitulo,
  descricao,
  acao,
  voltarPara,
  className,
}: {
  titulo: React.ReactNode;
  sobretitulo?: React.ReactNode;
  descricao?: React.ReactNode;
  acao?: React.ReactNode;
  voltarPara?: string;
  className?: string;
}) {
  return (
    <header className={cn("flex items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {voltarPara ? (
          <Link
            to={voltarPara}
            className="-ml-2 mb-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-botao px-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" aria-hidden />
            Voltar
          </Link>
        ) : null}
        {sobretitulo ? <span className="text-sm text-muted-foreground">{sobretitulo}</span> : null}
        <h1 className="font-titulo text-[30px] leading-[1.15]">{titulo}</h1>
        {descricao ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{descricao}</p>
        ) : null}
      </div>
      {acao ? <div className="shrink-0">{acao}</div> : null}
    </header>
  );
}
