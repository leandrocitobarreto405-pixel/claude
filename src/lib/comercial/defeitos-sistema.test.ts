import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contarDefeitosSistema,
  doisToquesNoDia,
  fotosAntesDeAgendar,
  orcamentosSemCep,
  toquesComRetornoCombinado,
} from "./defeitos-sistema";

test("orçamento da Alice sem CEP nem endereço conta; com rua e bairro não", () => {
  const ev = orcamentosSemCep([
    { criadoEm: "2026-10-30T12:00:00Z", lead: "a", cep: null, endereco: null, daAlice: true },
    {
      criadoEm: "2026-10-30T12:00:00Z",
      lead: "b",
      cep: null,
      endereco: "Rua X, Bairro Y",
      daAlice: true,
    },
    {
      criadoEm: "2026-10-30T12:00:00Z",
      lead: "c",
      cep: "01310-100",
      endereco: null,
      daAlice: true,
    },
    { criadoEm: "2026-10-30T12:00:00Z", lead: "d", cep: null, endereco: null, daAlice: false },
  ]);
  assert.deepEqual(
    ev.map((e) => e.lead),
    ["a"],
  );
});

test("foto do técnico antes de agendar: sem agendamento ou agendado depois", () => {
  const ag = new Map([
    ["a", null],
    ["b", "2026-10-30T10:00:00Z"],
    ["c", "2026-10-30T20:00:00Z"],
  ]);
  const ev = fotosAntesDeAgendar(
    [
      { em: "2026-10-30T12:00:00Z", lead: "a" },
      { em: "2026-10-30T12:00:00Z", lead: "b" },
      { em: "2026-10-30T12:00:00Z", lead: "c" },
    ],
    ag,
  );
  assert.deepEqual(
    ev.map((e) => e.lead),
    ["a", "c"],
  );
});

test("dois toques no mesmo dia (São Paulo) sem resposta", () => {
  const ev = doisToquesNoDia([
    { em: "2026-10-30T13:00:00Z", lead: "a", respondido: false },
    { em: "2026-10-30T20:00:00Z", lead: "a", respondido: false },
    // 02:00Z do dia 31 ainda é dia 30 em São Paulo
    { em: "2026-10-31T02:00:00Z", lead: "b", respondido: false },
    { em: "2026-10-30T13:00:00Z", lead: "b", respondido: true },
    { em: "2026-10-30T13:00:00Z", lead: "c", respondido: false },
    { em: "2026-10-31T13:00:00Z", lead: "c", respondido: false },
  ]);
  assert.deepEqual(
    ev.map((e) => e.lead),
    ["a"],
  );
});

test("toque com retorno combinado ainda por vir", () => {
  const ev = toquesComRetornoCombinado(
    [
      { em: "2026-10-30T13:00:00Z", lead: "a", trilha: "A" },
      { em: "2026-10-30T13:00:00Z", lead: "b", trilha: "B" },
      { em: "2026-10-30T13:00:00Z", lead: "a", trilha: "C" },
    ],
    new Map([
      ["a", "2026-11-05T12:00:00Z"],
      ["b", "2026-10-29T12:00:00Z"],
    ]),
  );
  assert.deepEqual(
    ev.map((e) => `${e.lead}`),
    ["a"],
  );
});

test("antes × depois pela data da correção; sem correção, tudo antes", () => {
  const agora = new Date("2026-11-05T03:00:00Z");
  const r = contarDefeitosSistema(
    [
      { defeito: "orcou_sem_cep", em: "2026-10-20T12:00:00Z", lead: "a" },
      { defeito: "orcou_sem_cep", em: "2026-10-25T12:00:00Z", lead: "b" },
      { defeito: "orcou_sem_cep", em: "2026-11-02T12:00:00Z", lead: "c" },
      { defeito: "dois_toques_mesmo_dia", em: "2026-11-02T12:00:00Z", lead: "c" },
    ],
    "2026-10-06T03:00:00Z",
    agora,
    (d) => (d === "dois_toques_mesmo_dia" ? null : "2026-11-01T03:00:00Z"),
  );
  const cep = r.find((x) => x.id === "orcou_sem_cep")!;
  assert.deepEqual([cep.antes, cep.depois], [2, 1]);
  assert.equal(cep.porDiaDepois, 0.25);
  const dois = r.find((x) => x.id === "dois_toques_mesmo_dia")!;
  assert.deepEqual([dois.antes, dois.depois, dois.corte], [1, 0, null]);
});
