/**
 * Cadência do follow-up garantida pelo sistema (C/D, 27/10/2026). A sequência de toques não depende
 * mais de a Alice lembrar de agendar o próximo: cada resposta dela (sem resposta do cliente) começa a
 * trilha; cada toque feito agenda o seguinte. Funções puras: os passos, o horário de cada um e o
 * próximo.
 *
 * Trilha A (sumiu depois do orçamento): D0 +10 min, D0 +40 min, D1 10h (horários reais), D1 14h
 * (vence amanhã), D2 16h (oferta, só com a oferta ligada) e, no D3 10h, "sem desfecho".
 * Trilha B (sumiu antes do orçamento): D0 +10 min (foto), D0 +40 min (tipo/tamanho + CEP), D1 10h,
 * D2 16h e, no D3 10h, "sem desfecho" (motivo sugerido "Sumiu antes do orçamento").
 * Trilha C (esperando um evento) continua com a data que a Alice combinar.
 * Dentro da janela de 24 h a Alice escreve o toque (com o guia); fora dela vai o modelo aprovado da
 * Meta (A3, A4, A5, B3, B4) ou o toque vira tarefa da equipe.
 */
export type Trilha = "A" | "B";
export type Etapa =
  "A1" | "A2" | "A3" | "A4" | "A5" | "A_FIM" | "B1" | "B2" | "B3" | "B4" | "B_FIM";

export type Passo = {
  etapa: Etapa;
  trilha: Trilha;
  /** Minutos depois da âncora (D0) ou dia/hora contados do dia da âncora (São Paulo). */
  quando: { minutos: number } | { dia: number; hora: number };
  /** O que o toque diz (a Alice adapta dentro da janela). */
  guia: string;
  /** Modelo da Meta para fora da janela (null = vira tarefa da equipe). */
  modelo: string | null;
  /** O modelo leva dois horários reais da agenda. */
  horarios?: boolean;
  oferta?: boolean;
  /** Fim da trilha: não manda mensagem, marca o lead como "sem desfecho". */
  fim?: boolean;
};

export const MOTIVO_FIM: Record<Trilha, string> = {
  A: "Não respondeu depois dos follow-ups",
  B: "Sumiu antes do orçamento",
};

export const CADENCIA: Record<Trilha, Passo[]> = {
  A: [
    {
      etapa: "A1",
      trilha: "A",
      quando: { minutos: 10 },
      guia: "Conseguiu ver o orçamento que te passei, [nome]?",
      modelo: null,
    },
    {
      etapa: "A2",
      trilha: "A",
      quando: { minutos: 40 },
      guia: "Oi, [nome]! Ficou com alguma dúvida sobre o orçamento?",
      modelo: null,
    },
    {
      etapa: "A3",
      trilha: "A",
      quando: { dia: 1, hora: 10 },
      guia: "Ofereça dois horários reais da agenda (consulte com consultar_agenda) para o serviço do orçamento e pergunte se algum funciona.",
      modelo: "fu_orcamento_horarios",
      horarios: true,
    },
    {
      etapa: "A4",
      trilha: "A",
      quando: { dia: 1, hora: 14 },
      guia: "Seu orçamento vence amanhã. Quer garantir um desses horários?",
      modelo: "fu_orcamento_vence",
    },
    {
      etapa: "A5",
      trilha: "A",
      quando: { dia: 2, hora: 16 },
      guia: "Oi, [nome]! Consegui uma condição melhor pra você, em cima do valor que te passei, porque liberou uma vaga nesta semana. Vale até amanhã. Quer que eu te mostre?",
      modelo: "fu_orcamento_oferta",
      oferta: true,
    },
    {
      etapa: "A_FIM",
      trilha: "A",
      quando: { dia: 3, hora: 10 },
      guia: MOTIVO_FIM.A,
      modelo: null,
      fim: true,
    },
  ],
  B: [
    {
      etapa: "B1",
      trilha: "B",
      quando: { minutos: 10 },
      guia: "Peça a foto do estofado (ou o CEP, se a foto já veio), de um jeito leve: pode ser do celular mesmo.",
      modelo: null,
    },
    {
      etapa: "B2",
      trilha: "B",
      quando: { minutos: 40 },
      guia: "Se preferir, o cliente diz só o tipo e o tamanho (ex.: retrátil de 2 módulos, uns 2 metros) e o CEP, e você já passa o orçamento.",
      modelo: null,
    },
    {
      etapa: "B3",
      trilha: "B",
      quando: { dia: 1, hora: 10 },
      guia: "Bom dia! Pergunte se ele ainda quer cuidar do estofado: com a foto e o CEP você passa o orçamento hoje.",
      modelo: "fu_atendimento_d1",
    },
    {
      etapa: "B4",
      trilha: "B",
      quando: { dia: 2, hora: 16 },
      guia: "Vou deixar seu atendimento aqui separadinho. Quando quiser o orçamento, é só me responder por aqui.",
      modelo: "fu_atendimento_d2",
    },
    {
      etapa: "B_FIM",
      trilha: "B",
      quando: { dia: 3, hora: 10 },
      guia: MOTIVO_FIM.B,
      modelo: null,
      fim: true,
    },
  ],
};

