import { test } from "node:test";
import assert from "node:assert/strict";
import { travaDoToque } from "./cadencia.server";

/** Banco falso: mensagens da equipe e lead conforme o teste; o resto vazio. */
function banco(o: { equipeEscreveu?: boolean }) {
  const consulta = (tabela: string) => {
    const q: Record<string, unknown> = {};
    const fim = () =>
      Promise.resolve({
        data:
          tabela === "whatsapp_messages"
            ? o.equipeEscreveu
              ? [{ id: "m1" }]
              : []
            : tabela === "crm_leads"
              ? { id: "l1", is_open: true, customer_id: null }
              : [],
        error: null,
      });
    for (const m of ["select", "eq", "gt", "gte", "neq", "limit", "order", "is"]) q[m] = () => q;
    q["maybeSingle"] = fim;
    q["then"] = (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => fim().then(r, j);
    return q;
  };
  return { from: consulta } as never;
}

const base = {
  empresaId: "e1",
  contato: { ia_desligada: false, sem_pos_venda: false, marketing_optout_em: null },
  desde: new Date("2026-10-27T11:00:00Z"),
};

test("retomada: conversa encerrada não é 'equipe assumiu'", async () => {
  const conversa = { id: "c1", status: "resolved", crm_lead_id: "l1", assumida_por: null };
  assert.equal(await travaDoToque(banco({}), { ...base, conversa, retomada: true }), null);
  assert.equal(await travaDoToque(banco({}), { ...base, conversa }), "equipe assumiu a conversa");
});

test("retomada: conversa aberta sem dono passa; com dono ou com mensagem da equipe, não", async () => {
  const aberta = { id: "c1", status: "open", crm_lead_id: "l1", assumida_por: null };
  assert.equal(await travaDoToque(banco({}), { ...base, conversa: aberta, retomada: true }), null);
  assert.equal(
    await travaDoToque(banco({}), {
      ...base,
      conversa: { ...aberta, assumida_por: "u1" },
      retomada: true,
    }),
    "equipe assumiu a conversa",
  );
  assert.equal(
    await travaDoToque(banco({ equipeEscreveu: true }), {
      ...base,
      conversa: aberta,
      retomada: true,
    }),
    "equipe escreveu para o cliente",
  );
});
