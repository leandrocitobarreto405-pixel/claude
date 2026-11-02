/**
 * Histórico completo do contato (02/11/2026): o que a empresa já viveu com este telefone antes da
 * conversa atual: conversas anteriores, orçamentos, serviços (OS) e campanhas recebidas. Regras
 * puras; a leitura do banco fica em historico-contato.server.ts. Vai para a tela de Conversas, para
 * o contexto da Alice e para a ficha da Tatiana.
 */

export type ConversaAnterior = {
  id: string;
  inicio: string;
  fim: string | null;
  status: string | null;
  /** Como terminou ("passou para a equipe: …", "encerrada", "aberta"). */
  resumo: string | null;
};
export type OrcamentoAnterior = {
  numero: string | null;
  data: string;
  total: number;
  status: string;
  /** Virou OS. */
  fechou: boolean;
};
export type ServicoAnterior = {
  osNumero: string | null;
  data: string | null;
  servico: string | null;
  total: number;
  status: string | null;
};
export type CampanhaRecebida = { data: string; nome: string; respondeu: boolean };

export type HistoricoContato = {
  /** Primeiro contato com a empresa (lead mais antigo ou primeira conversa). */
  primeiroContato: string | null;
  conversas: ConversaAnterior[];
  orcamentos: OrcamentoAnterior[];
  servicos: ServicoAnterior[];
  campanhas: CampanhaRecebida[];
  /** Nada além da conversa atual. */
  vazio: boolean;
};

export const HISTORICO_VAZIO: HistoricoContato = {
  primeiroContato: null,
  conversas: [],
  orcamentos: [],
  servicos: [],
  campanhas: [],
  vazio: true,
};

const dataBR = (iso: string | null | undefined) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "?";
const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const STATUS_ORCAMENTO: Record<string, string> = {
  rascunho: "rascunho",
  enviado: "enviado, sem fechar",
  aprovado: "aprovado",
  recusado: "recusado",
  convertido: "virou OS",
};

/** Uma frase por item, sem nomes: para a Alice e para a ficha da Tatiana (até ~700 caracteres). */
export function textoHistorico(h: HistoricoContato, limite = 700): string | null {
  if (h.vazio) return null;
  const linhas: string[] = [];
  if (h.primeiroContato) linhas.push(`primeiro contato em ${dataBR(h.primeiroContato)}`);
  if (h.servicos.length) {
    const s = h.servicos
      .slice(0, 3)
      .map(
        (x) =>
          `${dataBR(x.data)}${x.servico ? ` ${x.servico.toLowerCase()}` : ""}${x.osNumero ? ` (OS ${x.osNumero})` : ""} ${brl(x.total)}${x.status ? `, ${x.status.toLowerCase()}` : ""}`,
      );
    linhas.push(
      `${h.servicos.length} ${h.servicos.length === 1 ? "serviço feito" : "serviços feitos"}: ${s.join("; ")}${h.servicos.length > 3 ? "; …" : ""}`,
    );
  }
  if (h.orcamentos.length) {
    const o = h.orcamentos
      .slice(0, 3)
      .map(
        (x) =>
          `${dataBR(x.data)} ${brl(x.total)} (${x.fechou ? "virou OS" : (STATUS_ORCAMENTO[x.status] ?? x.status)})`,
      );
    linhas.push(
      `${h.orcamentos.length} ${h.orcamentos.length === 1 ? "orçamento anterior" : "orçamentos anteriores"}: ${o.join("; ")}${h.orcamentos.length > 3 ? "; …" : ""}`,
    );
  }
  if (h.conversas.length) {
    const c = h.conversas
      .slice(0, 3)
      .map((x) => `${dataBR(x.inicio)}${x.resumo ? ` (${x.resumo})` : ""}`);
    linhas.push(
      `${h.conversas.length} ${h.conversas.length === 1 ? "conversa anterior" : "conversas anteriores"}: ${c.join("; ")}${h.conversas.length > 3 ? "; …" : ""}`,
    );
  }
  if (h.campanhas.length) {
    const k = h.campanhas
      .slice(0, 2)
      .map((x) => `${dataBR(x.data)} "${x.nome}"${x.respondeu ? ", respondeu" : ""}`);
    linhas.push(`campanhas recebidas: ${k.join("; ")}`);
  }
  const texto = linhas.join(". ");
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}

/** Título curto para a tela ("Cliente antigo: 2 serviços, último em 03/2026"). */
export function tituloHistorico(h: HistoricoContato): string {
  if (h.vazio) return "Primeiro contato com a empresa";
  if (h.servicos.length) {
    const ultimo = h.servicos[0]?.data;
    return `Cliente antigo: ${h.servicos.length} ${h.servicos.length === 1 ? "serviço" : "serviços"}${ultimo ? `, último em ${dataBR(ultimo)}` : ""}`;
  }
  if (h.orcamentos.length)
    return `Já pediu orçamento ${h.orcamentos.length === 1 ? "1 vez" : `${h.orcamentos.length} vezes`}, sem fechar`;
  if (h.conversas.length)
    return `Já conversou ${h.conversas.length === 1 ? "1 vez" : `${h.conversas.length} vezes`}, sem orçamento`;
  return "Já recebeu campanha, sem conversa";
}
