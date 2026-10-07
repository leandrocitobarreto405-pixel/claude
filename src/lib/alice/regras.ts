/**
 * Regras de negócio da Alice que não dependem de banco nem de rede: horário permitido para
 * mensagens ativas, janela de 24 horas do WhatsApp e condições do orçamento.
 */

export const FUSO = "America/Sao_Paulo";

/** Janela da API oficial do WhatsApp: texto livre só até 24 h depois da última mensagem do cliente. */
export const JANELA_MS = 24 * 60 * 60 * 1000;
/** Folga para não encostar no fim da janela (fila, processamento, envio). */
export const FOLGA_JANELA_MS = 15 * 60 * 1000;

const round2 = (v: number) => Math.round(v * 100) / 100;

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number };

function partesLocais(d: Date): Partes {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { ano: v("year"), mes: v("month"), dia: v("day"), hora: v("hour"), minuto: v("minute") };
}

/** Diferença (ms) entre o relógio local de São Paulo e o UTC nesse instante. */
function deslocamento(d: Date): number {
  const p = partesLocais(d);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  return comoUtc - Math.floor(d.getTime() / 60_000) * 60_000;
}

/** Instante de uma data/hora local de São Paulo. */
export function horarioLocal(ano: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  const aproximado = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto));
  return new Date(aproximado.getTime() - deslocamento(aproximado));
}

/** "AAAA-MM-DDTHH:MM" (ou só "AAAA-MM-DD", às 9h) no horário de São Paulo. */
export function lerDataHoraLocal(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(texto.trim());
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [hora, minuto] = m[4] ? [Number(m[4]), Number(m[5])] : [9, 0];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null;
  const d = horarioLocal(ano, mes, dia, hora, minuto);
  const p = partesLocais(d);
  return p.dia === dia && p.mes === mes ? d : null;
}

/**
 * Primeiro instante permitido para uma mensagem ativa a partir de `d`: dentro do horário,
 * o próprio `d`; antes do início, o início do mesmo dia; depois do fim, o início do dia seguinte.
 */
export function proximoHorarioPermitido(d: Date, inicio: number, fim: number): Date {
  const p = partesLocais(d);
  if (p.hora >= inicio && p.hora < fim) return d;
  if (p.hora < inicio) return horarioLocal(p.ano, p.mes, p.dia, inicio);
  const amanha = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + 1));
  return horarioLocal(
    amanha.getUTCFullYear(),
    amanha.getUTCMonth() + 1,
    amanha.getUTCDate(),
    inicio,
  );
}

export function dentroDoHorario(d: Date, inicio: number, fim: number): boolean {
  const h = partesLocais(d).hora;
  return h >= inicio && h < fim;
}

/** Se ainda dá para mandar texto livre em `quando` (com folga), dada a última mensagem do cliente. */
export function dentroDaJanela(ultimaDoCliente: Date | null, quando: Date): boolean {
  if (!ultimaDoCliente) return false;
  return quando.getTime() <= ultimaDoCliente.getTime() + JANELA_MS - FOLGA_JANELA_MS;
}

export function fimDaJanela(ultimaDoCliente: Date): Date {
  return new Date(ultimaDoCliente.getTime() + JANELA_MS);
}

export type Condicoes = {
  total: number;
  parcelas: number;
  parcela: number;
  descontoPixPercentual: number;
  pix: number;
};

/** Cartão em até N vezes sem juros (total ÷ N) e Pix com desconto (total × (1 − %)). */
export function condicoesPagamento(total: number, parcelas: number, pixPct: number): Condicoes {
  const n = Math.max(1, Math.round(parcelas));
  return {
    total: round2(total),
    parcelas: n,
    parcela: round2(total / n),
    descontoPixPercentual: pixPct,
    pix: round2(total * (1 - pixPct / 100)),
  };
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Validade do orçamento: `dias` depois de hoje (São Paulo), com dia da semana. */
export function validade(agora: Date, dias: number): { data: string; texto: string } {
  const p = partesLocais(agora);
  const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + dias));
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return {
    data: `${d.getUTCFullYear()}-${mm}-${dd}`,
    texto: `${DIAS[d.getUTCDay()]}, ${dd}/${mm}`,
  };
}

