/**
 * Busca das OS para o Vendido pela data do serviço (regras em vendido.ts): as OS com alguma visita
 * agendada ou concluída no intervalo, com TODAS as visitas (o rateio do desconto da OS precisa de
 * todas, mesmo as de outros meses). Roda com o cliente da pessoa (RLS da empresa ativa).
 */
import type { Banco } from "@/lib/banco";
import { SELECT_OS_VENDIDO } from "@/lib/consultas";
import type { OsVendido } from "@/lib/vendido";

type OsBruta = Omit<OsVendido, "visitas" | "origem"> & {
  sales_origin: { name: string } | null;
  visits: OsVendido["visitas"] | null;
};

export function paraOsVendido(o: OsBruta): OsVendido {
  return {
    id: o.id,
    os_number: o.os_number,
    total_gross_value: o.total_gross_value,
    status: o.status,
    eh_teste: o.eh_teste,
    deleted_at: o.deleted_at,
    sale_date: o.sale_date ?? null,
    origem: o.sales_origin?.name ?? null,
    visitas: o.visits ?? [],
  };
}

export async function buscarOsPorId(db: Banco, ids: string[]): Promise<OsVendido[]> {
  const unicos = [...new Set(ids)];
  const lotes: string[][] = [];
  for (let i = 0; i < unicos.length; i += 150) lotes.push(unicos.slice(i, i + 150));
  const resultados = await Promise.all(
    lotes.map((lote) => db.from("work_orders").select(SELECT_OS_VENDIDO).in("id", lote)),
  );
  const oss: OsVendido[] = [];
  for (const r of resultados) {
    if (r.error) throw r.error;
    for (const o of (r.data ?? []) as unknown as OsBruta[]) oss.push(paraOsVendido(o));
  }
  return oss;
}

/** OS com visita (não cancelada) agendada ou concluída entre `de` e `ate`. */
export async function buscarOsDoPeriodo(db: Banco, de: string, ate: string): Promise<OsVendido[]> {
  const { data, error } = await db
    .from("visits")
    .select("work_order_id")
    .neq("status", "Cancelado")
    .or(
      `and(scheduled_date.gte.${de},scheduled_date.lte.${ate}),and(completion_date.gte.${de},completion_date.lte.${ate})`,
    );
  if (error) throw error;
  const ids = (data ?? []).map((v) => v.work_order_id as string).filter(Boolean);
  return ids.length ? buscarOsPorId(db, ids) : [];
}
