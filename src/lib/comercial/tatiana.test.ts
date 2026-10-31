import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITE_TAREFAS_DIA,
  aplicarTravas,
  cobrancasVisiveis,
  comNome,
  desdeAUltimaPassada,
  finalDoTelefone,
  demorasDaEquipe,
  entraNaNoite,
  fraseReserva,
  FRASES_RESERVA,
  nomeDaPessoa,
  nomesDaEquipe,
  padraoFaria,
  pendenteAntiga,
  quandoParaIso,
  resolvidaPeloApp,
  semanaPorPessoa,
  tempoTexto,
  textoPushCobrancas,
  textoPushTarefas,
} from "./tatiana";

test("tempoTexto: minutos, horas e dias", () => {
  assert.equal(tempoTexto(14), "14 min");
  assert.equal(tempoTexto(60), "1 h");
  assert.equal(tempoTexto(95), "1 h 35 min");
  assert.equal(tempoTexto(60 * 50), "2 dia(s)");
});

test("demorasDaEquipe: só cobra a equipe e destaca lead de anúncio", () => {
  const d = demorasDaEquipe({
    primeiraRespostaMin: 40,
    primeiraRespostaDe: "equipe",
    tempoAtePrecoMin: 130,
    anuncio: true,
  });
  assert.deepEqual(
    d.map((x) => x.tipo),
    ["demora_resposta", "demora_preco"],
  );
  assert.match(d[0]!.texto, /40 min \(lead de anúncio\)/);
  // a Alice respondeu primeiro: sem cobrança de 1ª resposta
  assert.deepEqual(
    demorasDaEquipe({
      primeiraRespostaMin: 40,
      primeiraRespostaDe: "alice",
      tempoAtePrecoMin: 30,
      anuncio: false,
    }),
    [],
  );
  // dentro do limite
  assert.deepEqual(
    demorasDaEquipe({
      primeiraRespostaMin: 15,
      primeiraRespostaDe: "equipe",
      tempoAtePrecoMin: 60,
      anuncio: false,
    }),
    [],
  );
});

test("resolvidaPeloApp: cada tipo olha a coisa certa no app", () => {
  const criadaEm = "2026-10-30T00:30:00Z";
  const vazio = { orcamentos: [], temOs: false, visitas: [], pagamentoLancado: false };
  assert.equal(resolvidaPeloApp({ tipo: "orcamento_sem_app", criadaEm }, vazio), false);
  assert.equal(
    resolvidaPeloApp(
      { tipo: "orcamento_sem_app", criadaEm },
      { ...vazio, orcamentos: [{ criadoEm: "2026-10-30T12:00:00Z" }] },
    ),
    true,
  );
  // orçamento antigo (de semanas antes) não resolve
  assert.equal(
    resolvidaPeloApp(
      { tipo: "orcamento_sem_app", criadaEm },
      { ...vazio, orcamentos: [{ criadoEm: "2026-10-01T12:00:00Z" }] },
    ),
    false,
  );
  assert.equal(
    resolvidaPeloApp({ tipo: "fechou_sem_os", criadaEm }, { ...vazio, temOs: true }),
    true,
  );
  assert.equal(
    resolvidaPeloApp(
      { tipo: "concluir_os", criadaEm },
      {
        ...vazio,
        visitas: [{ data: null, status: "Concluído", atualizadaEm: "2026-10-30T12:00:00Z" }],
      },
    ),
    true,
  );
  assert.equal(
    resolvidaPeloApp({ tipo: "pagamento", criadaEm }, { ...vazio, pagamentoLancado: true }),
    true,
  );
  assert.equal(resolvidaPeloApp({ tipo: "cadastro", criadaEm }, { ...vazio, temOs: true }), false);
});

test("fraseReserva: não repete as recentes e usa o nome", () => {
  const recentes = FRASES_RESERVA.slice(0, 7).map((f) => f.replaceAll("{nome}", "Maria"));
  const f = fraseReserva("Maria", recentes, 3);
  assert.ok(f.includes("Maria"));
  assert.ok(!recentes.includes(f));
  // todas usadas: volta a escolher entre todas
  const todas = FRASES_RESERVA.map((x) => x.replaceAll("{nome}", "Carol"));
  assert.ok(todas.includes(fraseReserva("Carol", todas, 5)));
});

