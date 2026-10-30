// Início: "Hoje: N tarefas da Tatiana" (abre a aba Follow-ups). Só aparece com tarefa e com a
// Tatiana ligada na empresa.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { NOME_GERENTE } from "@/lib/comercial/tatiana";
import { contagemTatianaFn } from "@/lib/tatiana.functions";

export function CartaoTatiana() {
  const fn = useServerFn(contagemTatianaFn);
  const q = useQuery({
    queryKey: ["tatiana-contagem-inicio"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
  });
  const n = q.data?.tarefas ?? 0;
  if (!n) return null;
  return (
    <Link
      to="/crm/follow-ups"
      className="flex min-h-14 min-w-0 items-center gap-3 rounded-card border border-marca/30 bg-marca-claro px-4 py-3 text-left hover:bg-marca-claro/80"
    >
      <span className="font-titulo text-3xl tabular-nums text-marca">{n}</span>
      <span className="min-w-0 flex-1 font-semibold">
        Hoje: {n === 1 ? "1 tarefa" : `${n} tarefas`} da {NOME_GERENTE}
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-marca" />
    </Link>
  );
}
