import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comNome,
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

test("entraNaNoite: só lead aberto com novidade ou toque perto", () => {
  const agora = new Date("2026-10-30T00:30:00Z");
  const base = {
    aberto: true,
    temOrcamento: true,
    ultimaMensagem: "2026-10-29T15:00:00Z",
    ultimaDecisao: "2026-10-29T00:30:00Z",
    toqueEmAte2Dias: false,
    agora,
  };
  assert.equal(entraNaNoite(base), true);
  assert.equal(entraNaNoite({ ...base, aberto: false }), false);
  assert.equal(entraNaNoite({ ...base, ultimaDecisao: "2026-10-29T16:00:00Z" }), false);
  assert.equal(
    entraNaNoite({ ...base, ultimaDecisao: "2026-10-29T16:00:00Z", toqueEmAte2Dias: true }),
    true,
  );
  // sem orçamento e conversa velha: fora
  assert.equal(
    entraNaNoite({ ...base, temOrcamento: false, ultimaMensagem: "2026-10-01T15:00:00Z" }),
    false,
  );
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
  assert.equal(nomeDaPessoa("ecoprimeoficial", "ecoprimeoficial@exemplo.com"), "");
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
