import { test } from "node:test";
import assert from "node:assert/strict";
import { ENDERECO_APP, ENDERECO_SERVIDOR, enderecoDoApp, enderecoDosWebhooks } from "./enderecos";

test("endereços: links para pessoas no domínio do app, webhooks no Cloud Run", () => {
  // No servidor (sem window), sem APP_URL_PUBLICA.
  delete process.env["APP_URL_PUBLICA"];
  assert.equal(enderecoDoApp(), ENDERECO_APP);
  assert.equal(enderecoDosWebhooks(), ENDERECO_SERVIDOR);
  assert.match(ENDERECO_APP, /^https:\/\/app\.nexaperformanceos\.com\.br$/);
  assert.match(ENDERECO_SERVIDOR, /\.run\.app$/);
});
