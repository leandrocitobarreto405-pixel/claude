/**
 * Quem vendeu a OS (decisão E): a equipe Nexa (atendente da Nexa ou Alice) ou a equipe da
 * empresa. Vale o gravado na OS; sem ele, pela vendedora (atendente da Nexa).
 * As telas separam "Vendas da Nexa" e "Da empresa" só quando a empresa tem venda da Nexa.
 */
export type QuemVendeu = "todas" | "nexa" | "empresa";

export const OPCOES_QUEM_VENDEU: { id: QuemVendeu; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "nexa", rotulo: "Vendas da Nexa" },
  { id: "empresa", rotulo: "Da empresa" },
];

export type OsQuemVendeu = {
  vendido_por?: string | null;
  vendedora?: { atendente_nexa?: boolean | null } | null;
};

export function vendidaPelaNexa(os: OsQuemVendeu | null | undefined): boolean {
  if (os?.vendido_por === "nexa" || os?.vendido_por === "empresa") return os.vendido_por === "nexa";
  return os?.vendedora?.atendente_nexa === true;
}

export function filtrarQuemVendeu<T extends OsQuemVendeu>(lista: T[], quem: QuemVendeu): T[] {
  if (quem === "todas") return lista;
  return lista.filter((os) => vendidaPelaNexa(os) === (quem === "nexa"));
}

/** Mostrar a separação? Só quando há pelo menos uma venda da Nexa na lista. */
export function temVendaDaNexa(lista: OsQuemVendeu[]): boolean {
  return lista.some(vendidaPelaNexa);
}

export type OsDoResumo = OsQuemVendeu & {
  total_gross_value: number | null;
  status?: string | null;
  cancelled_at?: string | null;
  deleted_at?: string | null;
  eh_teste?: boolean | null;
};

/** Vendido no período por equipe (sem OS de teste, cancelada ou apagada). */
export function resumoPorEquipe(
  lista: OsDoResumo[],
): Record<"nexa" | "empresa", { os: number; valor: number }> {
  const r = { nexa: { os: 0, valor: 0 }, empresa: { os: 0, valor: 0 } };
  for (const os of lista) {
    if (os.eh_teste || os.deleted_at || os.cancelled_at || os.status === "Cancelada") continue;
    const k = vendidaPelaNexa(os) ? "nexa" : "empresa";
    r[k].os += 1;
    r[k].valor = Math.round((r[k].valor + Number(os.total_gross_value ?? 0)) * 100) / 100;
  }
  return r;
}
