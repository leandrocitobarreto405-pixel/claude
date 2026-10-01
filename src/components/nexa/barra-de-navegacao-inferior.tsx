import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { BadgeAlerta } from "./chip";
import { cn } from "@/lib/utils";

export type ItemDeNavegacao = {
  to: string;
  rotulo: string;
  icone: LucideIcon;
  /** Número no badge de alerta (ex.: conversas esperando). */
  badge?: number;
  /** Só um ponto de alerta, sem número (ex.: avisos não lidos). */
  ponto?: boolean;
  /** Outras rotas que também deixam esta aba ativa. */
  ativoEm?: string[];
};

function ativa(pathname: string, item: ItemDeNavegacao) {
  return [item.to, ...(item.ativoEm ?? [])].some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );
}

/**
 * Barra de abas fixa no rodapé (celular). Aba ativa com a pílula verde-clara atrás do ícone.
 * `fixa={false}` desenha a barra no lugar (para a página de componentes).
 */
export function BarraDeNavegacaoInferior({
  itens,
  fixa = true,
  className,
}: {
  itens: ItemDeNavegacao[];
  fixa?: boolean;
  className?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Navegação principal"
      className={cn(
        "grid border-t border-border bg-card px-1.5 pt-2",
        // Respeita a barra do iPhone quando o app está instalado.
        "pb-[max(env(safe-area-inset-bottom),0.5rem)]",
        fixa && "fixed inset-x-0 bottom-0 z-30",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}
    >
      {itens.map((item) => {
        const atual = ativa(pathname, item);
        const Icone = item.icone;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={atual ? "page" : undefined}
            className={cn(
              "flex min-h-[52px] flex-col items-center justify-center gap-[3px] rounded-botao text-xs",
              atual ? "font-bold text-marca" : "font-medium text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "relative flex h-[30px] w-[52px] items-center justify-center rounded-full",
                atual && "bg-marca-claro",
              )}
            >
              <Icone className="size-[22px]" strokeWidth={atual ? 1.9 : 1.8} aria-hidden />
              {item.badge ? (
                <BadgeAlerta
                  numero={item.badge}
                  className="absolute -top-[3px] right-1.5"
                  rotulo={`${item.badge} pendente(s)`}
                />
              ) : item.ponto ? (
                <BadgeAlerta ponto className="absolute right-[15px] top-0.5" rotulo="Novidades" />
              ) : null}
            </span>
            <span className="max-w-full truncate px-0.5">{item.rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}
