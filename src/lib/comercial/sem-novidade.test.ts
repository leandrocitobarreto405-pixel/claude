import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARCA_VESPERA,
  blocoDaVespera,
  diasNaLista,
  ehTarefaDeVenda,
  escolherExemplos,
  lerOuPular,
  linhaDasNaoFeitas,
  notasDaQueVoltou,
  resumoComNaoFeitas,
  saiParaCampanha,
  seloDaQueVoltou,
  tarefaDaVespera,
  type ExemploPulado,
  type SinaisDoLead,
} from "./sem-novidade";

// Noite de 12/11 às 21h30 de São Paulo; a última leitura foi na noite de 11/11.
const o = {
  agora: new Date("2026-11-13T00:30:00Z"),
  fimDeHoje: "2026-11-13T02:59:59Z",
  fimDeAmanha: "2026-11-14T02:59:59Z",
};
const LIDA = "2026-11-12T00:40:00Z";
const base: SinaisDoLead = {
  lidaEm: LIDA,
  completaEm: "2026-11-10T00:40:00Z",
  resumoAte: "2026-11-11T18:00:00Z",
  esquecido: false,
  ultimaMensagemEm: null,
  app: { orcamento: null, os: null, visita: null, pagamento: null, tarefa: null },
  reverEm: null,
  reverMotivo: null,
  retornoEm: null,
  tarefaPendente: false,
};
const com = (x: Partial<SinaisDoLead>): SinaisDoLead => ({ ...base, ...x });
const app = (x: Partial<SinaisDoLead["app"]>) => ({ ...base.app, ...x });

test("sem novidade: fica como está, com a tarefa na lista, a data combinada ou nada", () => {
  assert.deepEqual(lerOuPular(base, o), { passa: false, situacao: "sem_pendencia" });
  assert.deepEqual(lerOuPular(com({ tarefaPendente: true }), o), {
    passa: false,
    situacao: "tarefa_na_lista",
  });
  assert.deepEqual(lerOuPular(com({ reverEm: "2026-11-18T03:00:00Z" }), o), {
    passa: false,
    situacao: "esperando_data",
  });
  // O que já estava coberto pelo resumo ou aconteceu antes da leitura não é novidade.
  const antigo = com({
    ultimaMensagemEm: "2026-11-11T18:00:00Z",
    app: app({ orcamento: "2026-11-11T15:00:00Z", visita: LIDA }),
    retornoEm: "2026-11-11T12:00:00Z",
  });
  assert.equal(lerOuPular(antigo, o).passa, false);
});

test("passa pela IA: lead novo, follow-up esquecido e releitura a cada 7 dias", () => {
  assert.deepEqual(lerOuPular(com({ lidaEm: null }), o), { passa: true, motivo: "lead_novo" });
  assert.deepEqual(lerOuPular(com({ esquecido: true }), o), {
    passa: true,
    motivo: "follow_up_esquecido",
  });
  assert.deepEqual(lerOuPular(com({ completaEm: "2026-11-06T00:40:00Z" }), o), {
    passa: true,
    motivo: "releitura_semanal",
  });
  assert.equal(lerOuPular(com({ completaEm: "2026-11-06T03:00:00Z" }), o).passa, false);
  // Sem saber quando foi a última leitura completa, relê.
  assert.deepEqual(lerOuPular(com({ completaEm: null }), o), {
    passa: true,
    motivo: "releitura_semanal",
  });
});

test("passa pela IA: mensagem nova, do cliente ou nossa", () => {
  assert.deepEqual(lerOuPular(com({ ultimaMensagemEm: "2026-11-12T14:00:00Z" }), o), {
    passa: true,
    motivo: "mensagem_nova",
  });
  // Sem resumo guardado vale a hora da leitura, com 5 minutos de folga para trás.
  const semResumo = (em: string) => com({ resumoAte: null, ultimaMensagemEm: em });
  assert.equal(lerOuPular(semResumo("2026-11-12T00:30:00Z"), o).passa, false);
  assert.equal(lerOuPular(semResumo("2026-11-12T00:37:00Z"), o).passa, true);
  assert.equal(lerOuPular(semResumo("2026-11-12T09:00:00Z"), o).passa, true);
});

test("passa pela IA: novidade no app depois da leitura", () => {
  for (const [campo, nome] of [
    ["orcamento", "orçamento"],
    ["os", "OS"],
    ["visita", "visita"],
    ["pagamento", "pagamento"],
    ["tarefa", "tarefa"],
  ] as const)
    assert.deepEqual(lerOuPular(com({ app: app({ [campo]: "2026-11-12T15:00:00Z" }) }), o), {
      passa: true,
      motivo: "novidade_no_app",
      detalhe: nome,
    });
});