test("pushes: singular, plural e por empresa", () => {
  assert.equal(textoPushTarefas(1, null).titulo, "A Tatiana separou 1 tarefa pra você hoje");
  assert.equal(textoPushTarefas(6, "Bora!").titulo, "A Tatiana separou 6 tarefas pra você hoje");
  const c = textoPushCobrancas({ empresa: "Turbine", total: 5, resolvidas: 1, pendentes: 4 });
  assert.equal(c.corpo, "Hoje a Tatiana fez 5 cobranças: 1 resolvida, 4 pendentes.");
  assert.match(c.titulo, /^Turbine/);
});

test("entraNaNoite: só lead aberto com mensagem nova do cliente, orçamento novo ou toque perto", () => {
  const base = {
    aberto: true,
    clienteEscreveu: false,
    orcamentoNovo: false,
    toqueEmAte2Dias: false,
  };
  assert.equal(entraNaNoite(base), false);
  assert.equal(entraNaNoite({ ...base, clienteEscreveu: true }), true);
  assert.equal(entraNaNoite({ ...base, orcamentoNovo: true }), true);
  assert.equal(entraNaNoite({ ...base, toqueEmAte2Dias: true }), true);
  assert.equal(entraNaNoite({ ...base, aberto: false, clienteEscreveu: true }), false);
});

test("desdeAUltimaPassada: última passada, 24 h sem ela, no máximo 3 dias", () => {
  const agora = new Date("2026-10-31T00:30:00Z");
  assert.equal(desdeAUltimaPassada(null, agora), "2026-10-30T00:30:00.000Z");
  assert.equal(desdeAUltimaPassada("2026-10-30T00:30:05Z", agora), "2026-10-30T00:30:05.000Z");
  assert.equal(desdeAUltimaPassada("2026-10-01T00:30:00Z", agora), "2026-10-28T00:30:00.000Z");
});

test("travas da noite: tarefa só para caixinhas 2 a 5 e sem outro toque, retorno ou campanha", () => {
  const livre = { retornoCombinado: false, toqueMarcado: false, campanha30Dias: false };
  assert.deepEqual(aplicarTravas({ caixinha: 2, acao: "chamar" }, livre), {
    acao: "chamar",
    trava: null,
    campanhaDaSemana: false,
  });
  const seis = aplicarTravas({ caixinha: 6, acao: "chamar" }, livre);
  assert.equal(seis.acao, "esperar");
  assert.equal(seis.campanhaDaSemana, true);
  assert.equal(aplicarTravas({ caixinha: 6, acao: "parar" }, livre).acao, "parar");
  assert.equal(
    aplicarTravas({ caixinha: 1, acao: "chamar" }, livre).trava,
    "comprou: só pós-venda",
  );
  assert.equal(aplicarTravas({ caixinha: 7, acao: "agendar" }, livre).acao, "esperar");
  assert.equal(
    aplicarTravas({ caixinha: 3, acao: "agendar" }, { ...livre, retornoCombinado: true }).trava,
    "retorno combinado",
  );
  assert.equal(
    aplicarTravas({ caixinha: 4, acao: "chamar" }, { ...livre, toqueMarcado: true }).trava,
    "já tem toque marcado",
  );
  assert.match(
    aplicarTravas({ caixinha: 5, acao: "chamar" }, { ...livre, campanha30Dias: true }).trava ?? "",
    /30 dias/,
  );
  assert.equal(
    aplicarTravas({ caixinha: 5, acao: "esperar" }, { ...livre, toqueMarcado: true }).trava,
    null,
  );
});

test("acertos na lista da equipe: até 10, pela ordem dos tipos e prioridade", () => {
  const novas = [
    { id: "d", tipo: "demora_resposta" as const, prioridade: 1 },
    { id: "r", tipo: "remarcar" as const, prioridade: 1 },
    { id: "p2", tipo: "pagamento" as const, prioridade: 2 },
    { id: "f", tipo: "fechou_sem_os" as const, prioridade: 5 },
    { id: "p1", tipo: "pagamento" as const, prioridade: 1 },
  ];
  assert.deepEqual(cobrancasVisiveis(novas), ["f", "p1", "p2", "r"]);
  assert.deepEqual(cobrancasVisiveis(novas, 2), ["f", "p1"]);
  assert.equal(LIMITE_TAREFAS_DIA, 15);
  assert.equal(finalDoTelefone("(11) 99400-0001"), "94000001");
});

