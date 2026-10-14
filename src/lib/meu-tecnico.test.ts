import { test } from "node:test";
import assert from "node:assert/strict";
import { filtroDeTecnico, mostraValores, rotuloDoTecnico, tecnicoDoLogin } from "./meu-tecnico";

const tecnicos = [
  { id: "t1", name: "Técnico Um", user_id: "u1" },
  { id: "t2", name: "Técnico Dois", user_id: null },
];

test("técnico do login", () => {
  assert.equal(tecnicoDoLogin(tecnicos, "u1")?.id, "t1");
  assert.equal(tecnicoDoLogin(tecnicos, "u9"), null);
  assert.equal(tecnicoDoLogin(tecnicos, null), null);
  assert.equal(tecnicoDoLogin(undefined, "u1"), null);
});

test("técnico só vê o dele; sem cadastro ligado, não vê ninguém; admin usa o filtro", () => {
  assert.equal(filtroDeTecnico("tecnico", "t1", "todos"), "t1");
  assert.equal(filtroDeTecnico("tecnico", null, "todos"), "nenhum");
  assert.equal(filtroDeTecnico("admin", "t1", "todos"), "todos");
  assert.equal(filtroDeTecnico("admin", "t1", "t2"), "t2");
  assert.equal(filtroDeTecnico("atendente", null, "todos"), "todos");
});

test("admin que também é técnico ganha o chip Meus serviços; valores só fora do técnico", () => {
  assert.equal(rotuloDoTecnico("Técnico Um", "t1", "t1"), "Meus serviços");
  assert.equal(rotuloDoTecnico("Técnico Dois", "t2", "t1"), "Técnico Dois");
  assert.equal(mostraValores("tecnico"), false);
  assert.equal(mostraValores("admin"), true);
  assert.equal(mostraValores("atendente"), true);
});