test("rever em: com a tarefa ainda na lista não é novidade; data combinada é", () => {
  const venceu = "2026-11-12T03:00:00Z";
  for (const motivo of ["ver se respondeu à tarefa", "ver se remarcou"])
    assert.deepEqual(
      lerOuPular(com({ reverEm: venceu, reverMotivo: motivo, tarefaPendente: true }), o),
      { passa: false, situacao: "tarefa_na_lista" },
    );
  // A tarefa saiu da lista (feita, pulada ou cancelada): a conferência é da IA.
  assert.deepEqual(
    lerOuPular(com({ reverEm: venceu, reverMotivo: "ver se respondeu à tarefa" }), o),
    { passa: true, motivo: "rever_chegou" },
  );
  // Véspera da data combinada: é quando a mensagem do dia é escrita, mesmo com a tarefa na lista.
  assert.deepEqual(
    lerOuPular(
      com({ reverEm: venceu, reverMotivo: "véspera da data combinada", tarefaPendente: true }),
      o,
    ),
    { passa: true, motivo: "rever_chegou" },
  );
  assert.equal(
    lerOuPular(com({ reverEm: venceu, reverMotivo: "esperando o cliente" }), o).passa,
    true,
  );
  // Rever em que ainda não chegou e data que não se lê.
  assert.equal(lerOuPular(com({ reverEm: "2026-11-13T03:00:00Z" }), o).passa, false);
  assert.equal(lerOuPular(com({ reverEm: "data ruim" }), o).passa, true);
});

test("retorno combinado chegando (até amanhã) passa; o que já tinha passado na leitura, não", () => {
  assert.deepEqual(lerOuPular(com({ retornoEm: "2026-11-13T15:00:00Z" }), o), {
    passa: true,
    motivo: "retorno_combinado",
  });
  assert.equal(lerOuPular(com({ retornoEm: "2026-11-12T13:00:00Z" }), o).passa, true);
  assert.equal(lerOuPular(com({ retornoEm: "2026-11-20T15:00:00Z" }), o).passa, false);
  assert.equal(lerOuPular(com({ retornoEm: "2026-11-11T15:00:00Z" }), o).passa, false);
});

test("exemplos da noite: até 5, primeiro quem tem tarefa na lista", () => {
  const e = (lead: string, tarefa: boolean, lidaEm: string): ExemploPulado => ({
    lead,
    final: "0000",
    situacao: tarefa ? "tarefa_na_lista" : "esperando_data",
    caixinha: 2,
    lidaEm,
    ultimaMensagemEm: null,
    reverEm: null,
    tarefa: tarefa ? { criadaEm: lidaEm, adiamentos: 1 } : null,
  });
  const lista = [
    e("s1", false, "2026-11-11T00:00:00Z"),
    e("t1", true, "2026-11-11T00:00:00Z"),
    e("s2", false, "2026-11-09T00:00:00Z"),
    e("t2", true, "2026-11-08T00:00:00Z"),
    e("s3", false, "2026-11-10T00:00:00Z"),
    e("t3", true, "2026-11-10T00:00:00Z"),
    e("t4", true, "2026-11-09T00:00:00Z"),
  ];
  assert.deepEqual(
    escolherExemplos(lista).map((x) => x.lead),
    ["t2", "t4", "t3", "s2", "s3"],
  );
  assert.deepEqual(
    escolherExemplos(lista.filter((x) => x.tarefa)).map((x) => x.lead),
    ["t2", "t4", "t3", "t1"],
  );
  assert.deepEqual(escolherExemplos([]), []);
});

test("7 dias na lista sem resposta: só tarefa de venda vai para a campanha", () => {
  const hoje = "2026-11-12";
  assert.equal(diasNaLista("2026-11-06T00:40:00Z", hoje), 7); // criada na noite de 05/11
  assert.equal(diasNaLista("2026-11-07T00:40:00Z", hoje), 6);
  const t = (tipo: string | null, criadaEm: string, ultimaDoCliente: string | null = null) =>
    saiParaCampanha({ tipo, criadaEm, ultimaDoCliente, hoje });
  assert.equal(t("mensagem", "2026-11-06T00:40:00Z"), true);
  assert.equal(t(null, "2026-11-06T00:40:00Z"), true);
  assert.equal(t("ligar", "2026-11-01T12:00:00Z", "2026-10-30T12:00:00Z"), true);
  assert.equal(t("mensagem", "2026-11-07T00:40:00Z"), false);
  // O cliente respondeu depois que a tarefa nasceu: não é "sem resposta".
  assert.equal(t("mensagem", "2026-11-06T00:40:00Z", "2026-11-08T12:00:00Z"), false);
  for (const tipo of ["pos_venda", "remarcar"])
    assert.equal(t(tipo, "2026-11-01T00:40:00Z"), false, tipo);
  assert.equal(ehTarefaDeVenda("follow_up_esquecido"), true);
});

