/**
 * Orçamento da Alice: preço de cada item pela tabela + classe/acréscimos da empresa (arredondado
 * para o real de cima), um desconto (campanha, indicação ou cupom) e Pix por cima. A Alice nunca informa
 * preço: só item, quantidade, classe e as marcações. Função pura (ferramenta e testes).
 */
import { normalizarQuantidade, unidadeDaCategoria } from "@/lib/unidade";
import {
  acrescimoDoItem,
  descontoPorPct,
  precoComAcrescimo,
  rotulosAcrescimo,
  type Classe,
  type RegrasOrcamento,
} from "@/lib/orcamento-regras";
import { condicoesPagamento, type Condicoes } from "./regras";
import { ehColchao } from "@/lib/dupla-face";

export type Servico = "higienizacao" | "impermeabilizacao";

export type ItemTabela = {
  id: string;
  nome: string;
  preco_higienizacao: number;
  preco_impermeabilizacao: number | null;
  /** tapete = cobrado por m²; tapete/persiana = limpeza. */
  categoria?: string | null;
};

export type PedidoItem = {
  item: ItemTabela;
  quantidade: number;
  classe?: Classe | undefined;
  almofadas_soltas?: boolean | undefined;
  muito_encardido?: boolean | undefined;
  /** Colchão dupla face (só vale em item de colchão, com a regra ligada). */
  dupla_face?: boolean | undefined;
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
  duplaFace?: boolean;
  /** Adicional pós-fechamento (preço fixo, fora do desconto). */
  adicional?: boolean;
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
    duplaFace:
      regras.duplaFace.ligada &&
      ehColchao(pedido.item.categoria ?? pedido.item.nome) &&
      Boolean(pedido.dupla_face),
  };
  const acrescimoPct = acrescimoDoItem(regras, marcas);
  return {
    item: pedido.item,
    // Tapete: m² com vírgula (até 2 casas); o resto: peças inteiras.
    quantidade: normalizarQuantidade(pedido.quantidade, unidadeDaCategoria(pedido.item.categoria)),
    precoTabela,
    acrescimoPct,
    preco: precoComAcrescimo(precoTabela, acrescimoPct),
    rotulos: rotulosAcrescimo(regras, marcas),
    classe: marcas.classe,
    almofadasSoltas: marcas.almofadasSoltas,
    muitoEncardido: marcas.muitoEncardido,
    duplaFace: marcas.duplaFace,
  };
}

export type Totais = {
  bruto: number;
  /** pct null = desconto em reais (cupom). */
  desconto: { pct: number | null; rotulo: string; valor: number } | null;
  cond: Condicoes;
};

/**
 * Total: soma dos itens (com o acréscimo por distância já dentro do preço de cada item) → um
 * desconto (campanha OU indicação em %, ou cupom em reais, nunca acima da base) → Pix e parcelas
 * sobre o resultado. `bruto` é a soma como o cliente vê (com o acréscimo).
 */
export function totalizar(
  linhas: LinhaOrcamento[],
  desconto: { pct: number; rotulo: string } | { valor: number; rotulo: string } | null,
  parcelasMax: number,
  pixPct: number,
  taxaDeslocamento = 0,
): Totais {
  const soma = (ls: LinhaOrcamento[]) =>
    Math.round(ls.reduce((s, l) => s + l.preco * l.quantidade, 0) * 100) / 100;
  const taxa = Math.max(taxaDeslocamento, 0);
  const bruto = Math.round((soma(linhas) + taxa) * 100) / 100;
  // Desconto só nos itens normais (o adicional já tem preço especial), com o acréscimo dentro.
  const baseDesconto = Math.round((soma(linhas.filter((l) => !l.adicional)) + taxa) * 100) / 100;
  const d = !desconto
    ? null
    : "pct" in desconto
      ? {
          pct: desconto.pct,
          rotulo: desconto.rotulo,
          valor: descontoPorPct(baseDesconto, desconto.pct),
        }
      : {
          pct: null,
          rotulo: desconto.rotulo,
          valor: Math.round(Math.min(Math.max(desconto.valor, 0), baseDesconto) * 100) / 100,
        };
  const total = Math.round((bruto - (d?.valor ?? 0)) * 100) / 100;
  return { bruto, desconto: d, cond: condicoesPagamento(total, parcelasMax, pixPct) };
}
