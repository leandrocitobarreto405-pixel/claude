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
  contato: {
    ia_desligada: false,
    sem_pos_venda: false,
    marketing_optout_em: null as string | null,
  },
  desde: new Date("2026-10-27T11:00:00Z"),
};

// Vale para todos os toques (A, B e a retomada R): a regra é a mesma.
test("conversa encerrada (inclusive por inatividade) não é 'equipe assumiu'", async () => {
  const encerrada = { id: "c1", status: "resolved", crm_lead_id: "l1", assumida_por: null };
  assert.equal(await travaDoToque(banco({}), { ...base, conversa: encerrada }), null);
  // Encerrada com a Alice como última responsável no Chatwoot: também passa.
  assert.equal(
    await travaDoToque(banco({}), {
      ...base,
      conversa: { ...encerrada, responsavel_id: 7 },
      botId: 7,
    }),
    null,
  );
});

test("conversa com a Alice (pending) passa", async () => {
  const comAlice = { id: "c1", status: "pending", crm_lead_id: "l1", responsavel_id: 7 };
  assert.equal(await travaDoToque(banco({}), { ...base, conversa: comAlice, botId: 7 }), null);
});

test("aberta sem dono passa; assumida, com pessoa responsável ou com mensagem da equipe, trava", async () => {
  const aberta = { id: "c1", status: "open", crm_lead_id: "l1", assumida_por: null };
  assert.equal(await travaDoToque(banco({}), { ...base, conversa: aberta }), null);
  assert.equal(
    await travaDoToque(banco({}), { ...base, conversa: { ...aberta, assumida_por: "u1" } }),
    "equipe assumiu a conversa",
  );
  assert.equal(
    await travaDoToque(banco({}), {
      ...base,
      conversa: { ...aberta, responsavel_id: "12" },
      botId: 7,
    }),
    "equipe assumiu a conversa",
  );
  assert.equal(
    await travaDoToque(banco({}), {
      ...base,
      conversa: { ...aberta, responsavel_id: 7 },
      botId: 7,
    }),
    null,
  );
  assert.equal(
    await travaDoToque(banco({ equipeEscreveu: true }), { ...base, conversa: aberta }),
    "equipe escreveu para o cliente",
  );
  // Encerrada, mas a equipe escreveu depois do início da trilha: trava.
  assert.equal(
    await travaDoToque(banco({ equipeEscreveu: true }), {
      ...base,
      conversa: { ...aberta, status: "resolved" },
    }),
    "equipe escreveu para o cliente",
  );
});

test("as outras travas seguem iguais", async () => {
  const comAlice = { id: "c1", status: "pending", crm_lead_id: "l1" };
  const contato = (c: Partial<typeof base.contato>) => ({ ...base.contato, ...c });
  assert.equal(
    await travaDoToque(banco({}), {
      ...base,
      conversa: comAlice,
      contato: contato({ ia_desligada: true }),
    }),
    "IA desligada para o cliente",
  );
  assert.equal(
    await travaDoToque(banco({}), {
      ...base,
      conversa: { ...comAlice, status: "resolved" },
      contato: contato({ marketing_optout_em: "2026-10-01T00:00:00Z" }),
    }),
    "cliente pediu para não receber mensagens",
  );
  assert.equal(
    await travaDoToque(banco({}), { ...base, conversa: { ...comAlice, crm_lead_id: null } }),
    "sem lead",
  );
});
