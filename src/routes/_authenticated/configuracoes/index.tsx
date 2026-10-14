import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { CabecalhoDeTela } from "@/components/nexa";
import { GRUPOS_CONFIG, rotaDaAbaAntiga, rotaDoGrupo } from "@/lib/configuracoes-grupos";

export const Route = createFileRoute("/_authenticated/configuracoes/")({
  // As abas antigas (?aba=X) caem no grupo certo.
  validateSearch: (s: Record<string, unknown>): { aba?: string } =>
    typeof s["aba"] === "string" ? { aba: s["aba"] } : {},
  beforeLoad: ({ search }) => {
    const destino = rotaDaAbaAntiga(search.aba);
    if (destino) throw redirect({ to: destino as never, replace: true });
  },
  head: () => ({
    meta: [
      { title: "Configurações — Nexa OS" },
      { name: "description", content: "Empresa, vendas, agenda, mensagens, Alice e leads." },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela titulo="Configurações" descricao="Tudo da empresa, em grupos." />
      <ul className="flex flex-col gap-2.5">
        {GRUPOS_CONFIG.map((g) => {
          const Icone = g.icone;
          return (
            <li key={g.id}>
              <Link
                to={rotaDoGrupo(g.id) as never}
                className="flex min-h-16 items-center gap-3 rounded-card border border-border bg-card px-4 py-3 hover:border-marca/40"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-marca-claro text-marca">
                  <Icone className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-bold">{g.rotulo}</span>
                  <span className="truncate text-sm text-muted-foreground">{g.descricao}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
