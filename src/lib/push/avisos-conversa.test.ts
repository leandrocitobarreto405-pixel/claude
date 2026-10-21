import { test } from "node:test";
import assert from "node:assert/strict";
import { avisosDaMensagem, type MensagemChegada } from "./avisos-conversa";

const base: MensagemChegada = {
  conversaId: "c1",
  mensagemId: "m1",
  direction: "Recebida",
  privada: false,
  texto: "Oi, quanto fica o sofá de 3 lugares?",
  clienteNome: "Cliente Fictício",
  status: "open",
  aguardandoDesde: "2026-10-21T20:00:00Z",
  comAlguem: false,
  responsavelUserId: null,
};
const equipe = [
  { userId: "admin", papel: "admin" as const, clienteEsperando: true },
  { userId: "maria", papel: "atendente" as const, clienteEsperando: true },
  { userId: "tec", papel: "tecnico" as const, clienteEsperando: true },
  { userId: "mudo", papel: "atendente" as const, clienteEsperando: false },
];
const agora = new Date("2026-10-21T20:00:30Z");

test("conversa sem ninguém: 'Conversa nova para a equipe' para admin e atendente, uma vez por espera", () => {
  const avisos = avisosDaMensagem(base, equipe, new Map(), agora);
  assert.deepEqual(
    avisos.map((a) => a.userId),
    ["admin", "maria"],
    "técnico e quem desligou não recebem",
  );
  assert.equal(avisos[0]!.n.titulo, "Conversa nova para a equipe");
  assert.equal(avisos[0]!.n.corpo, "Cliente Fictício: Oi, quanto fica o sofá de 3 lugares?");
  assert.equal(avisos[0]!.n.url, "/conversas/c1");
  assert.equal(avisos[0]!.ref, "nova:c1:2026-10-21T20:00:00Z", "a mesma espera não repete");
});

test("conversa com alguém: 'Cliente respondeu a sua conversa' só para essa pessoa", () => {
  const avisos = avisosDaMensagem(
    { ...base, comAlguem: true, responsavelUserId: "maria" },
    equipe,
    new Map(),
    agora,
  );
  assert.deepEqual(
    avisos.map((a) => a.userId),
    ["maria"],
  );
  assert.equal(avisos[0]!.n.titulo, "Cliente respondeu a sua conversa");
  assert.equal(avisos[0]!.ref, "resp:c1:2026-10-21T20:00:00Z");
  // Responsável sem celular cadastrado, ou do Chatwoot sem usuário no app: ninguém recebe no lugar.
  assert.deepEqual(
    avisosDaMensagem(
      { ...base, comAlguem: true, responsavelUserId: "x" },
      equipe,
      new Map(),
      agora,
    ),
    [],
  );
  assert.deepEqual(
    avisosDaMensagem(
      { ...base, comAlguem: true, responsavelUserId: null },
      equipe,
      new Map(),
      agora,
    ),
    [],
  );
});

test("quem está com a conversa aberta na tela agora não recebe", () => {
  const vendo = new Map([
    ["maria", "2026-10-21T20:00:10Z"],
    ["admin", "2026-10-21T19:58:00Z"],
  ]);
  const avisos = avisosDaMensagem(base, equipe, vendo, agora);
  assert.deepEqual(
    avisos.map((a) => a.userId),
    ["admin"],
    "Maria está vendo; admin viu há 2 min",
  );
  assert.deepEqual(
    avisosDaMensagem(
      { ...base, comAlguem: true, responsavelUserId: "maria" },
      equipe,
      vendo,
      agora,
    ),
    [],
  );
});

test("nada para mensagem da empresa, nota privada, conversa com a Alice ou encerrada", () => {
  assert.deepEqual(
    avisosDaMensagem({ ...base, direction: "Enviada" }, equipe, new Map(), agora),
    [],
  );
  assert.deepEqual(avisosDaMensagem({ ...base, privada: true }, equipe, new Map(), agora), []);
  assert.deepEqual(avisosDaMensagem({ ...base, status: "pending" }, equipe, new Map(), agora), []);
  assert.deepEqual(avisosDaMensagem({ ...base, status: "resolved" }, equipe, new Map(), agora), []);
});

test("sem waiting_since, a própria mensagem identifica a espera; texto longo é cortado", () => {
  const avisos = avisosDaMensagem(
    { ...base, aguardandoDesde: null, texto: "x".repeat(200) },
    equipe,
    new Map(),
    agora,
  );
  assert.equal(avisos[0]!.ref, "nova:c1:m1");
  assert.ok(avisos[0]!.n.corpo.length <= "Cliente Fictício: ".length + 90);
  assert.ok(avisos[0]!.n.corpo.endsWith("…"));
});
