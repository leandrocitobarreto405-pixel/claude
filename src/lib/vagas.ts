/**
 * Alarme de vaga na agenda (11/11, plano aprovado pelo dono): o que conta como vaga, o texto da
 * faixa vermelha, o push e a mensagem pronta para chamar cada cliente. Regras puras, sem banco e
 * sem IA. Nada aqui manda mensagem para cliente: a equipe copia e envia.
 *
 * Vaga = horário base livre de técnico próprio (mesma regra de ocupação da agenda) hoje, se ainda
 * faltarem pelo menos 3 horas, e nos dois próximos dias de atendimento (pula dia sem horário base
 * e feriado bloqueado). Empresa sem horário base cadastrado não tem alarme.
 */
import { horariosLivres, type HorarioBase, type Ocupacao, type RegrasAgenda } from "@/lib/promocao";

export type Vaga = {
  data: string;
  hora: string;
  tecnicoId: string;
  tecnico: string;
};

/** Antecedência mínima para a vaga de hoje ainda valer. */
export const FOLGA_HOJE_MIN = 180;
/** Quantos dias de atendimento à frente o alarme olha (além de hoje). */
export const DIAS_A_FRENTE = 2;
/** Horários dos pushes enquanto houver vaga. */
export const HORAS_DO_PUSH = ["08:30", "10:30", "13:30", "16:00"] as const;

const NOMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** "9h", "14h30". */
export function horaFalada(hora: string): string {
  const [h, m] = hora.split(":");
  return `${Number(h)}h${m && m !== "00" ? m : ""}`;
}

/** Os dias que o alarme olha: hoje e os próximos dias de atendimento (até 10 dias à frente). */
export function diasDoAlarme(
  hoje: string,
  base: HorarioBase[],
  bloqueados: ReadonlyMap<string, string> | ReadonlySet<string>,
): string[] {
  const atende = new Set(base.map((b) => b.diaSemana));
  const dias: string[] = [];
  const ok = (d: string) => atende.has(diaSemana(d)) && !bloqueados.has(d);
  if (ok(hoje)) dias.push(hoje);
  let achados = 0;
  for (let i = 1; i <= 10 && achados < DIAS_A_FRENTE; i++) {
    const d = somarDias(hoje, i);
    if (!ok(d)) continue;
    dias.push(d);
    achados++;
  }
  return dias;
}

/** Vagas abertas agora, em ordem de data e hora. */
export function vagasAbertas(o: {
  agora: { data: string; hora: string };
  base: HorarioBase[];
  ocupacoes: Array<Ocupacao & { data: string }>;
  regras?: RegrasAgenda;
  bloqueados: ReadonlyMap<string, string> | ReadonlySet<string>;
}): Vaga[] {
  const vagas: Vaga[] = [];
  for (const data of diasDoAlarme(o.agora.data, o.base, o.bloqueados)) {
    const doDia = o.ocupacoes.filter((x) => x.data === data);
    for (const l of horariosLivres(o.base, doDia, data, o.regras)) {
      if (data === o.agora.data && minutos(l.hora) < minutos(o.agora.hora) + FOLGA_HOJE_MIN)
        continue;
      vagas.push({ data, hora: l.hora, tecnicoId: l.tecnicoId, tecnico: l.tecnico });
    }
  }
  return vagas.sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora));
}

/** "hoje", "amanhã (qua 11/11)", "sexta 13/11". */
export function rotuloDoDia(data: string, hoje: string): string {
  if (data === hoje) return "hoje";
  if (data === somarDias(hoje, 1)) return `amanhã (${CURTOS[diaSemana(data)]} ${dataCurta(data)})`;
  return `${NOMES[diaSemana(data)]} ${dataCurta(data)}`;
}

/** "amanhã", "hoje" ou "sexta (13/11)", para dentro da mensagem ao cliente. */
export function diaParaCliente(data: string, hoje: string): string {
  if (data === hoje) return "hoje";
  if (data === somarDias(hoje, 1)) return "amanhã";
  return `${NOMES[diaSemana(data)]} (${dataCurta(data)})`;
}

