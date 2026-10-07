import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREFERENCIAS_PADRAO,
  esperasParaNotificar,
  horaDoResumo,
  notificacaoAgendamentoAlice,
  notificacaoEspera,
  notificacaoPromocao,
  notificacaoResumo,
  notificacaoResumoTecnico,
  tecnicoDoUsuario,
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

test("resumo do técnico: só os serviços dele, em ordem", () => {
  assert.deepEqual(
    notificacaoResumoTecnico(
      [
        { hora: "14:00:00", cliente: "João Pedro", bairro: null },
        { hora: "09:30:00", cliente: "Carla Mendes", bairro: "Pinheiros" },
      ],
      1,
    ),
    {
      titulo: "Seu dia",
      corpo:
        "Hoje você tem 2 serviços: 09:30 Carla (Pinheiros), 14:00 João. 1 atrasado para resolver.",
      url: "/agenda",
    },
  );
  assert.equal(notificacaoResumoTecnico([], 0).corpo, "Hoje você não tem serviços na agenda.");
  const tecs = [
    { id: "t1", email: "Josue@Turbine.com", nome: "Josué" },
    { id: "t2", email: null, nome: "Marcos" },
  ];
  assert.equal(tecnicoDoUsuario({ email: "josue@turbine.com", nome: null }, tecs), "t1");
  assert.equal(tecnicoDoUsuario({ email: "outro@x.com", nome: "marcos" }, tecs), "t2");
  assert.equal(tecnicoDoUsuario({ email: null, nome: "Ana" }, tecs), null);
  // Ligado ao login vale antes do e-mail; técnico inativo não conta.
  const ligados = [
    { id: "auto", email: "josue@turbine.com", nome: "josue", userId: "u1", ativo: false },
    { id: "t1", email: "josue@turbine.com", nome: "Josué", userId: null },
    { id: "t9", email: null, nome: "Outro", userId: "u2" },
  ];
  assert.equal(
    tecnicoDoUsuario({ id: "u1", email: "josue@turbine.com", nome: null }, ligados),
    "t1",
  );
  assert.equal(tecnicoDoUsuario({ id: "u2", email: "x@y.com", nome: null }, ligados), "t9");
});

test("agendamento da Alice: cliente, dia, horário e valor; abre a OS", () => {
  const n = notificacaoAgendamentoAlice({
    titulo: "Agendamento feito pela Alice",
    mensagem:
      "Ana Souza · qui 08/10 às 10:00\nValor: R$ 797,72 no Pix\nOS 1625 · Técnico: Josué Barreto · Vendedora: Alice (IA)\nConfira a OS no app.",
  });
  assert.equal(n.titulo, "Agendamento feito pela Alice");
  assert.equal(n.corpo, "Ana Souza · qui 08/10 às 10:00 · R$ 797,72 no Pix");
  assert.equal(n.url, "/os/1625");
});
