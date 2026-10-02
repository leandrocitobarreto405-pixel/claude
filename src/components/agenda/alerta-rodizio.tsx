import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { CHAVE_AGENDA_CONFIG, lerAgendaConfig } from "@/lib/agenda-config.functions";
import { alertaRodizio } from "@/lib/promocao";
import { cn } from "@/lib/utils";

/**
 * Alerta (não bloqueia) ao marcar ou reagendar no dia do rodízio do veículo do técnico. As regras
 * (horários, duração e volta) vêm de "Agenda e promoção".
 */
export function AlertaRodizio({
  data,
  hora,
  tecnicoId,
  className,
}: {
  data: string;
  hora: string;
  tecnicoId: string | null | undefined;
  className?: string;
}) {
  const fn = useServerFn(lerAgendaConfig);
  const q = useQuery({ queryKey: CHAVE_AGENDA_CONFIG, queryFn: () => fn(), staleTime: 300_000 });
  const d = q.data;
  if (!d) return null;
  const texto = alertaRodizio({ data, hora, tecnicoId: tecnicoId || null }, d.veiculos, {
    comecarAPartir: d.config.comecarAPartir,
    tardeInicio: d.config.rodizioTardeInicio,
    duracaoMin: d.config.duracaoMin,
    voltaMin: d.config.voltaMin,
  });
  if (!texto) return null;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {texto} Conta{" "}
        {d.config.duracaoMin / 60 === Math.floor(d.config.duracaoMin / 60)
          ? `${d.config.duracaoMin / 60} h`
          : `${d.config.duracaoMin} min`}{" "}
        de atendimento + {d.config.voltaMin} min de volta. É só um aviso: dá para salvar assim
        mesmo.
      </span>
    </p>
  );
}
