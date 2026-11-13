// Toda chamada de IA grava o custo em ia_chamadas (13/11): empresa e origem vêm da chamada ou do
// contexto da rodada (conversa da Alice, leitura da noite da Tatiana); quem já grava sozinho não
// grava de novo. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { destinoDoCusto } from "./parada-ia.server";
import { comContextoIa } from "@/lib/ia-contexto.server";
import { linhaDaChamada } from "@/lib/ia-chamadas";
import { MODELO_HAIKU } from "@/lib/comercial/ficha";

test("sem empresa nem contexto: não grava", () => {
  assert.equal(destinoDoCusto({}), null);
  assert.equal(destinoDoCusto({ origem: "plano" }), null);
});

test("chamada com empresa e origem: grava", () => {
  assert.deepEqual(destinoDoCusto({ empresaId: "emp", origem: "relatorio" }), {
    empresaId: "emp",
    origem: "relatorio",
    referencia: null,
  });
});

test("leitura da noite: a decisão do lead grava com a empresa e o lead do contexto", async () => {
  const d = await comContextoIa(
    { empresaId: "emp", origem: "tatiana_noite", referencia: "lead-1" },
    async () => {
      await new Promise((r) => setTimeout(r, 1));
      return destinoDoCusto({});
    },
  );
  assert.deepEqual(d, { empresaId: "emp", origem: "tatiana_noite", referencia: "lead-1" });
});

test("mensagem da equipe na noite: origem própria, empresa do contexto", async () => {
  const d = await comContextoIa({ empresaId: "emp", origem: "tatiana_noite" }, async () =>
    destinoDoCusto({ origem: "tatiana_mensagem" }),
  );
  assert.equal(d?.origem, "tatiana_mensagem");
  assert.equal(d?.empresaId, "emp");
});

test("conversa da Alice: rodadas em paralelo não misturam as empresas", async () => {
  const [a, b] = await Promise.all([
    comContextoIa({ empresaId: "emp-a", origem: "alice_conversa" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return destinoDoCusto({});
    }),
    comContextoIa({ empresaId: "emp-b", origem: "alice_conversa" }, async () => destinoDoCusto({})),
  ]);
  assert.equal(a?.empresaId, "emp-a");
  assert.equal(b?.empresaId, "emp-b");
});

test("quem já grava sozinho (classificador, retorno, toque da equipe) não grava de novo", async () => {
  const d = await comContextoIa({ empresaId: "emp", origem: "alice_conversa" }, async () =>
    destinoDoCusto({ semRegistro: true }),
  );
  assert.equal(d, null);
});

test("chamada que falhou entra com custo zero e ok falso", () => {
  const l = linhaDaChamada({
    empresaId: "emp",
    origem: "ensaio",
    modelo: "desconhecido",
    uso: null,
  });
  assert.equal(l.custo_usd, 0);
  assert.equal(l.ok, false);
});

test("Haiku: o custo da chamada vai calculado na linha", () => {
  const l = linhaDaChamada({
    empresaId: "emp",
    origem: "tatiana_recado",
    modelo: MODELO_HAIKU,
    uso: { input_tokens: 1_000_000, output_tokens: 0 } as never,
  });
  assert.ok(l.custo_usd > 0);
  assert.equal(l.ok, true);
});
