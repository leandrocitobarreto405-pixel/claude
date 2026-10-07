// Agenda que a Alice oferece: horários-base livres de cada técnico (mesma regra da promoção de
// dia vago), filtrados pela preferência do cliente e com prioridade para os dias em que o
// técnico já tem serviço perto do cliente. Sem banco, para poder testar.
import {
  diaDaSemana,
  distanciaKm,
  horariosLivres,
  type Coordenada,
  type HorarioBase,
  type HorarioLivre,
  type Ocupacao,
} from "@/lib/promocao";

export type Periodo = "manha" | "tarde" | "qualquer";
export type OcupacaoComLugar = Ocupacao & { data: string; coords: Coordenada | null };

export type DiaLivre = {
  data: string;
  livres: HorarioLivre[];
  /** Menor distância (km) entre o cliente e um serviço já marcado no dia. */
  pertoKm: number | null;
};

const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Dias da semana (0 = domingo) que têm pelo menos um horário-base. */
export function diasAtendidos(base: HorarioBase[]): number[] {
  return [...new Set(base.map((b) => b.diaSemana))].sort((a, b) => a - b);
}

function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

export function agendaLivre(o: {
  inicio: string;
  dias: number;
  base: HorarioBase[];
  ocupacoes: OcupacaoComLugar[];
  periodo: Periodo;
  /** Agora em São Paulo: hoje só entram horários com pelo menos `antecedenciaMin` de folga. */
  agora: { data: string; hora: string };
  antecedenciaMin?: number;
  cliente: Coordenada | null;
  /** Até quantos km um serviço do dia conta como "perto". */
  pertoAteKm?: number;
}): DiaLivre[] {
  const folga = o.antecedenciaMin ?? 180;
  const perto = o.pertoAteKm ?? 10;
  const dias: DiaLivre[] = [];
  for (let i = 0; i < o.dias; i++) {
    const data = somarDias(o.inicio, i);
    if (data < o.agora.data) continue;
    const doDia = o.ocupacoes.filter((x) => x.data === data);
    const livres = horariosLivres(o.base, doDia, data).filter((h) => {
      if (o.periodo === "manha" && minutos(h.hora) >= 12 * 60) return false;
      if (o.periodo === "tarde" && minutos(h.hora) < 12 * 60) return false;
      if (data === o.agora.data && minutos(h.hora) < minutos(o.agora.hora) + folga) return false;
      return true;
    });
    if (!livres.length) continue;
    let pertoKm: number | null = null;
    if (o.cliente) {
      for (const x of doDia) {
        if (!x.coords) continue;
        const km = distanciaKm(o.cliente, x.coords);
        if (km <= perto && (pertoKm === null || km < pertoKm)) pertoKm = km;
      }
    }
    dias.push({ data, livres, pertoKm });
  }
  // Primeiro os dias com serviço perto (do mais perto), depois por data.
  return dias.sort(
    (a, b) =>
      (a.pertoKm === null ? 1 : 0) - (b.pertoKm === null ? 1 : 0) ||
      (a.pertoKm ?? 0) - (b.pertoKm ?? 0) ||
      a.data.localeCompare(b.data),
  );
}

/** Texto que a ferramenta consultar_agenda devolve para a Alice. */
export function textoAgenda(
  base: HorarioBase[],
  dias: DiaLivre[],
  periodo: Periodo,
  limite = 8,
): string {
  const atendidos = diasAtendidos(base);
  if (!atendidos.length)
    return 'A empresa não tem horários cadastrados na agenda. Não ofereça horário: transfira para a equipe (motivo "agendamento sem horário").';
  const semHorario = NOMES_DIA.filter((_, i) => !atendidos.includes(i));
  const linhas = [
    `Dias com horário na agenda: ${atendidos.map((d) => NOMES_DIA[d]).join(", ")}.`,
    semHorario.length
      ? `Sem horário (não ofereça nem pergunte): ${semHorario.join(", ")}.`
      : "Todos os dias da semana têm horário.",
  ];
  if (periodo !== "qualquer")
    linhas.push(
      `Filtrado pela preferência do cliente: ${periodo === "manha" ? "manhã" : "tarde"}.`,
    );
  if (!dias.length) {
    linhas.push(
      'Nenhum horário livre nesse período. Consulte outros dias ou, se nada servir, transfira (motivo "agendamento sem horário").',
    );
    return linhas.join("\n");
  }
  linhas.push("Horários livres (ofereça UM por vez; os marcados PERTO têm prioridade):");
  for (const d of dias.slice(0, limite)) {
    const [, m, dd] = d.data.split("-");
    const horas = d.livres.map((h) => `${h.hora} (${h.tecnico})`).join(", ");
    const pertoTxt =
      d.pertoKm !== null
        ? ` · PERTO: o técnico já tem serviço a ${String(d.pertoKm).replace(".", ",")} km do cliente`
        : "";
    linhas.push(`- ${NOMES_DIA[diaDaSemana(d.data)]} ${dd}/${m} (${d.data}): ${horas}${pertoTxt}`);
  }
  linhas.push(
    'O horário é de chegada do técnico (ex.: 10:00 → "chegada entre 10h e 11h"). Nunca ofereça dia ou horário fora desta lista.',
  );
  return linhas.join("\n");
}
