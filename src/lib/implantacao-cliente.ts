import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { liberacaoFn } from "@/lib/implantacao.functions";

/** A empresa ativa já foi liberada pela Nexa? (enquanto carrega, considera liberada). */
export function useLiberada(): boolean {
  const fn = useServerFn(liberacaoFn);
  const q = useQuery({ queryKey: ["implantacao", "liberada"], queryFn: () => fn() });
  return q.data?.liberada ?? true;
}
