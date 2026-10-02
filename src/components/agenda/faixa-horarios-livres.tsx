import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus } from "lucide-react";
import { Botao } from "@/components/nexa";
import { horariosLivresFn } from "@/lib/promocao.functions";
import { addDaysISO, todayISO } from "@/lib/format";

export const CHAVE_HORARIOS_LIVRES = ["promocao", "livres"] as const;

function rotuloDoDia(data: string) {
  if (data === addDaysISO(todayISO(), 1)) return "Amanhã";
  const d = new Date(`${data}T12:00:00`);
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * "Amanhã: N horários livres" + "Preencher com promoção". Só aparece quando há horários base
 * cadastrados e algum deles está vago. Para admin e atendente (o técnico não vê).
 */
export function FaixaHorariosLivres() {
  const fn = useServerFn(horariosLivresFn);
  const q = useQuery({
    queryKey: CHAVE_HORARIOS_LIVRES,
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const r = q.data;
  if (!r || !r.configurado || r.livres.length === 0) return null;
  const n = r.livres.length;
  const horas = r.livres.map((l) => l.hora).join(", ");
  return (
    <section
      aria-label="Horários livres"
      className="flex flex-col gap-3 rounded-card bg-atencao p-4 text-atencao-foreground sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <CalendarPlus className="mt-0.5 size-5 shrink-0 text-atencao-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-[15px] font-bold">
            {rotuloDoDia(r.data)}: {n} {n === 1 ? "horário livre" : "horários livres"}
          </p>
          <p className="text-sm">{horas}</p>
        </div>
      </div>
      <Botao asChild variante="primario" className="sm:self-center">
        <Link to="/promocao">Preencher com promoção</Link>
      </Botao>
    </section>
  );
}
