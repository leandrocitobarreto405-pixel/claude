import { test } from "node:test";
import assert from "node:assert/strict";
import { temAgendamento } from "./agendamento.server";

/** Banco falso: cada tabela devolve as linhas dadas (os filtros não importam aqui). */
function banco(t: Record<string, unknown[]>) {
  return {
    from(tabela: string) {
      const linhas = t[tabela] ?? [];
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: linhas, error: null }),
        maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
      };
      return q;
    },
  };
}

const ctx = (t: Record<string, unknown[]>) =>
  ({ admin: banco(t), empresaId: "e", conversaId: "c" }) as unknown as Parameters<
    typeof temAgendamento
  >[0];

test("foto do técnico: só com agendamento fechado", async () => {
  // Só escolheu a opção do orçamento (sem OS, sem visita): não.
  assert.equal(
    await temAgendamento(
      ctx({
        work_order_history: [],
        conversas: [{ crm_lead_id: "l" }],
        crm_leads: [{ linked_work_order_id: null, agendado_em: null }],
      }),
    ),
    false,
  );
  // OS reservada pela Alice nesta conversa: sim.
  assert.equal(
    await temAgendamento(
      ctx({
        work_order_history: [
          { work_orders: { id: "w", os_number: "1", status: "Agendado", deleted_at: null } },
        ],
      }),
    ),
    true,
  );
  // OS cancelada não conta; visita marcada pela equipe no lead conta.
  assert.equal(
    await temAgendamento(
      ctx({
        work_order_history: [
          { work_orders: { id: "w", os_number: "1", status: "Cancelada", deleted_at: null } },
        ],
        conversas: [{ crm_lead_id: "l" }],
        crm_leads: [{ linked_work_order_id: null, agendado_em: "2026-11-02T13:00:00Z" }],
      }),
    ),
    true,
  );
});