test("padraoFaria e quandoParaIso", () => {
  assert.equal(padraoFaria(null), "nada marcado");
  assert.equal(
    padraoFaria({ etapa: "A2", quando: "2026-10-30T13:00:00Z", responsavel: "alice" }),
    "toque A2 (Alice) em 30/10 10:00",
  );
  assert.equal(
    padraoFaria({ etapa: null, quando: "2026-10-30T13:00:00Z", responsavel: "equipe" }),
    "toque (equipe) em 30/10 10:00",
  );
  assert.equal(quandoParaIso("2026-10-31T10:00"), "2026-10-31T13:00:00.000Z");
  assert.equal(quandoParaIso("amanhã"), null);
});

test("semanaPorPessoa e pendenteAntiga", () => {
  const agora = new Date("2026-10-30T12:00:00Z");
  const r = semanaPorPessoa(
    [
      { userId: "m", situacao: "pendente", criadaEm: "2026-10-29T12:00:00Z", resolvidaEm: null },
      {
        userId: "m",
        situacao: "resolvida",
        criadaEm: "2026-10-28T12:00:00Z",
        resolvidaEm: "2026-10-28T16:00:00Z",
      },
      { userId: "m", situacao: "ja_certo", criadaEm: "2026-10-20T12:00:00Z", resolvidaEm: null },
      { userId: null, situacao: "pendente", criadaEm: "2026-10-29T12:00:00Z", resolvidaEm: null },
    ],
    agora,
  );
  const m = r.find((x) => x.userId === "m")!;
  assert.deepEqual(
    { semana: m.semana, anterior: m.anterior, resolvidas: m.resolvidas, pendentes: m.pendentes },
    { semana: 2, anterior: 1, resolvidas: 1, pendentes: 1 },
  );
  assert.equal(m.horasMedias, 4);
  assert.equal(r.find((x) => x.userId === null)!.pendentes, 1);
  assert.equal(
    pendenteAntiga({ situacao: "pendente", criadaEm: "2026-10-27T12:00:00Z" }, agora),
    true,
  );
  assert.equal(
    pendenteAntiga({ situacao: "pendente", criadaEm: "2026-10-29T12:00:00Z" }, agora),
    false,
  );
  assert.equal(
    pendenteAntiga({ situacao: "resolvida", criadaEm: "2026-10-20T12:00:00Z" }, agora),
    false,
  );
});

test("nome no recado: só o nome do cadastro, nunca o e-mail; sem nome, sem nome", () => {
  assert.equal(nomeDaPessoa("Maria", "usuario123@exemplo.com"), "Maria");
  assert.equal(nomeDaPessoa("maria germano", null), "Maria");
  assert.equal(nomeDaPessoa("usuario123", "usuario123@exemplo.com"), "");
  assert.equal(nomeDaPessoa("Carol", "carol@exemplo.com"), "Carol");
  assert.equal(nomeDaPessoa("x@y.com", null), "");
  assert.equal(nomeDaPessoa("", "a@b.com"), "");
  assert.equal(
    comNome("Bom dia, {nome}! Bora vender 💙", "Carol"),
    "Bom dia, Carol! Bora vender 💙",
  );
  assert.equal(comNome("Bom dia, {nome}! Bora vender 💙", ""), "Bom dia! Bora vender 💙");
  assert.equal(
    comNome("{nome}, bora fazer dinheiro, time! 💙", ""),
    "Bora fazer dinheiro, time! 💙",
  );
  assert.equal(comNome("Bora fazer acontecer hoje, {nome}!", ""), "Bora fazer acontecer hoje!");
  for (const f of FRASES_RESERVA) assert.doesNotMatch(comNome(f, ""), /\{nome\}|^,|\s,/);
});

test("equipe única: nomes no recado e push para a equipe", () => {
  assert.equal(nomesDaEquipe(["Maria", "Carol"]), "Maria e Carol");
  assert.equal(nomesDaEquipe(["Ana", "Bia", "Carol", "Bia"]), "Ana, Bia e Carol");
  assert.equal(nomesDaEquipe(["Maria", ""]), "Maria");
  assert.equal(nomesDaEquipe([]), "");
  assert.equal(
    comNome("Bom dia, {nome}! Bora vender 💙", nomesDaEquipe(["Maria", "Carol"])),
    "Bom dia, Maria e Carol! Bora vender 💙",
  );
  assert.equal(
    textoPushTarefas(5, null, true).titulo,
    "A Tatiana separou 5 tarefas pra equipe hoje",
  );
});
