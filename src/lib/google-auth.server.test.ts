import { test } from "node:test";
import assert from "node:assert/strict";
import { criarEstado, emailDoIdToken, enderecoRetorno, lerEstado } from "./google-auth.server";

const dados = {
  empresaId: "11111111-1111-1111-1111-111111111111",
  userId: "00000000-0000-0000-0000-0000000000a1",
  redirectUri: "https://nexa.exemplo/api/public/google/retorno",
  expiraEm: 2_000_000,
};

test("estado assinado volta igual", () => {
  assert.deepEqual(lerEstado(criarEstado(dados, "segredo"), "segredo", 1_000_000), dados);
});

test("estado com outro segredo é recusado", () => {
  assert.equal(lerEstado(criarEstado(dados, "segredo"), "outro", 1_000_000), null);
});

test("estado alterado (outra empresa) é recusado", () => {
  const [, assinatura] = criarEstado(dados, "segredo").split(".");
  const falso = Buffer.from(
    JSON.stringify({ ...dados, empresaId: "22222222-2222-2222-2222-222222222222" }),
  ).toString("base64url");
  assert.equal(lerEstado(`${falso}.${assinatura}`, "segredo", 1_000_000), null);
});

test("estado vencido é recusado", () => {
  assert.equal(lerEstado(criarEstado(dados, "segredo"), "segredo", 2_000_001), null);
});

test("lixo não quebra", () => {
  assert.equal(lerEstado("", "segredo"), null);
  assert.equal(lerEstado("abc.def", "segredo"), null);
});

test("endereço de retorno: https ou local", () => {
  assert.equal(
    enderecoRetorno("https://nexaos.run.app"),
    "https://nexaos.run.app/api/public/google/retorno",
  );
  assert.equal(
    enderecoRetorno("http://127.0.0.1:8080"),
    "http://127.0.0.1:8080/api/public/google/retorno",
  );
  assert.throws(() => enderecoRetorno("http://nexaos.run.app"));
  assert.throws(() => enderecoRetorno("javascript:alert(1)"));
});

test("e-mail do id_token", () => {
  const payload = Buffer.from(JSON.stringify({ email: "turbine@gmail.com" })).toString("base64url");
  assert.equal(emailDoIdToken(`x.${payload}.y`), "turbine@gmail.com");
  assert.equal(emailDoIdToken(undefined), null);
});
