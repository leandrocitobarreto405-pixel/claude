import { test } from "node:test";
import assert from "node:assert/strict";
import { abasDoPapel } from "./navegacao";
import { podeAcessar } from "./tenant";

const rotas = (papel: Parameters<typeof abasDoPapel>[0]) => abasDoPapel(papel).map((a) => a.to);

test("admin e atendente: Início, Agenda, Conversas, Marketing, Avisos", () => {
  const esperado = ["/inicio", "/agenda", "/conversas", "/marketing", "/avisos"];
  assert.deepEqual(rotas("admin"), esperado);
  assert.deepEqual(rotas("atendente"), esperado);
});

test("técnico: Agenda, Serviços, Avisos (a OS deixa Serviços ativa)", () => {
  assert.deepEqual(rotas("tecnico"), ["/agenda", "/servicos", "/avisos"]);
  const servicos = abasDoPapel("tecnico").find((a) => a.to === "/servicos");
  assert.deepEqual(servicos?.ativoEm, ["/os"]);
});

test("sem papel não há abas", () => {
  assert.deepEqual(rotas(null), []);
});

test("toda aba abre para o papel que a vê", () => {
  for (const papel of ["admin", "atendente", "tecnico"] as const)
    for (const to of rotas(papel)) assert.ok(podeAcessar(papel, to), `${papel} ${to}`);
});

test("técnico continua sem Marketing, Conversas e Início; /design só admin", () => {
  for (const to of ["/marketing", "/conversas", "/inicio", "/design"])
    assert.equal(podeAcessar("tecnico", to), false, to);
  assert.equal(podeAcessar("atendente", "/design"), false);
  assert.equal(podeAcessar("admin", "/design"), true);
  // O técnico mantém tudo o que já via.
  for (const to of ["/agenda", "/mensagens", "/servicos", "/os/123"])
    assert.equal(podeAcessar("tecnico", to), true, to);
});