/** Data e hora locais para mensagens ("quinta, 01/10 às 14:30"). */
export function dataHoraTexto(d: Date): string {
  const p = partesLocais(d);
  const semana = DIAS[new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay()];
  const dd = String(p.dia).padStart(2, "0");
  const mm = String(p.mes).padStart(2, "0");
  const hh = String(p.hora).padStart(2, "0");
  const mi = String(p.minuto).padStart(2, "0");
  return `${semana}, ${dd}/${mm} às ${hh}:${mi}`;
}

export const reais = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/** Nome comparável: minúsculas, sem acento e com espaços simples. */
export function normalizarNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9,.+]+/g, " ")
    .trim();
}

/** Motivos de perda que a Alice pode registrar e o nome usado no CRM (cria se não existir). */
export const MOTIVOS_PERDA = [
  "Preço",
  "Fechou com outra empresa",
  "Adiou",
  "Fora da área",
  "Não precisa mais",
  "Sumiu sem responder",
] as const;
export type MotivoPerda = (typeof MOTIVOS_PERDA)[number];

/** Nomes equivalentes já usados nos cadastros de motivo de perda. */
export const SINONIMOS_PERDA: Record<MotivoPerda, string[]> = {
  Preço: ["Preço", "Preco"],
  "Fechou com outra empresa": ["Fechou com outra empresa", "Fechou com concorrente"],
  Adiou: ["Adiou", "Não possui previsão"],
  "Fora da área": ["Fora da área", "Não está na região atendida"],
  "Não precisa mais": ["Não precisa mais"],
  "Sumiu sem responder": ["Sumiu sem responder", "Sem retorno"],
};

// ---------------------------------------------------------------- texto interno
const FERRAMENTAS_NOMES =
  /\b(atualizar_lead|atualizar_etapa|consultar_\w+|criar_orcamento|registrar_\w+|enviar_mensagem|enviar_video|enviar_audio_padrao|enviar_dados_tecnico|agendar_followup|transferir_para_humano|reservar_horario|gerar_ordem_servico)\b/i;
const BASTIDOR = [
  /\bficha do cliente\b/i,
  /\bresumo do atendimento\b/i,
  /^\W*lembrete\s*:/im,
  /\blembrete (est[aá] )?(marcado|agendado|é cancelado|será cancelado)\b/i,
  /\bpr[oó]ximo passo (é|será)\b/i,
  /\bse (ele|ela) (n[aã]o )?responder\b/i,
  /\b(enviei|mandei|respondi|expliquei|perguntei|ofereci)\s+(ao|à|a|para o|para a|pro|pra)\s+(cliente|lead)\b/i,
  /\b(o|a) cliente (n[aã]o )?(respondeu|sabe|disse|pediu|quer|mandou)\b/i,
  /\batualizei (a ficha|o lead|o cadastro|o sof[aá]|o resumo)\b/i,
];

/**
 * Texto que a IA escreveu para si (relatório do que fez), não para o cliente: não é enviado.
 * Ex.: "Enviei ao Breno a explicação...", "Ficha do cliente: atualizei...", "Lembrete: ...".
 */
export function textoInterno(texto: string, nomeCliente?: string | null): boolean {
  if (FERRAMENTAS_NOMES.test(texto)) return true;
  if (BASTIDOR.some((r) => r.test(texto))) return true;
  const nome = (nomeCliente ?? "").trim().split(/\s+/)[0];
  if (nome && nome.length >= 3) {
    const n = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Fala do cliente na terceira pessoa ("Enviei ao Breno", "mandei para a Ana").
    if (
      new RegExp(
        `\\b(enviei|mandei|respondi|expliquei|perguntei|ofereci|passei)\\s+(ao|à|a|para o|para a|pro|pra|para)\\s+${n}\\b`,
        "i",
      ).test(texto)
    )
      return true;
  }
  return false;
}
