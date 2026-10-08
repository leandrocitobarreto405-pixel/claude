/**
 * Orçamento da Alice: preço de cada item pela tabela + classe/acréscimos da empresa (arredondado
 * para o real de cima), desconto de campanha OU indicação e Pix por cima. A Alice nunca informa
 * preço: só item, quantidade, classe e as marcações. Função pura (ferramenta e testes).
 */
import {
  acrescimoDoItem,
  descontoPorPct,
  precoComAcrescimo,
  rotulosAcrescimo,
  type Classe,
  type RegrasOrcamento,
} from "@/lib/orcamento-regras";
import { condicoesPagamento, type Condicoes } from "./regras";

export type Servico = "higienizacao" | "impermeabilizacao";

export type ItemTabela = {
  id: string;
  nome: string;
  preco_higienizacao: number;
  preco_impermeabilizacao: number | null;
};

export type PedidoItem = {
  item: ItemTabela;
  quantidade: number;
  classe?: Classe | undefined;
  almofadas_soltas?: boolean | undefined;
  muito_encardido?: boolean | undefined;
};

export type LinhaOrcamento = {
  item: ItemTabela;
  quantidade: number;
  precoTabela: number;
  acrescimoPct: number;
  preco: number;
  rotulos: string[];
  classe: Classe | null;
  almofadasSoltas: boolean;
  muitoEncardido: boolean;
};

export function precoDe(item: ItemTabela, servico: Servico): number | null {
  const v = servico === "higienizacao" ? item.preco_higienizacao : item.preco_impermeabilizacao;
  return v === null || v === undefined || Number(v) <= 0 ? null : Number(v);
}

/** Preço de cada item pelas regras; null quando o item não tem preço para o serviço. */
export function precificar(
  pedido: PedidoItem,
  servico: Servico,
  regras: RegrasOrcamento,
): LinhaOrcamento | null {
  const precoTabela = precoDe(pedido.item, servico);
  if (precoTabela === null) return null;
  const marcas = {
    classe: regras.classe.ligada ? (pedido.classe ?? "B") : null,
    almofadasSoltas: regras.acrescimos.ligado && Boolean(pedido.almofadas_soltas),
    muitoEncardido: regras.acrescimos.ligado && Boolean(pedido.muito_encardido),
  };
  const acrescimoPct = acrescimoDoItem(regras, marcas);
  return {
    item: pedido.item,
    quantidade: pedido.quantidade,
    precoTabela,
    acrescimoPct,
    preco: precoComAcrescimo(precoTabela, acrescimoPct),
    rotulos: rotulosAcrescimo(regras, marcas),
    classe: marcas.classe,
    almofadasSoltas: marcas.almofadasSoltas,
    muitoEncardido: marcas.muitoEncardido,
  };
}

export type Totais = {
  bruto: number;
  desconto: { pct: number; rotulo: string; valor: number } | null;
  cond: Condicoes;
};

/** Total: soma dos itens → desconto (campanha OU indicação) → Pix e parcelas sobre o resultado. */
export function totalizar(
  linhas: LinhaOrcamento[],
  desconto: { pct: number; rotulo: string } | null,
  parcelasMax: number,
  pixPct: number,
): Totais {
  const bruto = Math.round(linhas.reduce((s, l) => s + l.preco * l.quantidade, 0) * 100) / 100;
  const d = desconto ? { ...desconto, valor: descontoPorPct(bruto, desconto.pct) } : null;
  const total = Math.round((bruto - (d?.valor ?? 0)) * 100) / 100;
  return { bruto, desconto: d, cond: condicoesPagamento(total, parcelasMax, pixPct) };
}
