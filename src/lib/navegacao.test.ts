import { test } from "node:test";
import assert from "node:assert/strict";
import { ABA_MAIS, abasDoPapel } from "./navegacao";
import { podeAcessar } from "./tenant";

const rotas = (papel: Parameters<typeof abasDoPapel>[0]) => abasDoPapel(papel).map((a) => a.to);

test("admin e atendente: Início, Conversas, Agenda, OS, Mais", () => {
  const esperado = ["/inicio", "/conversas", "/agenda", "/oss", ABA_MAIS];
  assert.deepEqual(rotas("admin"), esperado);
  assert.deepEqual(rotas("atendente"), esperado);
  const os = abasDoPapel("admin").find((a) => a.to === "/oss");
  assert.deepEqual(os?.ativoEm, ["/orcamentos", "/nova-os", "/os"]);
});

test("técnico: Agenda, Serviços, Mais (a OS e o serviço deixam Serviços ativa)", () => {
  assert.deepEqual(rotas("tecnico"), ["/agenda", "/servicos", ABA_MAIS]);
  const servicos = abasDoPapel("tecnico").find((a) => a.to === "/servicos");
  assert.deepEqual(servicos?.ativoEm, ["/os", "/servico"]);
});

test("sem papel não há abas", () => {
  assert.deepEqual(rotas(null), []);
});

test("toda aba (menos o Mais) abre para o papel que a vê", () => {
  for (const papel of ["admin", "atendente", "tecnico"] as const)
    for (const to of rotas(papel))
      if (to !== ABA_MAIS) assert.ok(podeAcessar(papel, to), `${papel} ${to}`);
});

test("técnico continua sem Marketing, Conversas e Início; /design só admin", () => {
  for (const to of ["/marketing", "/conversas", "/inicio", "/design"])
    assert.equal(podeAcessar("tecnico", to), false, to);
  assert.equal(podeAcessar("atendente", "/design"), false);
  assert.equal(podeAcessar("admin", "/design"), true);
  // O técnico mantém tudo o que já via, mais as notificações no celular.
  for (const to of ["/agenda", "/mensagens", "/servicos", "/os/123", "/notificacoes"])
    assert.equal(podeAcessar("tecnico", to), true, to);
  // A atendente ganha os indicadores do funil; o financeiro continua só do admin.
  assert.equal(podeAcessar("atendente", "/indicadores"), true);
  assert.equal(podeAcessar("atendente", "/despesas"), false);
  assert.equal(podeAcessar("atendente", "/dre"), false);
});
