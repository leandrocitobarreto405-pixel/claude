import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type AbaDeRota = { to: string; rotulo: string };

/**
 * Abas de uma tela em que cada aba é um endereço próprio (ex.: Agenda → Calendário e Serviços).
 * Assim os links antigos continuam valendo e a barra de baixo sabe qual tela está ativa.
 */
export function AbasDeRota({
  abas,
  rotulo,
  className,
}: {
  abas: readonly AbaDeRota[];
  rotulo: string;
  className?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (abas.length < 2) return null;
  return (
    <nav
      role="tablist"
      aria-label={rotulo}
      className={cn("flex gap-1 overflow-x-auto rounded-botao bg-muted p-1", className)}
    >
      {abas.map((a) => {
        const ativa = pathname === a.to || pathname.startsWith(`${a.to}/`);
        return (
          <Link
            key={a.to}
            to={a.to as never}
            role="tab"
            aria-selected={ativa}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center rounded-botao px-1.5 text-[13px] whitespace-nowrap transition-colors sm:px-3 sm:text-sm",
              ativa
                ? "bg-card font-bold text-foreground shadow-card"
                : "font-medium text-muted-foreground",
            )}
          >
            {a.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
