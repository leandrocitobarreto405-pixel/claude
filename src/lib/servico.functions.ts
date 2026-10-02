/**
 * Tela do serviço (técnico no celular): itens do atendimento e o resumo da Alice sobre o que o
 * cliente pediu. Confere o acesso ao atendimento pela sessão (RLS) antes de ler o resto.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import { chaveTelefone } from "@/lib/avisos";

export type ItemServico = {
  descricao: string;
  quantidade: number;
  unitario: number;
  subtotal: number;
};

export type ExtrasServico = {
  itens: ItemServico[];
  desconto: { valor: number; motivo: string | null } | null;
  resumoAlice: string | null;
};

export const extrasDoServicoFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((i: { visitId: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(i.visitId)) throw new Error("Atendimento inválido.");
    return { visitId: i.visitId };
  })
  .handler(async ({ data, context }): Promise<ExtrasServico> => {
    // Acesso pela sessão: se a pessoa não vê o atendimento, não vê nada.
    const { data: v } = await context.supabase
      .from("visits")
      .select(
        "id, discount_amount, discount_reason, work_order:work_order_id ( id, customer:customer_id ( id, phone ) )",
      )
      .eq("id", data.visitId)
      .maybeSingle();
    if (!v) throw new Error("Atendimento não encontrado.");
    const wo = v.work_order as unknown as {
      id: string;
      customer: { id: string; phone: string } | null;
    } | null;
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const [{ data: itens }, leads] = await Promise.all([
      db
        .from("service_items")
        .select("description, quantity, unit_price, subtotal, active, display_order")
        .eq("empresa_id", context.empresaId)
        .eq("visit_id", data.visitId)
        .eq("active", true)
        .order("display_order"),
      wo
        ? db
            .from("crm_leads")
            .select("summary, linked_work_order_id, customer_id, normalized_phone, updated_at")
            .eq("empresa_id", context.empresaId)
            .not("summary", "is", null)
            .or(
              [
                `linked_work_order_id.eq.${wo.id}`,
                wo.customer?.id ? `customer_id.eq.${wo.customer.id}` : null,
              ]
                .filter(Boolean)
                .join(","),
            )
            .order("updated_at", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    let lista = (leads.data ?? []) as Array<{
      summary: string | null;
      linked_work_order_id: string | null;
    }>;
    // Sem vínculo pela OS ou cliente: procura pelo telefone.
    if (!lista.length && wo?.customer?.phone) {
      const chave = chaveTelefone(wo.customer.phone);
      const { data: porFone } = await db
        .from("crm_leads")
        .select("summary, linked_work_order_id, normalized_phone")
        .eq("empresa_id", context.empresaId)
        .not("summary", "is", null)
        .like("normalized_phone", `%${(chave ?? "").slice(-8)}`)
        .order("updated_at", { ascending: false })
        .limit(5);
      lista = (porFone ?? []).filter((l) => chaveTelefone(l.normalized_phone) === chave);
    }
    const resumo =
      lista.find((l) => l.linked_work_order_id === wo?.id)?.summary ?? lista[0]?.summary ?? null;
    const desconto = Number(v.discount_amount ?? 0);
    return {
      itens: (itens ?? []).map((i) => ({
        descricao: i.description ?? "Item",
        quantidade: Number(i.quantity ?? 1),
        unitario: Number(i.unit_price ?? 0),
        subtotal: Number(i.subtotal ?? 0),
      })),
      desconto: desconto > 0 ? { valor: desconto, motivo: v.discount_reason ?? null } : null,
      resumoAlice: resumo?.trim() || null,
    };
  });
