// Status de entrega lido do webhook do Chatwoot. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusDeEntrega } from "./caixa-entrega";

test("falha informada em external_error vira 'falhou' com o erro", () => {
  assert.deepEqual(
    statusDeEntrega({
      event: "message_updated",
      id: 42,
      message_type: "outgoing",
      content_attributes: { external_error: "131047: fora da janela de 24 h" },
    }),
    { chatwootMessageId: 42, status: "falhou", erro: "131047: fora da janela de 24 h" },
  );
});

test("campo status do WhatsApp, quando vier, é mapeado; sem nada, null", () => {
  assert.equal(
    statusDeEntrega({ event: "message_updated", id: 7, message_type: "outgoing", status: "read" })
      ?.status,
    "lida",
  );
  assert.equal(
    statusDeEntrega({
      event: "message_updated",
      id: 7,
      message_type: "outgoing",
      content_attributes: {},
    }),
    null,
  );
});

test("mensagem recebida, outro evento ou id inválido: ignorado", () => {
  assert.equal(
    statusDeEntrega({ event: "message_updated", id: 7, message_type: "incoming", status: "read" }),
    null,
  );
  assert.equal(
    statusDeEntrega({
      event: "conversation_updated",
      id: 7,
      message_type: "outgoing",
      status: "read",
    }),
    null,
  );
  assert.equal(
    statusDeEntrega({
      event: "message_updated",
      id: "x",
      message_type: "outgoing",
      status: "read",
    }),
    null,
  );
});