/** Modelo da retomada de orçamentos parados (nome, dia1, dia2). */
export const MODELO_RETOMADA = "fu_retomada_horarios";

export function passoDaEtapa(etapa: string | null | undefined): Passo | null {
  if (!etapa) return null;
  for (const t of ["A", "B"] as const) {
    const p = CADENCIA[t].find((x) => x.etapa === etapa);
    if (p) return p;
  }
  return null;
}

/** Próximo passo da trilha (sem a oferta, o A5 é pulado). null = a trilha acabou. */
export function proximoPasso(
  trilha: Trilha,
  etapaAtual: string | null,
  o: { oferta: boolean },
): Passo | null {
  const lista = CADENCIA[trilha].filter((p) => !p.oferta || o.oferta);
  if (!etapaAtual) return lista[0] ?? null;
  const i = lista.findIndex((p) => p.etapa === etapaAtual);
  if (i === -1) {
    // Etapa que saiu da lista (ex.: oferta desligada depois): segue a ordem original.
    const ordem = CADENCIA[trilha].findIndex((p) => p.etapa === etapaAtual);
    return lista.find((p) => CADENCIA[trilha].indexOf(p) > ordem) ?? null;
  }
  return lista[i + 1] ?? null;
}

const FUSO = "America/Sao_Paulo";

/** Data (AAAA-MM-DD) do instante em São Paulo. */
export function diaSP(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: FUSO });
}

/** Instante de "dia + n, hh:00" em São Paulo (UTC−3, sem horário de verão). */
export function instanteSP(dia: string, somarDias: number, hora: number): Date {
  const base = new Date(`${dia}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + somarDias);
  const d = base.toISOString().slice(0, 10);
  return new Date(`${d}T${String(hora).padStart(2, "0")}:00:00-03:00`);
}

/**
 * Horário do passo a partir da âncora (a resposta da Alice que começou a trilha). Nunca antes de
 * agora + 5 min; o motor ainda empurra para dentro do horário de atendimento.
 */
export function horarioDoPasso(passo: Passo, ancora: Date, agora: Date): Date {
  const alvo =
    "minutos" in passo.quando
      ? new Date(ancora.getTime() + passo.quando.minutos * 60_000)
      : instanteSP(diaSP(ancora), passo.quando.dia, passo.quando.hora);
  const minimo = agora.getTime() + 5 * 60_000;
  return alvo.getTime() < minimo ? new Date(minimo) : alvo;
}

/** Trilha pelo estado do lead: já mandou orçamento → A; senão → B. */
export function trilhaDoLead(lead: { orcamento_enviado_em?: string | null } | null): Trilha {
  return lead?.orcamento_enviado_em ? "A" : "B";
}

export type LeadParaTrava = {
  is_open?: boolean | null;
  perdido_em?: string | null;
  os_criada_em?: string | null;
  linked_work_order_id?: string | null;
  agendado_em?: string | null;
  closed_at?: string | null;
};

/** Motivo para não mandar o toque por causa do lead (null = pode). */
export function travaDoLead(lead: LeadParaTrava | null): string | null {
  if (!lead) return "sem lead";
  if (lead.perdido_em) return "lead perdido (ou adiou)";
  if (lead.os_criada_em || lead.linked_work_order_id) return "lead já tem OS";
  if (lead.agendado_em) return "lead já agendou";
  if (lead.closed_at || lead.is_open === false) return "lead encerrado";
  return null;
}

/** Dois horários livres em dias diferentes (texto falado: "quinta (30/10) às 10h"). */
export function doisHorarios(
  dias: Array<{ data: string; livres: Array<{ hora: string }> }>,
): [string, string] | null {
  const NOMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const texto = (data: string, hora: string) => {
    const d = new Date(`${data}T12:00:00Z`);
    const [h, m] = hora.split(":");
    const hh = `${Number(h)}h${m && m !== "00" ? m : ""}`;
    return `${NOMES[d.getUTCDay()]} (${data.slice(8, 10)}/${data.slice(5, 7)}) às ${hh}`;
  };
  const comHorario = dias.filter((d) => d.livres.length);
  if (!comHorario.length) return null;
  const [a, b] = comHorario;
  if (b) return [texto(a!.data, a!.livres[0]!.hora), texto(b.data, b.livres[0]!.hora)];
  if (a!.livres.length >= 2)
    return [texto(a!.data, a!.livres[0]!.hora), texto(a!.data, a!.livres.at(-1)!.hora)];
  return null;
}
