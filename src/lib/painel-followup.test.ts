import { test } from "node:test";
import assert from "node:assert/strict";
import {
  funilAliceEquipe,
  motivoDoCancelado,
  nomeDoToque,
  porSemana,
  porToque,
  semanaDe,
  type ToqueBruto,
} from "./painel-followup";

const toque = (p: Partial<ToqueBruto>): ToqueBruto => ({
  trilha: "A",
  etapa: "A1",
  status: "Concluída",
  canal: "texto",
  result: null,
  scheduled_at: "2026-10-27T13:00:00Z",
  respondido_em: null,
  crm_lead_id: null,
  ...p,
});

test("motivo de cancelamento agrupado", () => {
  assert.equal(motivoDoCancelado("cliente respondeu"), "respondeu");
  assert.equal(motivoDoCancelado("equipe assumiu a conversa"), "equipe");
  assert.equal(motivoDoCancelado("atendente humano assumiu"), "equipe");
  assert.equal(motivoDoCancelado('contexto: cliente fechou com outra empresa ("…")'), "contexto");
  assert.equal(motivoDoCancelado("substituído por um novo follow-up"), "remarcado");
  assert.equal(motivoDoCancelado("Alice avaliou que não era preciso enviar"), "outros");
});

test("nome do toque", () => {
  assert.equal(nomeDoToque({ trilha: "A", etapa: "A2" }), "A2");
  assert.equal(nomeDoToque({ trilha: "A", etapa: "R" }), "R");
  assert.equal(nomeDoToque({ trilha: "C", etapa: null }), "C");
  assert.equal(nomeDoToque({ trilha: "B", etapa: null }), "B (avulso)");
});

test("por toque: enviados, responderam, viraram OS depois do toque, cancelados e fila", () => {
  const os = new Map([
    ["l1", "2026-10-28T10:00:00Z"],
    ["l2", "2026-10-20T10:00:00Z"],
  ]);
  const r = porToque(
    [
      toque({ crm_lead_id: "l1", respondido_em: "2026-10-27T14:00:00Z" }),
      toque({ crm_lead_id: "l2" }), // OS antes do toque: não conta
      toque({ status: "Cancelada", canal: null, result: "cliente respondeu" }),
      toque({ status: "Pendente", canal: null }),
      toque({ etapa: "B1", trilha: "B" }),
      toque({ etapa: "R", canal: "modelo" }),
    ],
    os,
  );
  assert.deepEqual(
    r.map((l) => l.toque),
    ["A1", "B1", "R"],
  );
  const a1 = r[0]!;
  assert.equal(a1.agendados, 4);
  assert.equal(a1.enviados, 2);
  assert.equal(a1.responderam, 1);
  assert.equal(a1.viraramOs, 1);
  assert.equal(a1.cancelados.respondeu, 1);
  assert.equal(a1.pendentes, 1);
});

test("semana começa na segunda (São Paulo)", () => {
  // Terça 27/10 → segunda 26/10; domingo 01/11 às 23h de SP (02:00Z do dia 2) → segunda 26/10.
  assert.equal(semanaDe("2026-10-27T13:00:00Z"), "2026-10-26");
  assert.equal(semanaDe("2026-11-02T02:00:00Z"), "2026-10-26");
  const s = porSemana([toque({}), toque({ scheduled_at: "2026-11-03T13:00:00Z" })], new Map());
  assert.deepEqual(
    s.map((x) => [x.semana, x.enviados]),
    [
      ["2026-10-26", 1],
      ["2026-11-02", 1],
    ],
  );
});

test("funil Alice × equipe por quem orçou", () => {
  const f = funilAliceEquipe([
    {
      id: "1",
      entrada_em: null,
      orcamento_enviado_em: "x",
      os_criada_em: "y",
      realizado_em: "z",
      orcou: "alice",
      valor: 300,
    },
    {
      id: "2",
      entrada_em: null,
      orcamento_enviado_em: "x",
      os_criada_em: null,
      realizado_em: null,
      orcou: "alice",
      valor: 200,
    },
    {
      id: "3",
      entrada_em: null,
      orcamento_enviado_em: "x",
      os_criada_em: "y",
      realizado_em: null,
      orcou: "equipe",
      valor: 500,
    },
    {
      id: "4",
      entrada_em: null,
      orcamento_enviado_em: null,
      os_criada_em: null,
      realizado_em: null,
      orcou: null,
      valor: null,
    },
  ]);
  assert.equal(f.leadsNovos, 4);
  assert.equal(f.semOrcamento, 1);
  assert.deepEqual(f.alice, { orcamentos: 2, agendaram: 1, realizados: 1, valorAgendado: 300 });
  assert.deepEqual(f.equipe, { orcamentos: 1, agendaram: 1, realizados: 0, valorAgendado: 500 });
});