function horasDoDia(vagas: Vaga[]): string {
  const horas = [...new Set(vagas.map((v) => v.hora))].sort().map(horaFalada);
  if (horas.length === 1) return `às ${horas[0]}`;
  return `às ${horas.slice(0, -1).join(", ")} e ${horas.at(-1)}`;
}

/** Vagas agrupadas por dia, na ordem. */
export function vagasPorDia(vagas: Vaga[]): Array<{ data: string; vagas: Vaga[] }> {
  const mapa = new Map<string, Vaga[]>();
  for (const v of vagas) mapa.set(v.data, [...(mapa.get(v.data) ?? []), v]);
  return [...mapa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, vs]) => ({ data, vagas: vs }));
}

/** Texto da faixa vermelha; null quando não há vaga. */
export function textoDaFaixa(vagas: Vaga[], hoje: string): string | null {
  if (!vagas.length) return null;
  const partes = vagasPorDia(vagas).map(
    (d) => `Vaga aberta ${rotuloDoDia(d.data, hoje)} ${horasDoDia(d.vagas)}`,
  );
  return `${partes.join(" · ")}. Agenda vazia é dinheiro perdido.`;
}

/** Linha do resumo da manhã da Tatiana: "Vagas abertas: amanhã (qua 11/11) às 9h; sexta 13/11 às 14h." */
export function linhaDoResumo(vagas: Vaga[], hoje: string): string | null {
  if (!vagas.length) return null;
  return `Vagas abertas: ${vagasPorDia(vagas)
    .map((d) => `${rotuloDoDia(d.data, hoje)} ${horasDoDia(d.vagas)}`)
    .join("; ")}.`;
}

/** Título curto de uma vaga: "Preencher a vaga de amanhã (qua 11/11) às 9h". */
export function tituloDaVaga(v: Vaga, hoje: string): string {
  return `Preencher a vaga de ${rotuloDoDia(v.data, hoje)} às ${horaFalada(v.hora)}`;
}

/** Push: "Amanhã tem vaga às 9h: 6 clientes para chamar". Fala do dia mais próximo. */
export function textoDoPush(
  vagas: Vaga[],
  hoje: string,
  candidatos: number,
): { titulo: string; corpo: string } | null {
  const [primeiro] = vagasPorDia(vagas);
  if (!primeiro) return null;
  const dia = rotuloDoDia(primeiro.data, hoje).replace(/ \(.*\)$/, "");
  const Dia = dia.charAt(0).toUpperCase() + dia.slice(1);
  const chamar =
    candidatos === 0
      ? "veja quem chamar"
      : candidatos === 1
        ? "1 cliente para chamar"
        : `${candidatos} clientes para chamar`;
  const outros = new Set(vagas.map((v) => v.data)).size - 1;
  return {
    titulo: `${Dia} tem vaga ${horasDoDia(primeiro.vagas)}: ${chamar}`,
    corpo:
      outros > 0
        ? `E mais ${outros === 1 ? "1 dia" : `${outros} dias`} com vaga. Agenda vazia é dinheiro perdido.`
        : "Agenda vazia é dinheiro perdido.",
  };
}

/**
 * O push desta hora (08:30, 10:30, 13:30 ou 16:00), se a varredura caiu nos 30 minutos seguintes;
 * senão null. Uma vez por horário (quem chama grava a chave).
 */
export function pushDaHora(hora: string): (typeof HORAS_DO_PUSH)[number] | null {
  const agora = minutos(hora);
  return HORAS_DO_PUSH.find((h) => agora >= minutos(h) && agora < minutos(h) + 30) ?? null;
}

// ---------------------------------------------------------------- quem chamar

