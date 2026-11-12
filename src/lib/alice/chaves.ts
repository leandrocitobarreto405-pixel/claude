/**
 * Chaves e parâmetros do plano "Alice e vendas" (migração 20261228530000). Ficam em
 * ia_configuracoes e começam todas desligadas; sem a coluna (banco antigo), valem os padrões.
 */
export type ChavesVendas = {
  /** Item 1: orçamento sem mais pergunta para quem já disse item e CEP e pediu o preço; e a foto pedida uma vez só. */
  atalhoApressado: boolean;
  /** Item 3: a Alice orça o combo higienização + impermeabilização. */
  comboLigado: boolean;
  comboPct: number;
};

export function chavesVendas(cfg: unknown): ChavesVendas {
  const c = (cfg ?? {}) as Record<string, unknown>;
  const pct = Number(c["combo_pct"]);
  return {
    atalhoApressado: c["atalho_apressado"] === true,
    comboLigado: c["combo_ligado"] === true,
    comboPct: Number.isFinite(pct) && pct > 0 && pct <= 30 ? pct : 10,
  };
}
