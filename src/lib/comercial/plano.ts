/**
 * Tatiana, gerente do mês, etapa 2 (02/11/2026): plano de ação do dia. Regras puras: tipos de
 * ação e as listas que cada uma pode usar, esquema e instruções da IA, taxas históricas, custo e
 * venda esperada de cada ação, limite de desconto e a próxima data de disparo. Nada é enviado:
 * "Aprovar" só monta um rascunho no Marketing.
 */
import { OPCOES_LISTAS, modeloSugerido, type EntradaNovaCampanha } from "@/lib/campanha-nova";
import type { NumerosCampanha } from "./campanhas";

export const TIPOS_ACAO = ["oferta_prazo", "encaixe", "outro_servico", "reativacao"] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];
export const NOME_TIPO_ACAO: Record<TipoAcao, string> = {
  oferta_prazo: "Oferta com prazo",
  encaixe: "Encaixe na agenda",
  outro_servico: "Venda do outro serviço",
  reativacao: "Reativação de clientes",
};

/** Listas do Marketing (código interno) que cada tipo de ação pode usar. */
export const LISTAS_DO_TIPO: Record<TipoAcao, string[]> = {
  // Achou caro (perdido por preço) e sumiu depois do orçamento (orçamento recente, até 30 dias).
  oferta_prazo: ["PP", "N1"],
  // Dia vazio na agenda: orçamento dos últimos 10 dias e quem conversou nos últimos 30.
  encaixe: ["N1", "CV"],
  // Cliente de 91 dias a 1 ano: o outro serviço (quem higienizou, impermeabilizar; e vice-versa).
  outro_servico: ["C4"],
  // 6 a 12 meses (C4) e mais de 1 ano (C5).
  reativacao: ["C4", "C5"],
};

/** Chave da contagem de cada lista (grupo + faixa), como o servidor pede ao banco. */
export function chaveDaLista(grupo: string, faixa: string | null | undefined): string {
  const op = OPCOES_LISTAS.find((o) => o.grupo === grupo);
  if (!op) return grupo;
  if (!op.faixas) return grupo;
  const f = op.faixas.find((x) => x.valor === faixa) ?? null;
  return `${grupo}:${f ? f.valor : op.faixaPadrao}`;
}

/** Todas as chaves possíveis com o filtro de cada uma (para contar de uma vez). */
export function opcoesDeContagem(): Record<string, Record<string, { de?: number; ate?: number }>> {
  const saida: Record<string, Record<string, { de?: number; ate?: number }>> = {};
  for (const op of OPCOES_LISTAS) {
    const base = {
      ...(op.de !== undefined ? { de: op.de } : {}),
      ...(op.ate !== undefined ? { ate: op.ate } : {}),
    };
    if (!op.faixas) {
      saida[op.grupo] = { [op.familia]: base };
      continue;
    }
    for (const f of op.faixas)
      saida[`${op.grupo}:${f.valor}`] = {
        [op.familia]: { ...base, ...(f.ate !== undefined ? { ate: f.ate } : {}) },
      };
  }
  return saida;
}

export function rotuloDaLista(grupo: string, faixa: string | null | undefined): string {
  const op = OPCOES_LISTAS.find((o) => o.grupo === grupo);
  if (!op) return grupo;
  const f = op.faixas?.find((x) => x.valor === faixa) ?? null;
  return f && f.valor !== op.faixaPadrao ? `${op.rotulo} (${f.rotulo})` : op.rotulo;
}

// ---------------------------------------------------------------- taxas e datas

export type Taxas = {
  /** Respostas ÷ enviados (0–1). */
  resposta: number;
  /** Vendas ÷ enviados (0–1). */
  venda: number;
  ticket: number;
  /** Vieram das campanhas da própria empresa (false: padrão por falta de dados). */
  historicas: boolean;
};

export const TAXA_PADRAO = { resposta: 0.08, venda: 0.015 } as const;

/** Taxas pelas campanhas já acompanhadas (pelo menos 50 enviados somados); senão, padrão. */
export function taxasHistoricas(campanhas: NumerosCampanha[], ticketPadrao: number): Taxas {
  const enviados = campanhas.reduce((s, c) => s + c.enviados, 0);
  if (enviados < 50) return { ...TAXA_PADRAO, ticket: ticketPadrao, historicas: false };
  const responderam = campanhas.reduce((s, c) => s + c.responderam, 0);
  const vendas = campanhas.reduce((s, c) => s + c.fecharam, 0);
  const vendido = campanhas.reduce((s, c) => s + c.vendido, 0);
  return {
    resposta: Math.round((responderam / enviados) * 1000) / 1000,
    venda: Math.round((vendas / enviados) * 1000) / 1000,
    ticket: vendas > 0 ? Math.round((vendido / vendas) * 100) / 100 : ticketPadrao,
    historicas: true,
  };
}

function somarDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
function isodow(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * Primeira data de disparo a partir de `diasAFrente` (mínimo amanhã) que caia nos dias de disparo
 * da configuração (1 = segunda … 7 = domingo). Com hora própria qualquer dia serve.
 */
export function proximaDataDisparo(
  hoje: string,
  diasAFrente: number,
  diasDisparo: number[],
  horaPropria: boolean,
): string {
  let d = somarDias(hoje, Math.max(1, Math.min(14, Math.round(diasAFrente || 1))));
  if (horaPropria) return d;
  // Sem dias de disparo configurados, vale a data pedida (02/11: evita laço sem saída).
  if (!diasDisparo.length) return d;
  for (let i = 0; i < 14; i++) {
    if (diasDisparo.includes(isodow(d))) return d;
    d = somarDias(d, 1);
  }
  return d;
}

/**
 * Desconto máximo que a Tatiana pode propor: a oferta de follow-up da Alice quando ligada em %,
 * senão o desconto da promoção da agenda; nunca acima de 25% (regra das campanhas).
 */
export function limiteDeDesconto(o: {
  ofertaLigada: boolean;
  ofertaTipo: "pct" | "reais";
  ofertaValor: number | null;
  promoPct: number | null;
}): number {
  const base =
    o.ofertaLigada && o.ofertaTipo === "pct" && o.ofertaValor ? o.ofertaValor : (o.promoPct ?? 20);
  return Math.max(0, Math.min(25, Math.round(base * 100) / 100));
}

// ---------------------------------------------------------------- IA

export const ESQUEMA_PLANO = {
  type: "object",
  additionalProperties: false,
  required: ["leitura", "acoes"],
  properties: {
    leitura: { type: "string" },
    acoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "tipo",
          "titulo",
          "porque",
          "grupo",
          "faixa",
          "quantidade",
          "condicao_pct",
          "condicao_texto",
          "texto",
          "dias_a_frente",
          "hora_inicio",
        ],
        properties: {
          tipo: { type: "string", enum: [...TIPOS_ACAO] },
          titulo: { type: "string" },
          porque: { type: "string" },
          grupo: { type: "string", enum: OPCOES_LISTAS.map((o) => o.grupo) },
          /** "10", "30", "todos"… ou "" para a faixa padrão. */
          faixa: { type: "string" },
          /** 0 = todas as pessoas da lista. */
          quantidade: { type: "integer" },
          /** 0 = sem desconto em %. */
          condicao_pct: { type: "number" },
          condicao_texto: { type: "string" },
          texto: { type: "string" },
          dias_a_frente: { type: "integer" },
          /** "14:00" ou "" para o horário padrão da empresa. */
          hora_inicio: { type: "string" },
        },
      },
    },
  },
} as const;

export function instrucoesPlano(empresa: string, limitePct: number, travaDias: number): string {
  return [
    `Você é a Tatiana, gerente comercial da ${empresa} (higienização e impermeabilização de estofados). Toda manhã você propõe de 1 a 3 ações de WhatsApp para bater a meta do mês, usando só as listas e os modelos informados. Nada é enviado sem o dono aprovar e ativar no Marketing.`,
    "Tipos de ação e listas permitidas:",
    "- oferta_prazo: oferta com prazo curto para quem achou caro (PP) ou sumiu depois do orçamento (N1, faixa 30).",
    "- encaixe: dia vazio na agenda; orçamento recente (N1, faixa 10) ou conversou e não pediu orçamento (CV, faixa 30), com data certa.",
    "- outro_servico: clientes de 91 dias a 1 ano (C4): quem higienizou, oferecer impermeabilização, e vice-versa.",
    "- reativacao: clientes de 6 a 12 meses (C4) ou mais de 1 ano (C5).",
    `Regras: desconto em % nunca acima de ${String(limitePct).replace(".", ",")}%; quem recebeu mensagem nos últimos ${travaDias} dias e quem pediu para parar ficam de fora pelo sistema (use o número "podem" como tamanho); uma lista por ação; não repita uma lista que já tem campanha aberta; proponha só o que faz diferença para a meta ou para a agenda. Sem motivo real, proponha menos ações (até nenhuma).`,
    "Campos: titulo curto; porque = o número que justifica (falta da meta, dia vazio, lista parada); texto = a oferta em uma frase, como o dono explicaria à equipe (o modelo da Meta é fixo; a condição entra na variável do modelo); condicao_texto = a condição que vai na mensagem (ex.: '10% até sexta', 'encaixe quinta à tarde com 15%'); condicao_pct = o desconto em % (0 se a condição não for desconto); dias_a_frente = quantos dias até o envio (1 a 7); hora_inicio só quando a hora importa (encaixe), senão ''.",
    "Escreva em português do Brasil, direto, sem nomes de clientes e sem inventar números: use os informados.",
  ].join("\n");
}

// ---------------------------------------------------------------- montagem das ações

export type AcaoIA = {
  tipo: TipoAcao;
  titulo: string;
  porque: string;
  grupo: string;
  faixa: string;
  quantidade: number;
  condicao_pct: number;
  condicao_texto: string;
  texto: string;
  dias_a_frente: number;
  hora_inicio: string;
};

