import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adiarTarefa,
  bloqueadaParaVenda,
  campanhaSemResposta,
  finalizadoFora,
  guardadoFora,
  temLacuna,
  diaDeRever,
  emHorarioUtil,
  followUpEsquecido,
  horarioDaConfig,
  minutosUteis,
  motivosDeEntrada,
  proximoHorarioUtil,
  reverEmIso,
  textoFollowUpEsquecido,
  textoLeadSite,
  textoPosVenda,
  textoRemarcar,
  tipoTarefa,
} from "./furos";

// 2026-11-01 é domingo; 02/11 segunda; 07/11 sábado.
const H = horarioDaConfig(null);

test("horário útil: padrão seg–sáb 8h–19h; o que cai fora vai para o próximo útil", () => {
  assert.deepEqual(H, { dias: [1, 2, 3, 4, 5, 6], inicio: "08:00", fim: "19:00" });
  assert.equal(emHorarioUtil("2026-11-02T13:00:00Z", H), true); // seg 10h
  assert.equal(emHorarioUtil("2026-11-01T13:00:00Z", H), false); // dom
  assert.equal(emHorarioUtil("2026-11-02T23:00:00Z", H), false); // seg 20h
  // domingo 10h → segunda 8h
  assert.equal(proximoHorarioUtil("2026-11-01T13:00:00Z", H), "2026-11-02T11:00:00.000Z");
  // segunda 20h → terça 8h
  assert.equal(proximoHorarioUtil("2026-11-02T23:00:00Z", H), "2026-11-03T11:00:00.000Z");
  // segunda 6h → segunda 8h
  assert.equal(proximoHorarioUtil("2026-11-02T09:00:00Z", H), "2026-11-02T11:00:00.000Z");
  // dentro do horário: igual
  assert.equal(proximoHorarioUtil("2026-11-02T13:00:00Z", H), "2026-11-02T13:00:00Z");
  // empresa só de segunda a sexta: sábado 10h → segunda 8h
  const semSabado = horarioDaConfig({
    dias_uteis: [1, 2, 3, 4, 5],
    hora_inicio: "08:00:00",
    hora_fim: "18:00:00",
  });
  assert.equal(proximoHorarioUtil("2026-11-07T13:00:00Z", semSabado), "2026-11-09T11:00:00.000Z");
});

test("minutos úteis: só dentro do horário, atravessando a noite e o domingo", () => {
  // sábado 18h → segunda 9h: 60 min (sáb) + 60 min (seg) = 120
  assert.equal(minutosUteis("2026-11-07T21:00:00Z", new Date("2026-11-09T12:00:00Z"), H), 120);
  // dentro do mesmo dia
  assert.equal(minutosUteis("2026-11-02T13:00:00Z", new Date("2026-11-02T13:30:00Z"), H), 30);
  // começou de madrugada: conta a partir das 8h
  assert.equal(minutosUteis("2026-11-02T05:00:00Z", new Date("2026-11-02T12:00:00Z"), H), 60);
  assert.equal(minutosUteis("2026-11-02T13:00:00Z", new Date("2026-11-02T12:00:00Z"), H), 0);
});

test("próxima olhada por ação", () => {
  const hoje = "2026-11-01";
  // chamar amanhã → rever depois de amanhã
  assert.equal(
    diaDeRever({ acao: "chamar", quando: "2026-11-02T12:00:00-03:00", hoje }),
    "2026-11-03",
  );
  // agendar para 10/11 → véspera
  assert.equal(
    diaDeRever({ acao: "agendar", quando: "2026-11-10T12:00:00-03:00", hoje }),
    "2026-11-09",
  );
  // agendar para amanhã: a véspera seria hoje → amanhã
  assert.equal(
    diaDeRever({ acao: "agendar", quando: "2026-11-02T12:00:00-03:00", hoje }),
    "2026-11-02",
  );
  // esperar com data combinada / sem data (+7)
  assert.equal(
    diaDeRever({ acao: "esperar", quando: "2026-11-05T12:00:00-03:00", hoje }),
    "2026-11-05",
  );
  assert.equal(diaDeRever({ acao: "esperar", quando: null, hoje }), "2026-11-08");
  assert.equal(diaDeRever({ acao: "parar", quando: null, hoje }), null);
  assert.equal(reverEmIso("2026-11-08"), "2026-11-08T03:00:00.000Z");
  assert.equal(reverEmIso(null), null);
});

