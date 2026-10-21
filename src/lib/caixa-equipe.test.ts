import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRESENCA_EXPIRA_MS,
  aplicarPresenca,
  colegasPresentes,
  contarNaoLidas,
  desdeQuando,
  ehMinha,
  podeAvisarDigitando,
  primeiroNome,
  quemEstaCom,
} from "./caixa-equipe";

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
    ehMinha({ assumidaPor: "u3", responsavelId: null, grupo: "precisam" }, semChatwoot),
    true,
  );
  // Devolvida à Alice: é dela, não minha (devolver também limpa assumida_por).
  assert.equal(
    ehMinha({ assumidaPor: "u3", responsavelId: null, grupo: "alice" }, semChatwoot),
    false,
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

test("quem está com a conversa: Chatwoot primeiro, depois quem assumiu pelo app; Alice não conta", () => {
  const eu = { userId: "u1", chatwootAgentId: 273635, botIds: [10891] };
  // Atribuída a outra pessoa no Chatwoot: é dela, mesmo que eu tenha assumido pelo app antes.
  assert.equal(
    quemEstaCom({ assumidaPor: "u1", responsavelId: 999, grupo: "equipe" }, eu),
    "outra",
  );
  assert.equal(
    quemEstaCom({ assumidaPor: null, responsavelId: 273635, grupo: "equipe" }, eu),
    "eu",
  );
  // Sem ninguém no Chatwoot: vale quem assumiu pelo app.
  assert.equal(
    quemEstaCom({ assumidaPor: "u2", responsavelId: null, grupo: "precisam" }, eu),
    "outra",
  );
  assert.equal(
    quemEstaCom({ assumidaPor: "u1", responsavelId: null, grupo: "precisam" }, eu),
    "eu",
  );
  assert.equal(
    quemEstaCom({ assumidaPor: null, responsavelId: null, grupo: "precisam" }, eu),
    "ninguem",
  );
  // Atribuída à Alice (agent_bot) com status open: ninguém da equipe está com ela.
  assert.equal(
    quemEstaCom({ assumidaPor: null, responsavelId: 10891, grupo: "precisam" }, eu),
    "ninguem",
  );
  assert.equal(
    quemEstaCom({ assumidaPor: "u2", responsavelId: 10891, grupo: "precisam" }, eu),
    "outra",
  );
  // Com a Alice ou encerrada: ninguém.
  assert.equal(
    quemEstaCom({ assumidaPor: "u2", responsavelId: 999, grupo: "alice" }, eu),
    "ninguem",
  );
  assert.equal(
    quemEstaCom({ assumidaPor: "u1", responsavelId: null, grupo: "finalizadas" }, eu),
    "ninguem",
  );
});

test("presença: aviso 'aqui' entra, 'saiu' tira, e some depois de 70 s sem aviso", () => {
  const t0 = 1_000_000;
  let lista = aplicarPresenca(
    [],
    { conversaId: "c1", userId: "u2", nome: "Maria Germano", estado: "aqui" },
    t0,
  );
  lista = aplicarPresenca(
    lista,
    { conversaId: "c1", userId: "u1", nome: "Eu", estado: "aqui" },
    t0,
  );
  // Repetir o aviso não duplica, só renova.
  lista = aplicarPresenca(
    lista,
    { conversaId: "c1", userId: "u2", nome: "Maria Germano", estado: "aqui" },
    t0 + 25_000,
  );
  assert.equal(lista.length, 2);
  assert.deepEqual(
    colegasPresentes(lista, "u1", t0 + 30_000).map((p) => p.nome),
    ["Maria Germano"],
    "sem mim, com a colega",
  );
  assert.equal(
    colegasPresentes(lista, "u1", t0 + 25_000 + PRESENCA_EXPIRA_MS).length,
    0,
    "expirou",
  );
  lista = aplicarPresenca(
    lista,
    { conversaId: "c1", userId: "u2", nome: "Maria Germano", estado: "saiu" },
    t0 + 40_000,
  );
  assert.equal(colegasPresentes(lista, "u1", t0 + 41_000).length, 0, "saiu");
  assert.equal(primeiroNome("Maria Germano"), "Maria");
  assert.equal(primeiroNome(null), "Colega");
});

test("desde quando: hora de assumir pelo app só quando é da mesma pessoa que está no Chatwoot", () => {
  const eu = {
    userId: "u1",
    chatwootAgentId: null,
    botIds: [10891],
    usuarioDoAgente: new Map([[273635, "u2"]]),
  };
  const em = "2026-10-21T17:32:00Z";
  assert.equal(desdeQuando({ assumidaPor: "u2", assumidaEm: em, responsavelId: null }, eu), em);
  assert.equal(desdeQuando({ assumidaPor: "u2", assumidaEm: em, responsavelId: 273635 }, eu), em);
  assert.equal(desdeQuando({ assumidaPor: "u2", assumidaEm: em, responsavelId: 10891 }, eu), em);
  // Atribuída no Chatwoot a outra pessoa que não a que assumiu pelo app: hora desconhecida.
  assert.equal(desdeQuando({ assumidaPor: "u1", assumidaEm: em, responsavelId: 273635 }, eu), null);
  assert.equal(
    desdeQuando({ assumidaPor: null, assumidaEm: null, responsavelId: 273635 }, eu),
    null,
  );
});
