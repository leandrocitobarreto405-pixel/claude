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
 * A trilha começa uma vez e segue a etapa seguinte (planejarToque): a resposta do cliente só cancela o
 * toque pendente. Depois de um retorno combinado sem resposta, 2 dias depois (ESPACADA, se faltar).
 * Dentro da janela de 24 h a Alice escreve o toque (com o guia); fora dela vai o modelo aprovado da
 * Meta (A3, A4, A5, B3, B4) ou o toque vira tarefa da equipe.
 */
export type Trilha = "A" | "B";
export type Etapa =
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "A_FIM"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B_FIM"
  | "AE"
  | "AE_FIM"
  | "BE"
  | "BE_FIM"
  | "R"
  | "RC";

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
      guia: 'Ofereça um horário concreto da agenda (consulte com consultar_agenda; ex.: "Tenho quinta de manhã livre, quer que eu reserve pra você, [nome]?"). Não pergunte se ele viu o orçamento nem se ficou com dúvida e não repita os valores.',
      modelo: null,
    },
    {
      etapa: "A2",
      trilha: "A",
      quando: { minutos: 40 },
      guia: "Traga algo novo sobre o serviço do orçamento, ligado ao que o cliente contou (um cuidado, um benefício ou como funciona no dia), sem perguntar de novo se ele viu o orçamento nem se ficou com dúvida. Se o cliente já disse o que vai fazer (ver com alguém, pensar, avisar), não cobre: só o algo novo.",
      modelo: null,
    },
    {
      etapa: "A3",
      trilha: "A",
      quando: { dia: 1, hora: 10 },
      guia: "Ofereça dois horários reais da agenda (consulte com consultar_agenda) para o serviço do orçamento, em dias diferentes (o primeiro horário livre e outro em outro dia, de preferência um dia de semana e um sábado), e pergunte se algum funciona. Não repita a pergunta do toque anterior.",
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
      guia: "Algo novo, sem repetir o pedido da foto: se preferir, o cliente diz só o tipo e o tamanho (ex.: retrátil de 2 módulos, uns 2 metros) e o CEP, e você já passa o orçamento.",
      modelo: null,
    },
    {
      etapa: "B3",
      trilha: "B",
      quando: { dia: 1, hora: 10 },
      guia: "Bom dia! Traga algo novo (um benefício da higienização ligado ao que o cliente contou, ou a agenda da semana) e diga que, com a foto e o CEP, você passa o orçamento hoje. Sem repetir a pergunta do toque anterior.",
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

/**
 * Toque espaçado (28/10, conversa 0909): depois de um retorno combinado sem resposta, quando a trilha
 * não tem mais toque, um toque com algo novo 2 dias depois, às 10h, e, sem resposta, "sem desfecho"
 * mais 2 dias depois.
 */
export const ESPACADA: Record<Trilha, Passo[]> = {
  A: [
    {
      etapa: "AE",
      trilha: "A",
      quando: { dia: 2, hora: 10 },
      guia: "Traga algo novo e útil, sem repetir a última pergunta nem cobrar de outro jeito: ofereça dois horários reais da agenda (consulte com consultar_agenda) em dias diferentes e a reserva do horário, ou um cuidado concreto com o estofado. Uma pergunta só.",
      modelo: "fu_orcamento_horarios",
      horarios: true,
    },
    {
      etapa: "AE_FIM",
      trilha: "A",
      quando: { dia: 4, hora: 10 },
      guia: MOTIVO_FIM.A,
      modelo: null,
      fim: true,
    },
  ],
  B: [
    {
      etapa: "BE",
      trilha: "B",
      quando: { dia: 2, hora: 10 },
      guia: "Traga algo novo e útil, sem repetir o pedido anterior: deixe o atendimento separado e diga que, quando quiser, com a foto e o CEP você passa o orçamento no mesmo dia.",
      modelo: "fu_atendimento_d2",
    },
    {
      etapa: "BE_FIM",
      trilha: "B",
      quando: { dia: 4, hora: 10 },
      guia: MOTIVO_FIM.B,
      modelo: null,
      fim: true,
    },
  ],
};

/** Toque da cadência já feito nesta conversa (mandado pela Alice, pelo modelo ou passado à equipe). */
export type ToqueFeito = { etapa: string; em: string };

export type EntradaPlano = {
  trilha: Trilha;
  oferta: boolean;
  agora: Date;
  /** Trilha A: envio do orçamento atual (o último que mudou de valor). */
  ancoraOrcamento: Date | null;
  /** Toques da cadência já feitos desde a âncora (trilha A) ou desde o início (B), em ordem. */
  feitos: ToqueFeito[];
  ultimaDoCliente: Date | null;
  /** Retorno combinado (trilha C) feito depois do último toque da cadência e ainda sem resposta. */
  retorno: Date | null;
};

const HORA = 3_600_000;
const ehMinutos = (p: Passo) => "minutos" in p.quando;
const maior = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

/** Envio do orçamento atual: o primeiro orçamento ou o último que mudou de valor (novo orçamento). */
export function ancoraDoOrcamento(
  orcamentos: Array<{ created_at: string; total: number | string | null }>,
): Date | null {
  const lista = [...orcamentos].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let ancora: string | null = null;
  let valor: number | null = null;
  for (const q of lista) {
    const v = Number(q.total ?? 0);
    if (valor === null || Math.abs(v - valor) > 0.009) ancora = q.created_at;
    valor = v;
  }
  return ancora ? new Date(ancora) : null;
}

/**
 * Próximo toque da cadência (28/10, conversas 6066 e 0909). A trilha começa UMA vez (A: no envio do
 * orçamento) e nunca volta para o começo: a resposta do cliente só cancela o toque pendente e, quando
 * a conversa para de novo, segue a etapa seguinte. Regras:
 * - etapa já feita não se repete;
 * - cliente conversou depois do início da trilha: sem toques de +10/+40 min; se foi hoje, o próximo
 *   só amanhã, a partir das 10h;
 * - depois de um retorno combinado sem resposta: só 2 dias depois, às 10h, com algo novo (se não
 *   sobrar toque na trilha, vai o toque espaçado e, sem resposta, o fim 2 dias depois);
 * - depois do primeiro dia, nunca dois toques com menos de 4 h;
 * - "vence amanhã" atrasado não sai (validade dita é validade cumprida).
 */
export function planejarToque(e: EntradaPlano): { passo: Passo; quando: Date } | null {
  const { trilha, agora } = e;
  const feitas = new Set(e.feitos.map((f) => f.etapa));
  const emDe = (etapa: string) => {
    const f = e.feitos.find((x) => x.etapa === etapa);
    return f ? new Date(f.em) : null;
  };
  const primeiroB = e.feitos[0] ? new Date(e.feitos[0].em) : null;
  // Início da trilha: o orçamento (A) ou o primeiro toque feito (B; sem toque, agora).
  const inicio =
    trilha === "A"
      ? (e.ancoraOrcamento ?? agora)
      : primeiroB
        ? new Date(primeiroB.getTime() - 10 * 60_000)
        : agora;
  const marco = trilha === "A" ? e.ancoraOrcamento : primeiroB;
  const falouDepois = Boolean(
    e.ultimaDoCliente && marco && e.ultimaDoCliente.getTime() > marco.getTime(),
  );
  const ultimoToque = [...e.feitos.map((f) => new Date(f.em)), ...(e.retorno ? [e.retorno] : [])]
    .sort((a, b) => a.getTime() - b.getTime())
    .at(-1);
  const alvo = (p: Passo) =>
    "minutos" in p.quando
      ? new Date(inicio.getTime() + p.quando.minutos * 60_000)
      : instanteSP(diaSP(inicio), p.quando.dia, p.quando.hora);

  let candidatos: Passo[];
  const espacada = ESPACADA[trilha];
  const ultimoEspacado = espacada.filter((p) => feitas.has(p.etapa)).at(-1);
  if (ultimoEspacado) {
    candidatos = espacada.slice(espacada.indexOf(ultimoEspacado) + 1);
  } else {
    const lista = CADENCIA[trilha].filter((p) => !p.oferta || e.oferta);
    const idx = Math.max(-1, ...lista.map((p, i) => (feitas.has(p.etapa) ? i : -1)));
    candidatos = lista.slice(idx + 1).filter((p) => !feitas.has(p.etapa));
    if (falouDepois || e.retorno) candidatos = candidatos.filter((p) => !ehMinutos(p));
    candidatos = candidatos.filter(
      (p) => !(p.etapa === "A4" && alvo(p).getTime() + 4 * HORA < agora.getTime()),
    );
    if (e.retorno && !candidatos.some((p) => !p.fim))
      candidatos = espacada.filter((p) => !feitas.has(p.etapa));
  }
  const passo = candidatos[0];
  if (!passo) return null;

  let quando = alvo(passo);
  if (passo.etapa === "B2" && emDe("B1")) quando = new Date(emDe("B1")!.getTime() + 30 * 60_000);
  quando = maior(quando, new Date(agora.getTime() + 5 * 60_000));
  if (falouDepois && e.ultimaDoCliente && diaSP(e.ultimaDoCliente) === diaSP(agora))
    quando = maior(quando, instanteSP(diaSP(agora), 1, 10));
  if (e.retorno) quando = maior(quando, instanteSP(diaSP(e.retorno), 2, 10));
  if (ultimoEspacado) quando = maior(quando, instanteSP(diaSP(emDe(ultimoEspacado.etapa)!), 2, 10));
  if (ultimoToque && !ehMinutos(passo)) {
    const intervalo = passo.fim ? 18 * HORA : 4 * HORA;
    quando = maior(quando, new Date(ultimoToque.getTime() + intervalo));
  }
  return { passo, quando };
}

/** Toques do dia seguinte às 10h (D1): os que podem sair em áudio. */
export const ETAPAS_D1 = new Set(["A3", "B3"]);

/**
 * Toque do dia seguinte em áudio (28/10, item 5): só o D1, dentro da janela de 24 h (quem chama já
 * está nela), com a opção ligada e a voz configurada na empresa, conversa que não está "só texto" e
 * nunca dois áudios seguidos sem resposta do cliente.
 */
export function toqueEmAudio(o: {
  etapa: string;
  ligado: boolean;
  audioAtivo: boolean;
  soTexto: boolean;
  /** A última mensagem da Alice foi um áudio e o cliente não respondeu depois. */
  audioSemResposta: boolean;
}): boolean {
  return ETAPAS_D1.has(o.etapa) && o.ligado && o.audioAtivo && !o.soTexto && !o.audioSemResposta;
}

/** Instrução do toque D1 em áudio (o guia do passo diz o "algo novo"). */
export const GUIA_TOQUE_AUDIO =
  "Faça este toque em ÁUDIO, com falar_em_audio: até 350 caracteres (uns 25 segundos), escrito para ser falado. Comece pelo nome do cliente; lembre a dor ou o motivo que ele contou e traga o algo novo do guia; sem pressão e sem falar de validade; não repita pergunta já feita; termine com UMA pergunta que leve ao próximo passo (nunca “ficou alguma dúvida?” nem parecido). Vale a regra de empatia (se ele contou algo da vida dele, comece por isso). Horários, valores e datas não vão no áudio: se precisar, mande depois, em texto, sem outra pergunta.";

/** Modelo do retorno combinado (trilha C) fora da janela de 24 h (só o nome). */
export const MODELO_RETORNO_COMBINADO = "fu_retorno_combinado";

/**
 * Retorno combinado fora da janela (28/10): o modelo traz uma frase curta com empatia (escrita na
 * hora, retorno-combinado.ts) e pergunta se pode continuar; quando o cliente responde, a Alice segue
 * com a empatia antes do interesse. Sem nome confiável, a variante _sn.
 */
export const PASSO_RETORNO_COMBINADO: Passo = {
  etapa: "RC",
  trilha: "A",
  quando: { minutos: 0 },
  guia: "Retorno combinado: pergunte como estão as coisas e se pode continuar o atendimento.",
  modelo: MODELO_RETORNO_COMBINADO,
};

/** Modelo da retomada de orçamentos parados (nome, dia1, dia2). */
export const MODELO_RETOMADA = "fu_retomada_horarios";

/**
 * Retomada de orçamento parado (aprovada caso a caso): UMA mensagem com dois horários reais, sem
 * abrir a sequência de toques depois.
 */
export const PASSO_RETOMADA: Passo = {
  etapa: "R",
  trilha: "A",
  quando: { minutos: 0 },
  guia: "Retome o orçamento que o cliente pediu: ofereça dois horários reais da agenda (consulte com consultar_agenda), em dias diferentes (o primeiro horário livre e outro em outro dia, de preferência um dia de semana e um sábado), e pergunte se algum funciona.",
  modelo: MODELO_RETOMADA,
  horarios: true,
};

export function passoDaEtapa(etapa: string | null | undefined): Passo | null {
  if (!etapa) return null;
  if (etapa === "R") return PASSO_RETOMADA;
  for (const t of ["A", "B"] as const) {
    const p =
      CADENCIA[t].find((x) => x.etapa === etapa) ?? ESPACADA[t].find((x) => x.etapa === etapa);
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
  const espacada = ESPACADA[trilha];
  const j = etapaAtual ? espacada.findIndex((p) => p.etapa === etapaAtual) : -1;
  if (j !== -1) return espacada[j + 1] ?? null;
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
  const diaDaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();
  const texto = (data: string, hora: string) => {
    const [h, m] = hora.split(":");
    const hh = `${Number(h)}h${m && m !== "00" ? m : ""}`;
    return `${NOMES[diaDaSemana(data)]} (${data.slice(8, 10)}/${data.slice(5, 7)}) às ${hh}`;
  };
  const comHorario = dias.filter((d) => d.livres.length);
  if (!comHorario.length) return null;
  // O primeiro horário livre e outro em OUTRO dia: de preferência um dia de semana e um sábado
  // (27/10: a retomada saiu com dois horários no mesmo sábado).
  const [a, ...outros] = comHorario;
  const sabado = (d: { data: string }) => diaDaSemana(d.data) === 6;
  const b =
    (sabado(a!) ? outros.find((d) => !sabado(d)) : outros.find(sabado)) ?? outros[0] ?? null;
  if (b) return [texto(a!.data, a!.livres[0]!.hora), texto(b.data, b.livres[0]!.hora)];
  // Só um dia com vaga na janela: dois horários do mesmo dia (melhor que nenhum).
  if (a!.livres.length >= 2)
    return [texto(a!.data, a!.livres[0]!.hora), texto(a!.data, a!.livres.at(-1)!.hora)];
  return null;
}