test("quem entra na noite: mensagem, próxima olhada, rede de segurança; fechado só por mensagem", () => {
  const base = {
    aberto: true,
    perdido: false,
    mensagemNoDia: false,
    reverEm: null,
    caixinha: 3,
    toqueFuturo: false,
    hoje: "2026-11-01",
  };
  assert.deepEqual(motivosDeEntrada({ ...base, mensagemNoDia: true }), ["mensagem"]);
  assert.deepEqual(motivosDeEntrada({ ...base, reverEm: "2026-11-01T03:00:00Z" }), ["rever"]);
  assert.deepEqual(motivosDeEntrada({ ...base, reverEm: "2026-11-03T03:00:00Z" }), []);
  assert.deepEqual(motivosDeEntrada(base), ["seguranca"]);
  assert.deepEqual(motivosDeEntrada({ ...base, toqueFuturo: true }), []);
  assert.deepEqual(motivosDeEntrada({ ...base, caixinha: 6 }), []);
  assert.deepEqual(motivosDeEntrada({ ...base, caixinha: null }), []);
  assert.deepEqual(motivosDeEntrada({ ...base, aberto: false, mensagemNoDia: true }), ["mensagem"]);
  assert.deepEqual(motivosDeEntrada({ ...base, aberto: false }), []);
  assert.deepEqual(motivosDeEntrada({ ...base, perdido: true, mensagemNoDia: true }), []);
});

test("campanha sem resposta: disparo que nunca respondeu fica fora da leitura", () => {
  const b = { entrada: "ativo", respondeuEm: null, recebeuDisparo: true };
  assert.equal(campanhaSemResposta(b), true);
  assert.equal(campanhaSemResposta({ ...b, respondeuEm: "2026-11-02T13:00:00Z" }), false);
  assert.equal(campanhaSemResposta({ ...b, recebeuDisparo: false }), false);
  assert.equal(campanhaSemResposta({ ...b, entrada: "receptivo" }), false);
  assert.equal(campanhaSemResposta({ ...b, entrada: null }), false);
});

test("follow-up esquecido: toque pendente vencido há mais de 12 h", () => {
  const agora = new Date("2026-11-01T23:00:00Z");
  assert.equal(
    followUpEsquecido(
      [
        { scheduledAt: "2026-11-01T20:00:00Z", status: "Pendente" },
        { scheduledAt: "2026-10-31T12:00:00Z", status: "Pendente" },
      ],
      agora,
    ),
    "2026-10-31T12:00:00Z",
  );
  assert.equal(
    followUpEsquecido([{ scheduledAt: "2026-11-01T20:00:00Z", status: "Pendente" }], agora),
    null,
  );
  assert.equal(
    followUpEsquecido([{ scheduledAt: "2026-10-31T12:00:00Z", status: "Concluída" }], agora),
    null,
  );
  assert.equal(
    textoFollowUpEsquecido("2026-10-31T13:00:00Z"),
    "Follow-up marcado para 31/10 10:00 não foi feito por ninguém.",
  );
});

test("tarefa que voltou: prioridade sobe, 2º adiamento avisa o admin", () => {
  assert.deepEqual(adiarTarefa({ prioridade: 3, adiamentos: 0 }), {
    prioridade: 2,
    adiamentos: 1,
    avisarAdmin: false,
  });
  assert.deepEqual(adiarTarefa({ prioridade: 1, adiamentos: 1 }), {
    prioridade: 1,
    adiamentos: 2,
    avisarAdmin: true,
  });
  assert.deepEqual(adiarTarefa({ prioridade: null, adiamentos: 2 }), {
    prioridade: 2,
    adiamentos: 3,
    avisarAdmin: false,
  });
});

test("caixinhas sem tarefa de venda e tipos de tarefa", () => {
  assert.equal(bloqueadaParaVenda(1), true);
  assert.equal(bloqueadaParaVenda(6), true);
  assert.equal(bloqueadaParaVenda(9), true);
  assert.equal(bloqueadaParaVenda(2), false);
  assert.equal(bloqueadaParaVenda(5), false);
  assert.equal(tipoTarefa("ligar"), "ligar");
  assert.equal(tipoTarefa("x"), "mensagem");
  assert.equal(tipoTarefa(null), "mensagem");
});

