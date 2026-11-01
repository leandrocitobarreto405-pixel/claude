/**
 * Tatiana, gerente do mês, etapa 3 (02/11/2026): equipe como equipe e relatório de domingo.
 * Regras puras: números da semana da EQUIPE (nunca por pessoa, sem ranking), a linha da meta no
 * recado e o bloco "Mês" do relatório de domingo.
 */
import { fraseDaMeta, type MetaDoMes } from "./mes";

export type SemanaEquipe = {
  /** Últimos 7 dias e os 7 anteriores, sempre da equipe toda. */
  leads: number;
  leadsAnterior: number;
  orcamentos: number;
  orcamentosAnterior: number;
  vendas: number;
  vendasAnterior: number;
  /** Fechado na semana (data da venda), líquido do repasse. */
  vendido: number;
  vendidoAnterior: number;
  tarefasFeitas: number;
  tarefasPuladas: number;
  tarefasPendentes: number;
  acertosResolvidos: number;
  acertosPendentes: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Conta a semana (últimos 7 dias) e a anterior a partir das datas, sem banco. */
export function resumoSemana(o: {
  agora: Date;
  /** Datas (ISO) de entrada dos leads. */
  leads: string[];
  /** Datas de envio dos orçamentos. */
  orcamentos: string[];
  /** Vendas: data da venda e valor líquido. */
  vendas: Array<{ data: string; valor: number }>;
  /** Tarefas da Tatiana para a equipe: situação e quando foi concluída/pulada (ou marcada). */
  tarefas: Array<{ status: string; pulada: boolean; quando: string | null }>;
  /** Acertos no app: situação e quando foram resolvidos. */
  acertos: Array<{ situacao: string; resolvidaEm: string | null }>;
}): SemanaEquipe {
  const t = o.agora.getTime();
  const ini = t - 7 * 86_400_000;
  const iniAnt = t - 14 * 86_400_000;
  const ms = (d: string) => (d.length === 10 ? Date.parse(`${d}T12:00:00-03:00`) : Date.parse(d));
  const semana = (d: string) => ms(d) >= ini;
  const anterior = (d: string) => ms(d) >= iniAnt && ms(d) < ini;
  const vendasSemana = o.vendas.filter((v) => semana(v.data));
  const vendasAnt = o.vendas.filter((v) => anterior(v.data));
  const feitas = o.tarefas.filter((x) => x.status === "Concluída" && x.quando && semana(x.quando));
  const puladas = o.tarefas.filter((x) => x.pulada && x.quando && semana(x.quando));
  return {
    leads: o.leads.filter(semana).length,
    leadsAnterior: o.leads.filter(anterior).length,
    orcamentos: o.orcamentos.filter(semana).length,
    orcamentosAnterior: o.orcamentos.filter(anterior).length,
    vendas: vendasSemana.length,
    vendasAnterior: vendasAnt.length,
    vendido: r2(vendasSemana.reduce((s, v) => s + v.valor, 0)),
    vendidoAnterior: r2(vendasAnt.reduce((s, v) => s + v.valor, 0)),
    tarefasFeitas: feitas.length,
    tarefasPuladas: puladas.length,
    tarefasPendentes: o.tarefas.filter((x) => x.status === "Pendente").length,
    acertosResolvidos: o.acertos.filter((a) => a.resolvidaEm && semana(a.resolvidaEm)).length,
    acertosPendentes: o.acertos.filter((a) => a.situacao === "pendente").length,
  };
}

const brl0 = (v: number) =>
  `R$ ${Math.round(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

/** "23 leads (18 na anterior) · 9 orçamentos (7) · 4 vendas (3) · R$ 2.100 · tarefas: 12 feitas, 2 puladas". */
export function textoSemanaEquipe(s: SemanaEquipe): string {
  const partes = [
    `${s.leads} ${s.leads === 1 ? "lead" : "leads"} (${s.leadsAnterior} na semana anterior)`,
    `${s.orcamentos} ${s.orcamentos === 1 ? "orçamento" : "orçamentos"} (${s.orcamentosAnterior})`,
    `${s.vendas} ${s.vendas === 1 ? "venda" : "vendas"} (${s.vendasAnterior}) · ${brl0(s.vendido)}`,
  ];
  if (s.tarefasFeitas || s.tarefasPuladas || s.tarefasPendentes)
    partes.push(
      `tarefas da Tatiana: ${s.tarefasFeitas} ${s.tarefasFeitas === 1 ? "feita" : "feitas"}, ${s.tarefasPuladas} ${s.tarefasPuladas === 1 ? "pulada" : "puladas"}${s.tarefasPendentes ? `, ${s.tarefasPendentes} ${s.tarefasPendentes === 1 ? "pendente" : "pendentes"}` : ""}`,
    );
  if (s.acertosResolvidos || s.acertosPendentes)
    partes.push(
      `acertos no app: ${s.acertosResolvidos} ${s.acertosResolvidos === 1 ? "resolvido" : "resolvidos"}${s.acertosPendentes ? `, ${s.acertosPendentes} ${s.acertosPendentes === 1 ? "pendente" : "pendentes"}` : ""}`,
    );
  return partes.join(" · ");
}

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Linha da meta para o recado e para o relatório (sem IA). */
export function linhaDaMeta(meta: MetaDoMes, diasVazios: string[]): string {
  const base = fraseDaMeta(meta);
  const vazios = diasVazios.length
    ? ` Agenda vazia em ${diasVazios.map(dataCurta).join(", ")}: vale encaixe.`
    : "";
  return `${base}${vazios}`;
}

/** Bloco "Mês" do relatório de domingo (números do sistema; a IA só lê). */
export type MesRelatorio = {
  frase: string;
  meta: MetaDoMes;
  previsao: { total: number; chegaA: number; pctDaMeta: number | null };
  agenda: { livres: number; base: number; vazios: string[] };
  alertas: string[];
  planos: {
    propostas: number;
    aprovadas: number;
    recusadas: number;
    pendentes: number;
    /** Nomes das campanhas criadas pelo Aprovar na semana. */
    campanhas: string[];
  };
  semana: SemanaEquipe;
};

/** Texto do bloco "Mês" para o prompt do relatório. */
export function textoMesRelatorio(m: MesRelatorio): string[] {
  return [
    `- ${m.frase}`,
    `- Previsão pelos orçamentos abertos: ${brl0(m.previsao.total)} (o mês chega a ${brl0(m.previsao.chegaA)}${m.previsao.pctDaMeta !== null ? `, ${String(m.previsao.pctDaMeta).replace(".", ",")}% da meta` : ""}).`,
    `- Agenda: ${m.agenda.livres} de ${m.agenda.base} horários livres até o fim do mês${m.agenda.vazios.length ? `; dias vazios ${m.agenda.vazios.map(dataCurta).join(", ")}` : ""}.`,
    `- Alertas abertos: ${m.alertas.join("; ") || "nenhum"}.`,
    `- Plano de ação na semana: ${m.planos.propostas} ${m.planos.propostas === 1 ? "ação proposta" : "ações propostas"}, ${m.planos.aprovadas} ${m.planos.aprovadas === 1 ? "aprovada" : "aprovadas"}, ${m.planos.recusadas} ${m.planos.recusadas === 1 ? "recusada" : "recusadas"}${m.planos.pendentes ? `, ${m.planos.pendentes} sem decisão` : ""}${m.planos.campanhas.length ? ` (rascunhos: ${m.planos.campanhas.join(", ")})` : ""}.`,
    `- Semana da equipe: ${textoSemanaEquipe(m.semana)}.`,
  ];
}

export function textoPushRelatorio(periodo: string): { titulo: string; corpo: string } {
  return {
    titulo: "Tatiana: relatório da semana pronto",
    corpo: `${periodo}. Leitura, sugestões e o bloco do mês na tela da Tatiana.`.slice(0, 160),
  };
}
