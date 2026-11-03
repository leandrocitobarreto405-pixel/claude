/**
 * Tatiana, gerente do mês, etapa 1 (02/11/2026): meta diária e alertas de gerente. Regras puras,
 * sem banco nem IA: dias úteis, ritmo, previsão pelos orçamentos abertos × conversão histórica,
 * agenda livre até o fim do mês e os alertas (sem meta, dia vazio, queda de leads por origem,
 * queda de conversão por serviço, objeção mais frequente, agenda vazia).
 */
import { LIMITE_DESCADASTRO_PCT, pctDescadastro } from "./campanhas";
import { horariosLivres, type HorarioBase, type Ocupacao, type RegrasAgenda } from "@/lib/promocao";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function somarDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
export function fimDoMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, "0")}`;
}
export function diaDaSemana(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/**
 * Dias de `de` a `ate` (inclusive) que caem nos dias úteis da empresa (0 = domingo … 6 = sábado)
 * e não estão bloqueados (feriado sem "vamos trabalhar", 02/11).
 */
export function diasUteisEntre(
  de: string,
  ate: string,
  dias: number[],
  bloqueados?: ReadonlyMap<string, unknown> | ReadonlySet<string>,
): string[] {
  const saida: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1))
    if (dias.includes(diaDaSemana(d)) && !bloqueados?.has(d)) saida.push(d);
  return saida;
}

export type MetaDoMes = {
  meta: number | null;
  /** Fechado no mês (data da venda), líquido do repasse. */
  vendidoVenda: number;
  /** Serviço no mês (data do serviço): realizado + agendado + atrasado. */
  vendidoServico: number;
  realizado: number;
  agendado: number;
  atrasado: number;
  falta: number | null;
  pct: number | null;
  diasUteisRestantes: number;
  diasUteisPassados: number;
  /** O que precisa vender por dia útil (pela data do serviço) para bater a meta. */
  ritmoNecessario: number | null;
  /** Média do realizado por dia útil já passado no mês. */
  ritmoAtual: number;
};

export function metaDoMes(o: {
  meta: number | null;
  vendidoVenda: number;
  vendidoServico: { valor: number; realizado: number; agendado: number; atrasado: number };
  hoje: string;
  mes: string;
  diasUteis: number[];
  /** Feriados bloqueados (data → nome): não contam como dia útil. */
  bloqueados?: ReadonlyMap<string, string>;
}): MetaDoMes {
  const inicio = `${o.mes}-01`;
  const fim = fimDoMes(o.mes);
  const restantes = diasUteisEntre(o.hoje, fim, o.diasUteis, o.bloqueados).length;
  const passados = diasUteisEntre(inicio, somarDias(o.hoje, -1), o.diasUteis, o.bloqueados).length;
  const meta = o.meta && o.meta > 0 ? o.meta : null;
  const falta = meta === null ? null : Math.max(0, r2(meta - o.vendidoServico.valor));
  return {
    meta,
    vendidoVenda: o.vendidoVenda,
    vendidoServico: o.vendidoServico.valor,
    realizado: o.vendidoServico.realizado,
    agendado: o.vendidoServico.agendado,
    atrasado: o.vendidoServico.atrasado,
    falta,
    pct: meta === null ? null : Math.round((o.vendidoServico.valor / meta) * 1000) / 10,
    diasUteisRestantes: restantes,
    diasUteisPassados: passados,
    ritmoNecessario: falta === null ? null : restantes > 0 ? r2(falta / restantes) : null,
    ritmoAtual: passados > 0 ? r2(o.vendidoServico.realizado / passados) : 0,
  };
}

// ---------------------------------------------------------------- previsão

export type Servico = "higienizacao" | "impermeabilizacao" | "ambos" | "outro";
export const NOME_SERVICO: Record<Servico, string> = {
  higienizacao: "Higienização",
  impermeabilizacao: "Impermeabilização",
  ambos: "Higienização + impermeabilização",
  outro: "Outros",
};

/** Serviço pelo texto da ficha ("higienização de sofá, impermeabilização"). */
export function servicoDoTexto(s: string | null | undefined): Servico {
  const t = (s ?? "").toLowerCase();
  const h = /higien/.test(t);
  const i = /imperme/.test(t);
  if (h && i) return "ambos";
  if (h) return "higienizacao";
  if (i) return "impermeabilizacao";
  return "outro";
}

/** Serviço pelos itens do orçamento. */
export function servicoDosItens(tipos: string[]): Servico {
  const h = tipos.includes("higienizacao");
  const i = tipos.includes("impermeabilizacao");
  if (h && i) return "ambos";
  if (h) return "higienizacao";
  if (i) return "impermeabilizacao";
  return "outro";
}

export type FichaConversao = {
  servico: string | null;
  resultado: "vendeu" | "perdeu" | "sem_desfecho" | "sem_orcamento" | null;
};

/** Conversão histórica de quem recebeu orçamento, por serviço (fichas da Tatiana). */
export function conversaoPorServico(
  fichas: FichaConversao[],
): Record<Servico, { comOrcamento: number; vendas: number; conversao: number | null }> {
  const base = () => ({ comOrcamento: 0, vendas: 0, conversao: null as number | null });
  const m: Record<Servico, ReturnType<typeof base>> = {
    higienizacao: base(),
    impermeabilizacao: base(),
    ambos: base(),
    outro: base(),
  };
  for (const f of fichas) {
    if (!f.resultado || f.resultado === "sem_orcamento") continue;
    const s = m[servicoDoTexto(f.servico)];
    s.comOrcamento++;
    if (f.resultado === "vendeu") s.vendas++;
  }
  for (const s of Object.values(m))
    s.conversao =
      s.comOrcamento >= 5 ? Math.round((s.vendas / s.comOrcamento) * 1000) / 1000 : null;
  return m;
}

export type OrcamentoAberto = { id: string; total: number; servico: Servico };
export type PrevisaoServico = {
  servico: Servico;
  nome: string;
  orcamentos: number;
  valor: number;
  conversao: number;
  /** De onde veio a conversão: do serviço, da empresa toda ("geral") ou o padrão de 30%. */
  base: "servico" | "geral" | "padrao";
  previsto: number;
};

/** Padrão quando a empresa ainda não tem 5 fichas com orçamento (no serviço nem no total). */
export const CONVERSAO_PADRAO = 0.3;

export function previsaoDosOrcamentos(
  abertos: OrcamentoAberto[],
  conv: ReturnType<typeof conversaoPorServico>,
): { total: number; porServico: PrevisaoServico[] } {
  const todos = Object.values(conv).reduce(
    (t, s) => ({ comOrcamento: t.comOrcamento + s.comOrcamento, vendas: t.vendas + s.vendas }),
    { comOrcamento: 0, vendas: 0 },
  );
  const geral =
    todos.comOrcamento >= 5 ? Math.round((todos.vendas / todos.comOrcamento) * 1000) / 1000 : null;
  const porServico: PrevisaoServico[] = [];
  for (const servico of ["higienizacao", "impermeabilizacao", "ambos", "outro"] as Servico[]) {
    const lista = abertos.filter((a) => a.servico === servico);
    if (!lista.length) continue;
    // "Outros" (sem serviço reconhecido) usa a conversão da empresa toda, nunca a do próprio balde.
    const doServico = servico === "outro" ? null : conv[servico].conversao;
    const [conversao, base]: [number, PrevisaoServico["base"]] =
      doServico !== null
        ? [doServico, "servico"]
        : geral !== null
          ? [geral, "geral"]
          : [CONVERSAO_PADRAO, "padrao"];
    const valor = r2(lista.reduce((s, a) => s + a.total, 0));
    porServico.push({
      servico,
      nome: NOME_SERVICO[servico],
      orcamentos: lista.length,
      valor,
      conversao,
      base,
      previsto: r2(valor * conversao),
    });
  }
  return { total: r2(porServico.reduce((s, p) => s + p.previsto, 0)), porServico };
}

// ---------------------------------------------------------------- agenda

export type DiaAgenda = {
  data: string;
  base: number;
  ocupados: number;
  livres: number;
  /** Nome do feriado bloqueado (dia sem atendimento: base 0). */
  feriado?: string;
};

/**
 * Agenda por dia útil de `de` a `ate`: horários base, ocupados e livres pela capacidade real
 * (sobreposição pela duração e dia inteiro, 02/11). Feriado bloqueado entra na lista com base 0,
 * só para mostrar; não conta como vazio nem como livre.
 */
export function agendaPorDia(o: {
  de: string;
  ate: string;
  diasUteis: number[];
  base: HorarioBase[];
  ocupacoes: Map<string, Ocupacao[]>;
  regras?: RegrasAgenda;
  feriados?: ReadonlyMap<string, string>;
}): DiaAgenda[] {
  return diasUteisEntre(o.de, o.ate, o.diasUteis).map((data) => {
    const feriado = o.feriados?.get(data);
    if (feriado) return { data, base: 0, ocupados: 0, livres: 0, feriado };
    const dia = diaDaSemana(data);
    const base = o.base.filter((b) => b.diaSemana === dia).length;
    const livres = horariosLivres(o.base, o.ocupacoes.get(data) ?? [], data, o.regras).length;
    return { data, base, ocupados: Math.max(0, base - livres), livres };
  });
}

/** Próximos N dias úteis (a partir de amanhã) com horário base e nenhum atendimento. */
export function diasVazios(dias: DiaAgenda[], hoje: string, n = 3): DiaAgenda[] {
  return dias
    .filter((d) => d.data > hoje)
    .slice(0, n)
    .filter((d) => d.base > 0 && d.ocupados === 0);
}

// ---------------------------------------------------------------- alertas

export type TipoAlerta =
  | "sem_meta"
  | "dia_vazio"
  | "queda_leads"
  | "queda_conversao"
  | "objecao"
  | "agenda_vazia"
  | "descadastro";
export type Alerta = {
  tipo: TipoAlerta;
  /** Única por semana/dia: o aviso e o push saem uma vez por chave. */
  chave: string;
  titulo: string;
  texto: string;
  gravidade: "alta" | "media";
};

export type LeadsOrigem = { origem: string; atual: number; media4: number };
export type ConversaoServicoPeriodo = {
  servico: Servico;
  /** Últimos 28 dias. */
  atual: { comOrcamento: number; vendas: number };
  /** 28 dias anteriores. */
  anterior: { comOrcamento: number; vendas: number };
};
export type Objecao = { nome: string; n: number };

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Segunda-feira da semana de `hoje` (chave semanal dos alertas). */
export function semanaDe(hoje: string): string {
  const d = diaDaSemana(hoje);
  return somarDias(hoje, -((d + 6) % 7));
}

export function alertasDoMes(o: {
  hoje: string;
  mes: string;
  meta: number | null;
  agenda: DiaAgenda[];
  leadsPorOrigem: LeadsOrigem[];
  conversaoPorServico: ConversaoServicoPeriodo[];
  /** Objeções/motivos de perda dos últimos 14 dias, em ordem de frequência. */
  objecoes: Objecao[];
  perdidos14d: number;
  /** Campanhas acompanhadas nos últimos 45 dias (descadastro acima de 5% vira alerta, 02/11). */
  campanhas?: Array<{ id: string; nome: string; enviados: number; descadastros: number }>;
}): Alerta[] {
  const semana = semanaDe(o.hoje);
  const alertas: Alerta[] = [];
  if (o.meta === null)
    alertas.push({
      tipo: "sem_meta",
      chave: `sem_meta:${o.mes}`,
      titulo: "Sem meta cadastrada para o mês",
      texto: "Cadastre a meta mensal em Configurações › Empresa para a Tatiana acompanhar o ritmo.",
      gravidade: "media",
    });
  for (const d of diasVazios(o.agenda, o.hoje))
    alertas.push({
      tipo: "dia_vazio",
      chave: `dia_vazio:${d.data}`,
      titulo: `Agenda vazia em ${dataCurta(d.data)}`,
      texto: `${d.base} ${d.base === 1 ? "horário livre" : "horários livres"} e nenhum atendimento marcado. Vale um encaixe ou a promoção da agenda.`,
      gravidade: "alta",
    });
  for (const l of o.leadsPorOrigem)
    if (l.media4 >= 5 && l.atual <= l.media4 * 0.5)
      alertas.push({
        tipo: "queda_leads",
        chave: `queda_leads:${l.origem}:${semana}`,
        titulo: `Menos leads de ${l.origem}`,
        texto: `${l.atual} nos últimos 7 dias contra uma média de ${Math.round(l.media4)} por semana nas 4 anteriores.`,
        gravidade: "alta",
      });
  for (const c of o.conversaoPorServico) {
    if (c.atual.comOrcamento < 10 || c.anterior.comOrcamento < 10) continue;
    const a = c.atual.vendas / c.atual.comOrcamento;
    const b = c.anterior.vendas / c.anterior.comOrcamento;
    if (b - a >= 0.1)
      alertas.push({
        tipo: "queda_conversao",
        chave: `queda_conversao:${c.servico}:${semana}`,
        titulo: `Conversão de ${NOME_SERVICO[c.servico].toLowerCase()} caiu`,
        texto: `${Math.round(a * 100)}% de quem recebeu orçamento fechou nos últimos 28 dias, contra ${Math.round(b * 100)}% nos 28 anteriores.`,
        gravidade: "media",
      });
  }
  const top = o.objecoes[0];
  if (top && top.n >= 3 && o.perdidos14d > 0 && top.n / o.perdidos14d >= 0.4)
    alertas.push({
      tipo: "objecao",
      chave: `objecao:${semana}`,
      titulo: `Objeção mais frequente: ${top.nome}`,
      texto: `${top.n} de ${o.perdidos14d} perdas dos últimos 14 dias. Vale ajustar a resposta da equipe e da Alice para esse caso.`,
      gravidade: "media",
    });
  const proximos = o.agenda.filter((d) => d.data > o.hoje).slice(0, 6);
  const base = proximos.reduce((s, d) => s + d.base, 0);
  const livres = proximos.reduce((s, d) => s + d.livres, 0);
  if (base >= 6 && livres / base >= 0.6)
    alertas.push({
      tipo: "agenda_vazia",
      chave: `agenda_vazia:${semana}`,
      titulo: `Agenda quase vazia nos próximos ${proximos.length} dias úteis`,
      texto: `${livres} de ${base} horários livres nos próximos ${proximos.length} dias úteis.`,
      gravidade: "alta",
    });
  for (const k of o.campanhas ?? []) {
    const pct = pctDescadastro(k);
    if (k.enviados >= 20 && pct !== null && pct > LIMITE_DESCADASTRO_PCT)
      alertas.push({
        tipo: "descadastro",
        chave: `descadastro:${k.id}`,
        titulo: `Descadastro de ${String(pct).replace(".", ",")}% na campanha ${k.nome}`,
        texto: `${k.descadastros} de ${k.enviados} pediram para parar (limite ${LIMITE_DESCADASTRO_PCT}%). Antes de mandar de novo para essa lista, rever texto, oferta e frequência.`,
        gravidade: "alta",
      });
  }
  return alertas;
}

/** Texto do push ao admin: um alerta ou vários. */
export function textoPushAlertas(alertas: Alerta[]): { titulo: string; corpo: string } {
  if (alertas.length === 1)
    return { titulo: `Tatiana: ${alertas[0]!.titulo}`, corpo: alertas[0]!.texto.slice(0, 160) };
  return {
    titulo: `Tatiana: ${alertas.length} alertas do mês`,
    corpo: alertas
      .map((a) => a.titulo)
      .join(" · ")
      .slice(0, 160),
  };
}

export function fraseDaMeta(m: MetaDoMes): string {
  if (m.meta === null) return "Sem meta cadastrada.";
  if (m.falta === 0) return `Meta de ${brl(m.meta)} batida pela data do serviço.`;
  const ritmo = m.ritmoNecessario === null ? "" : ` São ${brl(m.ritmoNecessario)} por dia útil.`;
  return `Faltam ${brl(m.falta ?? 0)} para ${brl(m.meta)}, com ${m.diasUteisRestantes} ${m.diasUteisRestantes === 1 ? "dia útil" : "dias úteis"}.${ritmo}`;
}
