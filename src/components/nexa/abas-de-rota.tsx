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
  return (
    <nav
      role="tablist"
      aria-label={rotulo}
      className={cn("grid gap-1 rounded-botao bg-muted p-1", className)}
      style={{ gridTemplateColumns: `repeat(${abas.length}, minmax(0, 1fr))` }}
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
              "flex min-h-11 items-center justify-center rounded-botao px-3 text-sm transition-colors",
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
