import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREFERENCIAS_PADRAO,
  esperasParaNotificar,
  horaDoResumo,
  notificacaoEspera,
  notificacaoPromocao,
  notificacaoResumo,
  querReceber,
  tiposDoPapel,
  urlSegura,
} from "./notificacoes";

test("papéis: técnico só recebe avisos da operação; campanha só admin", () => {
  assert.deepEqual(tiposDoPapel("tecnico"), [
    "servico_concluido",
    "agendamento_promocao",
    "resumo_dia",
  ]);
  assert.ok(!tiposDoPapel("atendente").includes("campanha_aprovacao"));
  assert.ok(tiposDoPapel("atendente").includes("cliente_esperando"));
  assert.equal(tiposDoPapel(null).length, 0);
  assert.equal(querReceber("cliente_esperando", "tecnico", PREFERENCIAS_PADRAO), false);
  assert.equal(querReceber("cliente_esperando", "admin", PREFERENCIAS_PADRAO), true);
  assert.equal(querReceber("resumo_dia", "admin", PREFERENCIAS_PADRAO), false);
  assert.equal(
    querReceber("resumo_dia", "admin", { ...PREFERENCIAS_PADRAO, resumo_dia: true }),
    true,
  );
});

test("esperas: só de verdade, depois dos minutos escolhidos e de menos de 24 h", () => {
  const agora = new Date("2026-10-02T15:00:00Z");
  const ha = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();
  const esperas = [
    { id: "a", nome: "Carla", desde: ha(12), ultimaDoCliente: true },
    { id: "b", nome: "João", desde: ha(5), ultimaDoCliente: true },
    { id: "c", nome: "Equipe falou", desde: ha(40), ultimaDoCliente: false },
    { id: "d", nome: "Esquecida", desde: ha(60 * 30), ultimaDoCliente: true },
  ];
  assert.deepEqual(
    esperasParaNotificar(esperas, 10, agora).map((e) => e.id),
    ["a"],
  );
  assert.deepEqual(
    esperasParaNotificar(esperas, 5, agora).map((e) => e.id),
    ["a", "b"],
  );
  assert.deepEqual(notificacaoEspera(esperas[0]!, agora), {
    titulo: "Cliente esperando a equipe",
    corpo: "Carla espera resposta há 12 min.",
    url: "/conversas/a",
    tag: "espera-a",
  });
  assert.match(notificacaoEspera({ ...esperas[0]!, desde: ha(75) }, agora).corpo, /1 h 15/);
});

test("textos e telas certas", () => {
  assert.deepEqual(
    notificacaoPromocao({ cliente: "Carla", data: "2026-10-03", hora: "14:00:00" }),
    {
      titulo: "Agendamento da promoção",
      corpo: "Carla marcou para 03/10 às 14:00.",
      url: "/agenda?modo=dia&dia=2026-10-03",
    },
  );
  const n = { servicosHoje: 3, atrasados: 1, semTecnico: 0, esperando: 2 };
  assert.equal(notificacaoResumo("tecnico", n).corpo, "3 serviços hoje · 1 atrasado.");
  assert.equal(notificacaoResumo("tecnico", n).url, "/agenda");
  assert.equal(notificacaoResumo("admin", n, "x").url, "/inicio");
  assert.equal(horaDoResumo(9), true);
  assert.equal(horaDoResumo(11), false);
  assert.equal(urlSegura("/os/1234"), "/os/1234");
  assert.equal(urlSegura("https://ruim.com"), "/avisos");
  assert.equal(urlSegura("//ruim.com"), "/avisos");
});