test("textos das tarefas sem IA", () => {
  const pv = textoPosVenda({ nome: "Ana", servico: "Higienização de sofá", osNumero: "1234" });
  assert.match(pv.motivo, /OS 1234/);
  assert.match(pv.mensagem, /Oi, Ana!.*higienização de sofá/s);
  assert.match(pv.mensagem, /Google/);
  assert.match(
    textoRemarcar({ nome: "", osNumero: null }).mensagem,
    /^Oi! Vi que a visita foi desmarcada/,
  );
  const ls = textoLeadSite({ nome: "Bia", servico: "Impermeabilização", lp: "lp-sofa" });
  assert.match(ls.motivo, /lp-sofa/);
  assert.match(ls.mensagem, /impermeabilização/);
});

test("feriado bloqueado não é dia útil: a tarefa vai para o próximo dia útil (02/11)", () => {
  // 20/11/2026 (sexta) bloqueado; 21/11 sábado é útil no padrão.
  const h = horarioDaConfig(null, ["2026-11-20"]);
  assert.equal(emHorarioUtil("2026-11-20T13:00:00Z", h), false);
  assert.equal(emHorarioUtil("2026-11-19T13:00:00Z", h), true);
  assert.equal(proximoHorarioUtil("2026-11-20T13:00:00Z", h), "2026-11-21T11:00:00.000Z");
  // Feriado emendado com domingo: pula os dois.
  const h2 = horarioDaConfig({ dias_uteis: [1, 2, 3, 4, 5] }, ["2026-11-20"]);
  assert.equal(proximoHorarioUtil("2026-11-20T13:00:00Z", h2), "2026-11-23T11:00:00.000Z");
  // Sem bloqueio, nada muda.
  assert.equal(
    proximoHorarioUtil("2026-11-20T13:00:00Z", horarioDaConfig(null)),
    "2026-11-20T13:00:00Z",
  );
});

test("lacuna: mensagem com espaço em branco nunca sai pronta", () => {
  assert.equal(temLacuna("fica R$ ___, e no Pix tem 5%"), true);
  assert.equal(temLacuna("Oi [nome], tudo bem?"), true);
  assert.equal(temLacuna("Oi {{1}}"), true);
  assert.equal(temLacuna("fica R$ X no Pix"), true);
  assert.equal(temLacuna("fica R$ ? no Pix"), true);
  assert.equal(temLacuna("fica R$ 364 em até 5x sem juros, ou R$ 345,80 no Pix"), false);
  assert.equal(temLacuna("Oi, Marina! Tudo certo?"), false);
  assert.equal(temLacuna(""), false);
  assert.equal(temLacuna(null), false);
});

test("finalizado fica fora da leitura; comprou com OS só por mensagem nova", () => {
  const b = { caixinha: 7, temOs: false, mensagemNoDia: true };
  assert.equal(finalizadoFora(b), true);
  assert.equal(finalizadoFora({ ...b, caixinha: 9 }), true);
  assert.equal(finalizadoFora({ ...b, caixinha: 8 }), true);
  assert.equal(finalizadoFora({ ...b, caixinha: 1 }), true);
  assert.equal(finalizadoFora({ ...b, caixinha: 1, temOs: true }), false);
  assert.equal(finalizadoFora({ ...b, caixinha: 1, temOs: true, mensagemNoDia: false }), true);
  assert.equal(finalizadoFora({ ...b, caixinha: 5 }), false);
  assert.equal(finalizadoFora({ ...b, caixinha: null }), false);
});

test("guardado para campanha: fora até o cliente falar de novo", () => {
  assert.equal(
    guardadoFora({ guardadoEm: "2026-11-04T15:00:00Z", clienteFalouDepois: false }),
    true,
  );
  assert.equal(
    guardadoFora({ guardadoEm: "2026-11-04T15:00:00Z", clienteFalouDepois: true }),
    false,
  );
  assert.equal(guardadoFora({ guardadoEm: null, clienteFalouDepois: false }), false);
});
