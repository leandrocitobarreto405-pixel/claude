import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILTROS_PADRAO,
  abaDoItem,
  diasDeAtraso,
  filtrarFollowups,
  ordenarFollowups,
  textoAtraso,
  type ItemFollowup,
} from "./follow-ups";

const agora = new Date("2026-10-28T15:00:00Z"); // 12h em São Paulo
const item = (o: Partial<ItemFollowup>): ItemFollowup => ({
  id: "x",
  leadId: "l",
  scheduledAt: "2026-10-28T13:00:00Z",
  status: "Pendente",
  responsavel: "equipe",
  pessoaId: null,
  comOrcamento: true,
  ...o,
});

test("retorno vencido não some: fica em Hoje e vencidos com os dias de atraso", () => {
  const velho = item({ scheduledAt: "2026-10-20T13:00:00Z", status: "Vencida" });
  assert.equal(abaDoItem(velho, agora), "hoje");
  assert.equal(diasDeAtraso(velho.scheduledAt, agora), 8);
  assert.equal(textoAtraso(8), "Vencido há 8 dias");
  assert.equal(textoAtraso(1), "Vencido há 1 dia");
  assert.equal(textoAtraso(0), null);
});

test("hoje à noite em São Paulo ainda é hoje; amanhã é Próximos", () => {
  assert.equal(abaDoItem(item({ scheduledAt: "2026-10-29T01:30:00Z" }), agora), "hoje");
  assert.equal(abaDoItem(item({ scheduledAt: "2026-10-29T12:00:00Z" }), agora), "proximos");
});

test("filtros: orçamento, Alice/equipe e pessoa (sem dono aparece para todos)", () => {
  const lista = [
    item({ id: "a", responsavel: "alice", comOrcamento: true }),
    item({ id: "b", responsavel: "equipe", comOrcamento: false, pessoaId: "maria" }),
    item({ id: "c", responsavel: "equipe", comOrcamento: true, pessoaId: "carol" }),
  ];
  const ids = (f: Partial<typeof FILTROS_PADRAO>) =>
    filtrarFollowups(lista, { ...FILTROS_PADRAO, ...f }).map((i) => i.id);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(ids({ orcamento: "sem" }), ["b"]);
  assert.deepEqual(ids({ quem: "alice" }), ["a"]);
  assert.deepEqual(ids({ pessoa: "maria" }), ["a", "b"]);
});

test("ordem: mais atrasado primeiro, equipe antes da Alice, depois o horário", () => {
  const lista = [
    item({ id: "alice-hoje", responsavel: "alice", scheduledAt: "2026-10-28T12:00:00Z" }),
    item({ id: "equipe-hoje", scheduledAt: "2026-10-28T14:00:00Z" }),
    item({ id: "vencido", scheduledAt: "2026-10-25T12:00:00Z" }),
  ];
  assert.deepEqual(
    ordenarFollowups(lista, agora).map((i) => i.id),
    ["vencido", "equipe-hoje", "alice-hoje"],
  );
});
