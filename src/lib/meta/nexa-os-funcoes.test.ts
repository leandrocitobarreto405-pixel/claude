// Código comum das Edge Functions do app Nexa OS (infra/supabase-functions/_compartilhado/meta.ts).
// Dados fictícios: segredos e IDs inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  assinaturaValida,
  cifrar,
  decifrar,
  desafioDaVerificacao,
  erroDaMeta,
  gerarCodigo,
  gerarPin,
  lerSignedRequest,
  linhasDoWebhook,
} from "../../../infra/supabase-functions/_compartilhado/meta";

const SEGREDO = "segredo-ficticio-do-app";

test("webhook: assinatura X-Hub-Signature-256", async () => {
  const corpo = new TextEncoder().encode('{"entry":[]}');
  const certa = "sha256=" + createHmac("sha256", SEGREDO).update(corpo).digest("hex");
  assert.equal(await assinaturaValida(SEGREDO, corpo, certa), true);
  assert.equal(await assinaturaValida(SEGREDO, corpo, certa.replace(/.$/, "0")), false);
  assert.equal(await assinaturaValida("outro", corpo, certa), false);
  assert.equal(await assinaturaValida(SEGREDO, corpo, null), false);
  assert.equal(await assinaturaValida("", corpo, certa), false);
});

test("webhook: verificação GET devolve o challenge só com o token certo", () => {
  const p = new URLSearchParams("hub.mode=subscribe&hub.verify_token=abc123&hub.challenge=42");
  assert.equal(desafioDaVerificacao(p, "abc123"), "42");
  assert.equal(desafioDaVerificacao(p, "errado"), null);
  assert.equal(desafioDaVerificacao(p, ""), null);
  assert.equal(
    desafioDaVerificacao(
      new URLSearchParams("hub.mode=x&hub.verify_token=abc123&hub.challenge=1"),
      "abc123",
    ),
    null,
  );
});

test("webhook: mensagens e status viram linhas com waba e phone_number_id", () => {
  const corpo = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "3641269396036529",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "1547429628435173" },
              messages: [
                {
                  id: "wamid.A",
                  from: "5511999990000",
                  type: "text",
                  text: { body: "Oi, tudo bem?" },
                },
                {
                  id: "wamid.B",
                  from: "5511999990000",
                  type: "image",
                  image: { caption: "foto do sofá" },
                },
              ],
            },
          },
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "1547429628435173" },
              statuses: [{ id: "wamid.C", status: "delivered", recipient_id: "5511999990000" }],
            },
          },
          { field: "message_template_status_update", value: { event: "APPROVED" } },
        ],
      },
    ],
  };
  const l = linhasDoWebhook(corpo);
  assert.deepEqual(
    l.map((x) => [x.tipo, x.wa_message_id, x.texto, x.status, x.phone_number_id, x.waba_id]),
    [
      ["mensagem", "wamid.A", "Oi, tudo bem?", null, "1547429628435173", "3641269396036529"],
      ["mensagem", "wamid.B", "foto do sofá", null, "1547429628435173", "3641269396036529"],
      ["status", "wamid.C", null, "delivered", "1547429628435173", "3641269396036529"],
      ["outro", null, null, null, null, "3641269396036529"],
    ],
  );
  assert.equal(l[0]!.contato, "5511999990000");
  assert.deepEqual(linhasDoWebhook({}), []);
  assert.deepEqual(linhasDoWebhook(null), []);
});

function signedRequest(payload: object, segredo = SEGREDO) {
  const b64u = (b: Buffer) =>
    b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dados = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(createHmac("sha256", segredo).update(dados).digest());
  return `${sig}.${dados}`;
}

test("exclusão: signed_request da Meta", async () => {
  const ok = await lerSignedRequest(
    signedRequest({ algorithm: "HMAC-SHA256", user_id: "12345", issued_at: 1 }),
    SEGREDO,
  );
  assert.equal(ok?.user_id, "12345");
  assert.equal(
    await lerSignedRequest(
      signedRequest({ algorithm: "HMAC-SHA256", user_id: "1" }, "outro"),
      SEGREDO,
    ),
    null,
  );
  assert.equal(
    await lerSignedRequest(signedRequest({ algorithm: "MD5", user_id: "1" }), SEGREDO),
    null,
  );
  assert.equal(await lerSignedRequest("lixo", SEGREDO), null);
  assert.equal(await lerSignedRequest(signedRequest({ algorithm: "HMAC-SHA256" }), SEGREDO), null);
});

test("token: AES-256-GCM ida e volta; chave errada falha", async () => {
  const chave = Buffer.alloc(32, 7).toString("base64");
  const c = await cifrar("EAAficticio123", chave);
  assert.match(c, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.ok(!c.includes("EAAficticio123"));
  assert.equal(await decifrar(c, chave), "EAAficticio123");
  await assert.rejects(decifrar(c, Buffer.alloc(32, 8).toString("base64")));
  await assert.rejects(cifrar("x", Buffer.alloc(16, 1).toString("base64")));
});

test("código, PIN e erro da Meta sem token", () => {
  assert.match(gerarCodigo(), /^[A-Z0-9]{16}$/);
  assert.match(gerarPin(), /^[0-9]{6}$/);
  const e = erroDaMeta({
    ok: false,
    status: 400,
    dados: { error: { message: "Invalid token EAAabc123", code: 190 } },
  });
  assert.equal(e, "Invalid token [token] (código 190)");
});
