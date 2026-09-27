import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verificarAssinaturaChatwoot } from "./chatwoot.server";

const segredo = "segredo-de-teste";
const corpo = JSON.stringify({ event: "message_created", id: 1, content: "Olá" });
const agora = 1_790_000_000;

function cabecalhos(ts: number, corpoAssinado = corpo, chave = segredo) {
  const hmac = createHmac("sha256", chave).update(`${ts}.${corpoAssinado}`).digest("hex");
  return new Headers({
    "X-Chatwoot-Timestamp": String(ts),
    "X-Chatwoot-Signature": `sha256=${hmac}`,
  });
}

test("aceita assinatura correta dentro da janela", () => {
  assert.deepEqual(verificarAssinaturaChatwoot(corpo, segredo, cabecalhos(agora - 60), agora), {
    ok: true,
  });
});

test("recusa corpo alterado", () => {
  const r = verificarAssinaturaChatwoot(corpo + " ", segredo, cabecalhos(agora), agora);
  assert.deepEqual(r, { ok: false, motivo: "assinatura_invalida" });
});

test("recusa segredo errado", () => {
  const r = verificarAssinaturaChatwoot(corpo, segredo, cabecalhos(agora, corpo, "outro"), agora);
  assert.deepEqual(r, { ok: false, motivo: "assinatura_invalida" });
});

test("recusa aviso antigo (reenvio)", () => {
  const r = verificarAssinaturaChatwoot(corpo, segredo, cabecalhos(agora - 301), agora);
  assert.deepEqual(r, { ok: false, motivo: "fora_da_janela" });
});

test("recusa sem cabeçalhos ou com horário inválido", () => {
  assert.deepEqual(verificarAssinaturaChatwoot(corpo, segredo, new Headers(), agora), {
    ok: false,
    motivo: "sem_assinatura",
  });
  const h = cabecalhos(agora);
  h.set("X-Chatwoot-Timestamp", "abc");
  assert.deepEqual(verificarAssinaturaChatwoot(corpo, segredo, h, agora), {
    ok: false,
    motivo: "horario_invalido",
  });
});

test("recusa assinatura com tamanho diferente sem lançar erro", () => {
  const h = cabecalhos(agora);
  h.set("X-Chatwoot-Signature", "sha256=abc");
  assert.deepEqual(verificarAssinaturaChatwoot(corpo, segredo, h, agora), {
    ok: false,
    motivo: "assinatura_invalida",
  });
});