export type Contagem = { total: number; podem: number };

export type AcaoPlano = {
  indice: number;
  tipo: TipoAcao;
  titulo: string;
  porque: string;
  texto: string;
  lista: { grupo: string; faixa: string | null; quantidade: number | null; nome: string };
  tamanho: { total: number; podem: number };
  modelo: string;
  condicao: { texto: string | null; pct: number | null; semCondicao: boolean };
  /** A IA pediu mais desconto do que a regra permite; foi reduzido ao limite. */
  acimaDaRegra: boolean;
  limitePct: number;
  data: string;
  horaInicio: string | null;
  custo: number;
  esperado: { respostas: number; vendas: number; valor: number; descontoCusto: number };
  status: "sugerida" | "aprovada" | "recusada";
  campanhaId: string | null;
  decididoEm: string | null;
  decididoPor: string | null;
  motivo: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function montarAcao(
  a: AcaoIA,
  i: number,
  ctx: {
    hoje: string;
    contagens: Record<string, Contagem>;
    modelosDaEmpresa: unknown;
    custoMsg: number;
    taxas: Taxas;
    limitePct: number;
    diasDisparo: number[];
  },
): AcaoPlano | null {
  const op = OPCOES_LISTAS.find((o) => o.grupo === a.grupo);
  if (!op || !LISTAS_DO_TIPO[a.tipo]?.includes(a.grupo)) return null;
  const faixa = op.faixas
    ? (op.faixas.find((f) => f.valor === a.faixa)?.valor ?? op.faixaPadrao ?? null)
    : null;
  const chave = chaveDaLista(a.grupo, faixa);
  const contagem = ctx.contagens[chave] ?? { total: 0, podem: 0 };
  const quantidade =
    Number.isInteger(a.quantidade) && a.quantidade > 0 ? Math.min(a.quantidade, 100_000) : null;
  const podem = quantidade ? Math.min(contagem.podem, quantidade) : contagem.podem;
  const pedido = Number.isFinite(a.condicao_pct) ? Math.max(0, a.condicao_pct) : 0;
  const pct = pedido > 0 ? Math.min(pedido, ctx.limitePct) : 0;
  const condicaoTexto = (a.condicao_texto ?? "").trim().slice(0, 200) || null;
  const horaInicio = /^\d{2}:\d{2}$/.test(a.hora_inicio ?? "") ? a.hora_inicio : null;
  const respostas = Math.round(podem * ctx.taxas.resposta);
  const vendas = r2(podem * ctx.taxas.venda);
  const valor = r2(vendas * ctx.taxas.ticket);
  return {
    indice: i,
    tipo: a.tipo,
    titulo: (a.titulo ?? "").trim().slice(0, 80) || NOME_TIPO_ACAO[a.tipo],
    porque: (a.porque ?? "").trim().slice(0, 300),
    texto: (a.texto ?? "").trim().slice(0, 400),
    lista: { grupo: a.grupo, faixa, quantidade, nome: rotuloDaLista(a.grupo, faixa) },
    tamanho: { total: contagem.total, podem },
    modelo: modeloSugerido(a.grupo, ctx.modelosDaEmpresa),
    condicao: {
      texto: condicaoTexto,
      pct: pct > 0 ? pct : null,
      semCondicao: !condicaoTexto && pct === 0,
    },
    acimaDaRegra: pedido > ctx.limitePct,
    limitePct: ctx.limitePct,
    data: proximaDataDisparo(ctx.hoje, a.dias_a_frente, ctx.diasDisparo, horaInicio !== null),
    horaInicio,
    custo: r2(podem * ctx.custoMsg),
    esperado: { respostas, vendas, valor, descontoCusto: r2((valor * pct) / 100) },
    status: "sugerida",
    campanhaId: null,
    decididoEm: null,
    decididoPor: null,
    motivo: null,
  };
}

/** Entrada da campanha nova (mesma validação da tela "Nova campanha") para uma ação aprovada. */
export function entradaDaAcao(a: AcaoPlano): EntradaNovaCampanha {
  return {
    nome: `Tatiana: ${a.titulo}`.slice(0, 80),
    listas: [
      {
        grupo: a.lista.grupo,
        modelo: a.modelo,
        faixa: a.lista.faixa ?? undefined,
        quantidade: a.lista.quantidade,
      },
    ],
    semCondicao: a.condicao.semCondicao,
    condicaoTexto: a.condicao.texto,
    condicaoPct: a.condicao.pct,
    datas: [a.data],
    horaInicio: a.horaInicio,
    quemResponde: "alice",
    repeteDe: null,
  };
}

export function textoPushPlano(acoes: AcaoPlano[]): { titulo: string; corpo: string } {
  const n = acoes.length;
  return {
    titulo: `Tatiana: ${n === 1 ? "1 ação" : `${n} ações`} para aprovar hoje`,
    corpo: acoes
      .map((a) => a.titulo)
      .join(" · ")
      .slice(0, 160),
  };
}
