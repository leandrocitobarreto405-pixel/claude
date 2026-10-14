import { test } from "node:test";
import assert from "node:assert/strict";
import { GRUPOS_CONFIG, rotaDaAbaAntiga, rotaDoGrupo } from "./configuracoes-grupos";
import { podeAcessar } from "./tenant";

test("seis grupos, na ordem combinada, e só o admin abre", () => {
  assert.deepEqual(
    GRUPOS_CONFIG.map((g) => g.rotulo),
    ["Empresa", "Vendas", "Agenda", "Mensagens", "Alice, leads e marketing", "Outros"],
  );
  for (const g of GRUPOS_CONFIG) {
    assert.equal(podeAcessar("admin", rotaDoGrupo(g.id)), true);
    assert.equal(podeAcessar("atendente", rotaDoGrupo(g.id)), false);
  }
  const alice = GRUPOS_CONFIG.find((g) => g.id === "alice-leads")!;
  assert.ok(alice.itens.includes("Listas de marketing"));
  assert.ok(GRUPOS_CONFIG.find((g) => g.id === "vendas")!.itens.includes("Produtos"));
});

test("as abas antigas caem no grupo certo", () => {
  assert.equal(rotaDaAbaAntiga("meta"), "/configuracoes/empresa");
  assert.equal(rotaDaAbaAntiga("equipe"), "/configuracoes/equipe");
  assert.equal(rotaDaAbaAntiga("precos"), "/configuracoes/vendas");
  assert.equal(rotaDaAbaAntiga("listas"), "/configuracoes/alice-leads");
  assert.equal(rotaDaAbaAntiga("recorrentes"), "/configuracoes/outros");
  assert.equal(rotaDaAbaAntiga("documentos"), "/configuracoes/mensagens");
  assert.equal(rotaDaAbaAntiga("agenda"), "/configuracoes/agenda");
  assert.equal(rotaDaAbaAntiga("inventada"), null);
  assert.equal(rotaDaAbaAntiga(undefined), null);
});
