// Confirmação na véspera e pós-venda: datas, textos e o que fazer com a resposta (dados fictícios).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEM_LINK,
  STATUS_CONFIRMACAO,
  TEXTO_PADRAO,
  osElegivel,
  datasConfirmacao,
  datasPosVenda,
  diaDoServico,
  decidirResposta,
  dentroDe24h,
  estofadoPossessivo,
  janelaModelo,
  preencherCorpo,
  primeiroNome,
  problemaNoModelo,
  textoAvaliacao,
} from "./pos-atendimento";

test("datas: confirmação sempre na véspera e pós-venda sempre no dia seguinte, inclusive domingo", () => {
  assert.deepEqual(datasConfirmacao("2026-10-13"), ["2026-10-14"]); // terça
  assert.deepEqual(datasConfirmacao("2026-10-17"), ["2026-10-18"]); // sábado confirma domingo
  assert.deepEqual(datasConfirmacao("2026-10-18"), ["2026-10-19"]); // domingo confirma segunda
  assert.deepEqual(datasPosVenda("2026-10-14"), ["2026-10-13"]);
  assert.deepEqual(datasPosVenda("2026-10-18"), ["2026-10-17"]); // domingo: serviço de sábado
  assert.deepEqual(datasPosVenda("2026-10-19"), ["2026-10-18"]); // segunda: serviço de domingo
  // Na véspera o {{2}} da confirmação é sempre "amanhã".
  for (const hoje of ["2026-10-17", "2026-10-18", "2026-10-13"])
    assert.equal(diaDoServico(hoje, datasConfirmacao(hoje)[0]!), "amanhã");
});

test("nome, janela e estofado com possessivo (só o tipo)", () => {
  assert.equal(primeiroNome("ana clara teste"), "Ana");
  assert.equal(janelaModelo("10:00"), "10h e 11h");
  assert.equal(
    estofadoPossessivo([{ descricao: "Sofá retrátil 2 módulos, de 2,30 a 2,50 m", quantidade: 1 }]),
    "o seu sofá",
  );
  assert.equal(
    estofadoPossessivo([{ descricao: "Colchão casal — Higienização", quantidade: 1 }]),
    "o seu colchão",
  );
  assert.equal(estofadoPossessivo([{ descricao: "Poltrona", quantidade: 1 }]), "a sua poltrona");
  assert.equal(
    estofadoPossessivo([{ descricao: "Cadeira assento + encosto (unidade)", quantidade: 6 }]),
    "as suas cadeiras",
  );
  assert.equal(estofadoPossessivo([{ descricao: "Puff grande", quantidade: 1 }]), "o seu puff");
  assert.equal(
    estofadoPossessivo([
      { descricao: "Sofá comum 3 lugares", quantidade: 1 },
      { descricao: "Poltrona", quantidade: 2 },
    ]),
    "os seus estofados",
  );
  // O mesmo sofá nos dois serviços (higienização e impermeabilização) continua "o seu sofá".
  assert.equal(
    estofadoPossessivo([{ descricao: "Sofá comum 3 lugares — Higienização", quantidade: 1 }]),
    "o seu sofá",
  );
});

test("pós-venda com e sem pasta (o lugar do link explica que a equipe manda depois)", () => {
  const com = preencherCorpo(TEXTO_PADRAO.pos_venda, [
    "Ana",
    "https://drive.google.com/x",
    "Josué",
    "o seu sofá",
  ]);
  assert.ok(
    com.includes(
      "antes e depois: https://drive.google.com/x Como foi o atendimento do Josué? Ficou",
    ),
  );
  assert.ok(com.endsWith("Ficou tudo certo com o seu sofá depois do serviço?"));
  const sem = preencherCorpo(TEXTO_PADRAO.pos_venda, ["Ana", SEM_LINK, "Josué", "o seu sofá"]);
  assert.ok(sem.includes("antes e depois: a equipe te manda o link em seguida. Como foi"));
});

test("dia do serviço: amanhã ou dia da semana com data", () => {
  assert.equal(diaDoServico("2026-10-13", "2026-10-14"), "amanhã");
  assert.equal(diaDoServico("2026-10-17", "2026-10-18"), "amanhã");
  assert.equal(diaDoServico("2026-10-17", "2026-10-19"), "segunda-feira, 19/10");
  assert.equal(
    preencherCorpo(TEXTO_PADRAO.confirmacao, ["Ana", "segunda-feira, 19/10", "10h e 11h"]),
    "Oi, Ana, tudo bem? Alice aqui 💙 Passando para confirmar o seu serviço de segunda-feira, 19/10, com o técnico chegando entre 10h e 11h. Está tudo certo para realizarmos o serviço?",
  );
  assert.equal(
    preencherCorpo(TEXTO_PADRAO.confirmacao, ["Ana", "amanhã", "10h e 11h"]),
    "Oi, Ana, tudo bem? Alice aqui 💙 Passando para confirmar o seu serviço de amanhã, com o técnico chegando entre 10h e 11h. Está tudo certo para realizarmos o serviço?",
  );
  // Pós-venda sem "ontem" fixo no texto.
  assert.ok(!TEXTO_PADRAO.pos_venda.includes("ontem"));
});

