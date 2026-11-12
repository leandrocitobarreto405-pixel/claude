// Faixa vermelha no topo de todas as telas enquanto houver vaga aberta na agenda (admin e
// atendentes). Tocar abre a lista de quem chamar. Some sozinha quando a vaga é preenchida.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, ChevronRight } from "lucide-react";
import { CHAVE_FAIXA_VAGAS, faixaVagasFn } from "@/lib/vagas.functions";

export function FaixaVagas() {
  const ler = useServerFn(faixaVagasFn);
  const q = useQuery({
    queryKey: CHAVE_FAIXA_VAGAS,
    queryFn: () => ler(),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const f = q.data;
  if (!f) return null;
  return (
    <Link
      to={"/vagas" as never}
      role="alert"
      className="mb-4 flex min-h-11 items-center gap-3 rounded-card border-2 border-destructive bg-destructive px-3 py-2 text-destructive-foreground shadow-sm motion-safe:animate-[pisca-vaga_1.2s_ease-in-out_infinite]"
    >
      <CalendarClock className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-sm font-bold leading-snug">{f.texto}</span>
      <span className="hidden shrink-0 text-xs font-semibold underline sm:inline">
        Ver quem chamar
      </span>
      <ChevronRight className="size-5 shrink-0" aria-hidden />
    </Link>
  );
}
