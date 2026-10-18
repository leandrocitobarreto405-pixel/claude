/**
 * Serviços terceirizados (ex.: tapete e persiana com um parceiro): o cliente paga o valor cheio,
 * a empresa repassa uma parte ao parceiro e só a receita líquida conta nos números.
 * O custo do parceiro fica congelado na linha da OS (banco); aqui só a conta.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Parte do repasse que corresponde ao que já foi recebido do atendimento (proporcional). */
export function repasseDoRecebido(repasse: number, valorAtendimento: number, recebido: number) {
  const rep = Number(repasse) || 0;
  const valor = Number(valorAtendimento) || 0;
  if (rep <= 0 || valor <= 0 || !recebido) return 0;
  const fracao = Math.max(-1, Math.min(1, recebido / valor));
  return r2(rep * fracao);
}

/** Valor que fica com a empresa: o cobrado menos o repasse (nunca negativo). */
export function valorLiquido(valor: number, repasse: number | null | undefined) {
  return r2(Math.max(0, (Number(valor) || 0) - (Number(repasse) || 0)));
}

/** Despesa "Repasse a parceiro" criada ao concluir: fica fora das despesas do DRE. */
export function despesaDeRepasse(e: { reference_key?: string | null }): boolean {
  return (e.reference_key ?? "").startsWith("repasse:");
}

/** Soma do repasse das visitas de uma OS (embed `visits ( repasse_parceiro )`). */
export function repasseDaOs(
  visitas: { repasse_parceiro?: number | null }[] | { repasse_parceiro?: number | null } | null,
) {
  const lista = Array.isArray(visitas) ? visitas : visitas ? [visitas] : [];
  return r2(lista.reduce((s, v) => s + (Number(v.repasse_parceiro) || 0), 0));
}

/** Três valores da linha (só a equipe vê): cobrado do cliente, repasse e líquido. */
export function valoresDaLinha(subtotal: number, repasse: number | null | undefined) {
  const cobrado = r2(Number(subtotal) || 0);
  const rep = r2(Number(repasse) || 0);
  return { cobrado, repasse: rep, liquido: valorLiquido(cobrado, rep) };
}

/** Repasse estimado no orçamento: custo do parceiro do item da tabela × quantidade. */
export function repasseEstimado(
  linhas: { tabela_preco_item_id: string; tipo_servico: string; quantidade: number }[],
  catalogo: {
    id: string;
    terceirizado?: boolean;
    custo_parceiro?: number | null;
    custo_parceiro_impermeabilizacao?: number | null;
  }[],
) {
  let total = 0;
  for (const l of linhas) {
    const item = catalogo.find((c) => c.id === l.tabela_preco_item_id);
    if (!item?.terceirizado) continue;
    const custo =
      l.tipo_servico === "impermeabilizacao"
        ? item.custo_parceiro_impermeabilizacao
        : item.custo_parceiro;
    total += (Number(custo) || 0) * (Number(l.quantidade) || 0);
  }
  return r2(total);
}