test("janela de 24 h: aberta → texto livre; fechada → modelo", () => {
  const agora = new Date("2026-10-13T13:00:00Z");
  assert.equal(dentroDe24h(new Date("2026-10-13T02:00:00Z"), agora), true);
  assert.equal(dentroDe24h(new Date("2026-10-12T12:59:00Z"), agora), false);
  assert.equal(dentroDe24h(null, agora), false);
});

test("resposta à confirmação: confirmou registra; remarcar transfere (OS da equipe ou menos de 24 h)", () => {
  const conf = {
    tipo: "confirmacao" as const,
    restrito: true,
    osDaAlice: false,
    podeRemarcar: false,
    avaliacaoPossivel: false,
  };
  assert.deepEqual(
    {
      c: decidirResposta({ ...conf, resposta: "confirmou" }).confirmar,
      t: decidirResposta({ ...conf, resposta: "confirmou" }).transferir,
    },
    { c: true, t: null },
  );
  assert.equal(
    decidirResposta({ ...conf, resposta: "remarcar" }).transferir,
    "remarcação de véspera",
  );
  assert.equal(
    decidirResposta({ ...conf, resposta: "remarcar", osDaAlice: true, podeRemarcar: true })
      .transferir,
    null,
    "OS da Alice com mais de 24 h: ela mesma remarca",
  );
  assert.equal(
    decidirResposta({ ...conf, resposta: "outro" }).transferir,
    "outro assunto depois da confirmação/pós-venda",
  );
  assert.equal(decidirResposta({ ...conf, restrito: false, resposta: "outro" }).transferir, null);
});

test("resposta ao pós-venda: elogio pede avaliação (se puder); problema vai para garantia", () => {
  const pv = { tipo: "pos_venda" as const, restrito: true, osDaAlice: false, podeRemarcar: false };
  assert.equal(
    decidirResposta({ ...pv, resposta: "elogio", avaliacaoPossivel: true }).avaliar,
    true,
  );
  assert.equal(
    decidirResposta({ ...pv, resposta: "elogio", avaliacaoPossivel: false }).avaliar,
    false,
  );
  assert.equal(
    decidirResposta({ ...pv, resposta: "problema", avaliacaoPossivel: true }).transferir,
    "garantia",
  );
  assert.equal(
    decidirResposta({ ...pv, resposta: "problema", avaliacaoPossivel: true }).avaliar,
    false,
  );
});

test("texto da avaliação com nome, empresa e link", () => {
  const t = textoAvaliacao(
    "Que bom, {nome}! ... ajuda demais a {empresa} ... {link}",
    "Ana",
    "Turbine Clean",
    "https://g.page/x",
  );
  assert.equal(t, "Que bom, Ana! ... ajuda demais a Turbine Clean ... https://g.page/x");
});

test("modelos antigos nunca são usados; os _v2 com o texto novo sim", () => {
  assert.match(
    problemaNoModelo("confirmacao", "tc_confirmacao_servico", TEXTO_PADRAO.confirmacao) ?? "",
    /antigo/,
  );
  assert.match(
    problemaNoModelo("pos_venda", "tc_pos_venda", TEXTO_PADRAO.pos_venda) ?? "",
    /antigo/,
  );
  assert.equal(
    problemaNoModelo("confirmacao", "tc_confirmacao_servico_v2", TEXTO_PADRAO.confirmacao),
    null,
  );
  assert.equal(problemaNoModelo("pos_venda", "tc_pos_venda_v2", TEXTO_PADRAO.pos_venda), null);
  // Texto antigo com outro nome também não vai.
  assert.match(
    problemaNoModelo(
      "confirmacao",
      "outro",
      "Oi, {{1}}! Confirmando o serviço de amanhã, entre {{2}}.",
    ) ?? "",
    /variáveis/,
  );
  assert.match(
    problemaNoModelo(
      "pos_venda",
      "outro",
      "{{1}} {{2}} Como foi o atendimento do {{3}} ontem? {{4}}",
    ) ?? "",
    /ontem/,
  );
});

test("confirmação pega visita agendada e remarcada; nunca concluída nem cancelada", () => {
  assert.deepEqual(STATUS_CONFIRMACAO, ["Agendado", "Reagendado"]);
  assert.ok(!STATUS_CONFIRMACAO.includes("Concluído"));
  assert.ok(!STATUS_CONFIRMACAO.includes("Cancelado"));
});

test("OS de teste, excluída ou cancelada não recebe confirmação nem pós-venda", () => {
  const base = { deleted_at: null, status: "Agendada", eh_teste: false };
  assert.equal(osElegivel(base), true);
  assert.equal(osElegivel({ ...base, eh_teste: true }), false);
  assert.equal(osElegivel({ ...base, deleted_at: "2026-10-14T10:00:00Z" }), false);
  assert.equal(osElegivel({ ...base, status: "Cancelada" }), false);
  assert.equal(osElegivel(null), false);
  // OS antiga sem o campo (banco anterior à coluna) continua elegível.
  assert.equal(osElegivel({ deleted_at: null, status: "Agendada" }), true);
});
