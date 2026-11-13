// A leitura da Tatiana nunca cancela tarefa que não é dela (13/11): transferência da Alice,
// pedido de autorização de desconto e retorno combinado pela equipe. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tarefaDaTatiana } from "./campanha-saida";
import { mandarParaCampanha } from "./campanha-saida.server";

/** Banco que falha se for usado: a tarefa alheia tem de ser recusada antes de qualquer escrita. */
const bancoProibido = {
  from: () => {
    throw new Error("não podia mexer no banco");
  },
} as never;
const base = { id: "t1", crm_lead_id: "l1", tarefa_tipo: "mensagem" };

test("transferência da Alice (manhã, P2 ou sem prioridade): a Tatiana não cancela", async () => {
  // Como a tarefa da Gabi em 12/11 (sem a marca nova) e como ficam as novas (com a marca).
  const antiga = {
    origem: "gerente",
    notes: "🤖 Alice transferiu: CEP fora da área. Cliente fictícia, ~38,4 km da base.",
    motivo:
      "A Alice transferiu fora do horário (CEP fora da área) e disse ao cliente que a resposta vem logo cedo. Responder primeiro.",
  };
  const nova = {
    origem: "gerente",
    notes: "🤖 Alice transferiu: combo. Resumo. [transferencia]",
    motivo: null,
  };
  assert.equal(tarefaDaTatiana(antiga), false);
  assert.equal(tarefaDaTatiana(nova), false);
  // Nem a saída para a campanha (mesmo sem P1) tira a tarefa.
  assert.equal(
    await mandarParaCampanha(bancoProibido, "emp", { ...base, prioridade: 2, notes: nova.notes }),
    false,
  );
});

test("pedido de autorização de desconto à noite: a Tatiana não cancela", async () => {
  const t = {
    origem: "gerente",
    notes: "[autorizacao:aaaa-bbbb]",
    motivo:
      "Pedido de desconto da Alice à noite: orçamento R$ 359,00, sugerido R$ 316,00. Responder em Follow-ups › Autorizações.",
  };
  assert.equal(tarefaDaTatiana(t), false);
  assert.equal(
    await mandarParaCampanha(bancoProibido, "emp", { ...base, prioridade: 2, notes: t.notes }),
    false,
  );
});

test("retorno combinado pela equipe (Agendar retorno): não é da Tatiana", () => {
  assert.equal(tarefaDaTatiana({ origem: null, notes: null, motivo: null }), false);
  assert.equal(
    tarefaDaTatiana({ origem: null, notes: "Retorno combinado: cliente vai ver com o marido" }),
    false,
  );
});

test("as tarefas da própria Tatiana continuam com ela", () => {
  assert.equal(
    tarefaDaTatiana({
      origem: "gerente",
      notes: "Tatiana: cliente pediu orçamento e sumiu",
      motivo: "Retomar",
    }),
    true,
  );
});
