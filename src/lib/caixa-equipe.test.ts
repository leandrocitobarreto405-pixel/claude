import { test } from "node:test";
import assert from "node:assert/strict";
import { contarNaoLidas, ehMinha, podeAvisarDigitando } from "./caixa-equipe";

test("Minhas: assumida por mim no app ou atribuída ao meu usuário do Chatwoot", () => {
  const eu = { userId: "u1", chatwootAgentId: 273635 };
  assert.equal(ehMinha({ assumidaPor: "u1", responsavelId: null, grupo: "equipe" }, eu), true);
  assert.equal(ehMinha({ assumidaPor: null, responsavelId: 273635, grupo: "precisam" }, eu), true);
  assert.equal(ehMinha({ assumidaPor: "u2", responsavelId: 999, grupo: "equipe" }, eu), false);
  assert.equal(
    ehMinha({ assumidaPor: "u1", responsavelId: null, grupo: "finalizadas" }, eu),
    false,
  );
  // Sem usuário no Chatwoot: só o que assumi pelo app conta.
  const semChatwoot = { userId: "u3", chatwootAgentId: null };
  assert.equal(
    ehMinha({ assumidaPor: null, responsavelId: 273635, grupo: "equipe" }, semChatwoot),
    false,
  );
  assert.equal(
    ehMinha({ assumidaPor: "u3", responsavelId: null, grupo: "alice" }, semChatwoot),
    true,
  );
});

test("não lidas: mensagens do cliente depois da última leitura", () => {
  const msgs = [
    { direction: "Recebida", message_timestamp: "2026-10-21T10:00:00Z" },
    { direction: "Enviada", message_timestamp: "2026-10-21T10:05:00Z" },
    { direction: "Recebida", message_timestamp: "2026-10-21T11:00:00Z" },
    { direction: "Recebida", message_timestamp: "2026-10-21T12:00:00Z" },
  ];
  assert.equal(contarNaoLidas(msgs, null), 3, "nunca abriu: todas do cliente");
  assert.equal(contarNaoLidas(msgs, "2026-10-21T10:30:00Z"), 2);
  assert.equal(contarNaoLidas(msgs, "2026-10-21T12:00:00Z"), 0, "leu até a última");
});

test("digitando: no máximo um aviso a cada 20 s", () => {
  assert.equal(podeAvisarDigitando(null, 1000), true);
  assert.equal(podeAvisarDigitando(1000, 15_000), false);
  assert.equal(podeAvisarDigitando(1000, 21_000), true);
});
