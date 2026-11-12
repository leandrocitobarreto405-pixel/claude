/**
 * Custo das chamadas de IA que não são da conversa da Alice nem da Tatiana (11/11): preço por
 * modelo e a linha que vai para a tabela ia_chamadas. Regras puras, sem banco.
 */
import {
  MODELO_HAIKU,
  MODELO_OPUS,
  PRECO_HAIKU,
  PRECO_OPUS,
  PRECO_SONNET,
  custoUsd,
  type Precos,
  type Uso,
} from "@/lib/comercial/ficha";

/** De onde veio a chamada (vira a coluna "origem"). */
export const ORIGENS_CHAMADA = [
  "classificador_toque",
  "classificador_site",
  "classificador_temperatura",
  "retorno_combinado",
  "toque_equipe",
] as const;
export type OrigemChamada = (typeof ORIGENS_CHAMADA)[number];

/** Haiku 4.5 (chamadas antigas que ainda não mudaram de modelo), US$ por milhão de tokens. */
export const PRECO_HAIKU_45: Precos = { entrada: 1, cacheGravar: 1.25, cacheLer: 0.1, saida: 5 };

export function precoDoModelo(modelo: string): Precos {
  if (modelo === MODELO_HAIKU) return PRECO_HAIKU;
  if (modelo === MODELO_OPUS) return PRECO_OPUS;
  if (modelo.startsWith("claude-haiku-4-5")) return PRECO_HAIKU_45;
  return PRECO_SONNET;
}

/** Linha de ia_chamadas. Sem uso (chamada que falhou): custo zero e ok = false. */
export function linhaDaChamada(o: {
  empresaId: string;
  origem: OrigemChamada;
  modelo: string;
  uso: Uso | null;
  referencia?: string | null;
}) {
  const u = o.uso;
  return {
    empresa_id: o.empresaId,
    origem: o.origem,
    modelo: o.modelo,
    tokens_entrada: u?.input_tokens ?? 0,
    tokens_saida: u?.output_tokens ?? 0,
    tokens_cache_gravados: u?.cache_creation_input_tokens ?? 0,
    tokens_cache_lidos: u?.cache_read_input_tokens ?? 0,
    custo_usd: u ? custoUsd(u, precoDoModelo(o.modelo)) : 0,
    ok: Boolean(u),
    referencia: o.referencia ? o.referencia.slice(0, 80) : null,
  };
}