/** Ordem pedida pelo dono (a, b, c, d). */
export const GRUPOS_DA_VAGA = ["remarcar", "negociacao", "adiantar", "orcamento"] as const;
export type GrupoDaVaga = (typeof GRUPOS_DA_VAGA)[number];

export const ROTULO_GRUPO: Record<GrupoDaVaga, string> = {
  remarcar: "Serviço cancelado ou esperando remarcar",
  negociacao: "Em negociação ou pediu um tempo",
  adiantar: "Serviço marcado mais adiante (pode adiantar)",
  orcamento: "Orçamento recente sem resposta",
};

export type CandidatoDaVaga = {
  grupo: GrupoDaVaga;
  /** Chave para não repetir a mesma pessoa (lead ou telefone). */
  chave: string;
  nome: string;
  /** O que mostrar de contexto (ex.: "OS 1719 de 09/11", "Orçamento de R$ 420 em 08/11"). */
  detalhe: string;
  estofado: string | null;
  conversaId: string | null;
  leadId: string | null;
  /** Mais recente primeiro dentro do grupo. */
  quando: string;
};

/** Uma pessoa só aparece uma vez, no grupo de maior prioridade; dentro do grupo, o mais recente. */
export function ordenarCandidatos(lista: CandidatoDaVaga[], limite = 40): CandidatoDaVaga[] {
  const ordem = (g: GrupoDaVaga) => GRUPOS_DA_VAGA.indexOf(g);
  const vistos = new Set<string>();
  return [...lista]
    .sort((a, b) => ordem(a.grupo) - ordem(b.grupo) || b.quando.localeCompare(a.quando))
    .filter((c) => {
      if (vistos.has(c.chave)) return false;
      vistos.add(c.chave);
      return true;
    })
    .slice(0, limite);
}

/** Primeiro nome para a saudação ("" quando não dá para usar). */
export function primeiroNome(nome: string | null | undefined): string {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[\p{L}][\p{L}'-]+$/u.test(p)) return "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

/**
 * Mensagem pronta (texto fixo): "Oi, Fulana! Abriu um horário amanhã às 9h. Quer aproveitar e já
 * deixar seu sofá novinho?". Quem já tem serviço marcado recebe o convite para adiantar.
 */
export function mensagemDaVaga(o: {
  nome: string | null;
  grupo: GrupoDaVaga;
  vaga: Vaga;
  hoje: string;
  estofado: string | null;
}): string {
  const n = primeiroNome(o.nome);
  const oi = n ? `Oi, ${n}!` : "Oi!";
  const quando = `${diaParaCliente(o.vaga.data, o.hoje)} às ${horaFalada(o.vaga.hora)}`;
  if (o.grupo === "adiantar")
    return `${oi} Abriu um horário ${quando}. Quer adiantar o seu atendimento pra essa data?`;
  if (o.grupo === "remarcar")
    return `${oi} Abriu um horário ${quando}. Quer que eu já reserve pra você e a gente resolve o seu atendimento?`;
  return `${oi} Abriu um horário ${quando}. Quer aproveitar e já deixar ${pecaNovinha(o.estofado)}?`;
}

const PECAS: Array<[RegExp, string]> = [
  [/sof[aá]/, "seu sofá novinho"],
  [/colch[aã]o|colch[oõ]es/, "seu colchão novinho"],
  [/poltrona/, "sua poltrona novinha"],
  [/cadeira/, "suas cadeiras novinhas"],
  [/tapete/, "seu tapete novinho"],
  [/cabeceira/, "sua cabeceira novinha"],
  [/persiana|cortina/, "suas persianas novinhas"],
  [/carro|banco/, "os bancos do carro novinhos"],
];

/** "seu sofá novinho" a partir do item da OS ou do serviço orçado; sem pista, "tudo novinho". */
export function pecaNovinha(texto: string | null | undefined): string {
  const t = (texto ?? "").toLowerCase();
  return PECAS.find(([re]) => re.test(t))?.[1] ?? "tudo novinho";
}
