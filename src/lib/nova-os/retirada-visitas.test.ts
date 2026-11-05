import { test } from "node:test";
import assert from "node:assert/strict";
import { infoRetirada, separarRetirada, type ItemCatalogo } from "./retirada-visitas";

const CATALOGO: ItemCatalogo[] = [
  { nome: "Persiana rolo (até 2 m)", categoria: "persiana", parceiro_id: "diego" },
  { nome: "Tapete", categoria: "tapete", parceiro_id: "reginaldo" },
  { nome: "Sofá 3 lugares", categoria: "sofa", parceiro_id: null },
];
const item = (description: string) => ({ description, upholstery_type_id: "" });
const visita = (descricoes: string[], extra: object = {}) => ({
  scheduled_date: "2026-11-04",
  technician_id: "",
  service_type_id: "s1",
  items: descricoes.map(item),
  ...extra,
});

test("retirada no formulário: entrega calculada, editada e parceiro", () => {
  const info = infoRetirada(
    visita(["Persiana rolo (até 2 m) — Limpeza", "Taxa de deslocamento"]),
    CATALOGO,
    [],
    new Set(),
  );
  assert.equal(info.situacao, "retirada");
  if (info.situacao !== "retirada") return;
  assert.equal(info.entregaCalculada, "2026-11-13");
  assert.equal(info.entrega, "2026-11-13");
  assert.equal(info.parceiroId, "diego");

  const editada = infoRetirada(
    visita(["Tapete"], { entrega_prevista: "2026-11-20", entrega_editada: true }),
    CATALOGO,
    [],
    new Set(),
  );
  assert.equal(editada.situacao === "retirada" && editada.entrega, "2026-11-20");
  assert.equal(editada.situacao === "retirada" && editada.parceiroId, "reginaldo");

  assert.equal(infoRetirada(visita(["Sofá 3 lugares"]), CATALOGO, [], new Set()).situacao, "comum");
});

test("retirada no formulário: separar o atendimento misturado", () => {
  const visitas = [visita(["Sofá 3 lugares", "Persiana rolo (até 2 m) — Limpeza", "Tapete"])];
  const info = infoRetirada(visitas[0]!, CATALOGO, [], new Set());
  assert.deepEqual(info, { situacao: "misturado", tipos: ["persiana", "tapete"] });
  const novas = separarRetirada(visitas, 0, CATALOGO, [], (tecnico, data) => ({
    ...visita([]),
    technician_id: tecnico,
    scheduled_date: data,
  }));
  assert.equal(novas.length, 3);
  assert.deepEqual(
    novas.map((v) => [v.technician_id, v.items.map((i) => i.description)]),
    [
      ["", ["Sofá 3 lugares"]],
      ["diego", ["Persiana rolo (até 2 m) — Limpeza"]],
      ["reginaldo", ["Tapete"]],
    ],
  );
  assert.equal((novas[1] as { scheduled_time?: string }).scheduled_time, "08:00");
});