test("tarefa que voltou: notas com um prefixo só e selo com o contador", () => {
  assert.equal(
    notasDaQueVoltou("Tatiana: chamar", 1),
    "Pendente de ontem (1ª vez). Tatiana: chamar",
  );
  assert.equal(
    notasDaQueVoltou("Pendente de ontem (2ª vez). Pendente de ontem (1ª vez). Tatiana: chamar", 3),
    "Pendente de ontem (3ª vez). Tatiana: chamar",
  );
  // A marca da visita vencida continua nas notas.
  const marca = "[vencida:2fe2c26f-1fed-4c41-949a-c87f960952ba:2026-11-09]";
  assert.ok(
    notasDaQueVoltou(`Pendente de ontem (6ª vez). Tatiana: visita ${marca}`, 7).endsWith(marca),
  );
  assert.equal(notasDaQueVoltou(null, 1), "Pendente de ontem (1ª vez). ");
  assert.equal(seloDaQueVoltou(0), null);
  assert.equal(seloDaQueVoltou(1), "Pendente de ontem");
  assert.equal(seloDaQueVoltou(3), "Volta há 3 dias");
});

test("cobrança das não feitas: quem ficou e há quantos dias, pedindo o motivo", () => {
  assert.equal(linhaDasNaoFeitas([]), null);
  assert.equal(
    linhaDasNaoFeitas([{ nome: "Ana", dias: 1 }]),
    "1 tarefa de ontem sem fazer: Ana. Se não deu para fazer, toque em Pular e conte o motivo.",
  );
  assert.equal(
    linhaDasNaoFeitas([
      { nome: "Ana", dias: 1 },
      { nome: "Bia", dias: 3 },
      { nome: "", dias: 2 },
    ]),
    "3 tarefas de ontem sem fazer: Bia (há 3 dias), cliente sem nome (há 2 dias), Ana. Se não deu para fazer, toque em Pular e conte o motivo.",
  );
  const muitas = Array.from({ length: 8 }, (_, i) => ({ nome: `Cliente${i}`, dias: 1 }));
  assert.match(linhaDasNaoFeitas(muitas) ?? "", /^8 tarefas de ontem sem fazer: .* e mais 3\. /);
  // O resumo gravado nunca passa do limite do banco (600) e a cobrança vem primeiro.
  const linha = linhaDasNaoFeitas(muitas) as string;
  const junto = resumoComNaoFeitas(linha, "x".repeat(900));
  assert.equal(junto.length, 600);
  assert.ok(junto.startsWith(linha));
  assert.equal(resumoComNaoFeitas(null, "Meta do mês em dia."), "Meta do mês em dia.");
  assert.ok(!linha.includes("—"));
});

test("véspera: acha a tarefa com rascunho que cai até amanhã e monta o aviso para a IA", () => {
  const fim = "2026-11-14T02:59:59Z";
  const t = (scheduled_at: string, notes: string | null) => ({ scheduled_at, notes, motivo: "x" });
  const amanha = t("2026-11-13T12:00:00Z", `Tatiana: retomar ${MARCA_VESPERA}`);
  assert.equal(
    tarefaDaVespera([t("2026-11-13T12:00:00Z", "Tatiana: retomar"), amanha], fim),
    amanha,
  );
  // Ainda falta para a data, ou a tarefa não nasceu com rascunho: não é a véspera.
  assert.equal(tarefaDaVespera([t("2026-11-16T12:00:00Z", MARCA_VESPERA)], fim), null);
  assert.equal(tarefaDaVespera([t("2026-11-13T12:00:00Z", null)], fim), null);
  const bloco = blocoDaVespera({
    scheduled_at: "2026-11-13T12:00:00Z",
    motivo: "Retomar o orçamento do sofá",
  });
  assert.match(bloco, /marcada para 2026-11-13T09:00 \(Retomar o orçamento do sofá\)/);
  assert.match(bloco, /acao "agendar", quando 2026-11-13T09:00/);
  assert.match(bloco, /não use como motivo para esperar/);
  assert.equal(bloco.split("\n").length, 3);
});
