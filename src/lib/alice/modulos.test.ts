import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blocoDosModulos,
  chaveDoTitulo,
  chavesValidas,
  juntarCarregados,
  linhaDosModulos,
  modulosDaConfig,
} from "./modulos";

const M = modulosDaConfig([
  { chave: "colchao", titulo: "Colchão", texto: "Prioridade de manhã na {nome_empresa}." },
  { chave: "sofa", titulo: "Sofá e estofados", texto: "Medidas e almofadas." },
  { chave: "sofa", titulo: "Repetido", texto: "x" },
  { chave: "Inválida!", titulo: "x", texto: "x" },
  { chave: "vazio", titulo: "Vazio", texto: "  " },
]);

test("módulos válidos, sem chave repetida, inválida ou vazia", () => {
  assert.deepEqual(
    M.map((m) => m.chave),
    ["colchao", "sofa"],
  );
  assert.deepEqual(modulosDaConfig(null), []);
  assert.equal(chaveDoTitulo("Sofá e estofados"), "sofa_e_estofados");
});

test("carregar: só chaves da empresa, sem repetir, na ordem da empresa", () => {
  assert.deepEqual(chavesValidas(M, ["sofa", "tapete", "colchao", "sofa"]), ["colchao", "sofa"]);
  assert.deepEqual(juntarCarregados(M, ["sofa"], ["colchao"]), ["colchao", "sofa"]);
});

test("bloco dos módulos carregados com os campos da empresa; linha das regras", () => {
  const b = blocoDosModulos(M, ["colchao"], (t) => t.replace("{nome_empresa}", "Empresa X"));
  assert.match(b, /## Módulo: Colchão\nPrioridade de manhã na Empresa X\./);
  assert.equal(blocoDosModulos(M, []), "");
  assert.match(linhaDosModulos(M), /colchao \(Colchão\), sofa \(Sofá e estofados\)/);
  assert.equal(linhaDosModulos([]), "");
});
