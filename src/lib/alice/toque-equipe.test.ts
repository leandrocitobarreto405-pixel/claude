import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ETAPAS_EQUIPE,
  mensagemDaSequencia,
  passoDaEtapa,
  primeiraAtendente,
  rotuloDoToque,
} from "./cadencia";
import { aberturaDoToque, mensagemReserva, mensagemValida } from "./toque-equipe";

test("follow-up: o 3 e o 4 da trilha A são da equipe; o resto é da Alice", () => {
  assert.deepEqual([...ETAPAS_EQUIPE], ["A3", "A4"]);
  assert.equal(passoDaEtapa("A3")?.equipe, true);
  assert.equal(passoDaEtapa("A5")?.equipe, undefined);
  assert.equal(passoDaEtapa("B3")?.equipe, undefined);
});

test("follow-up: primeira atendente pela configuração", () => {
  assert.equal(primeiraAtendente("a Maria e a Carol"), "Maria");
  assert.equal(primeiraAtendente("Ana, Bia"), "Ana");
  assert.equal(primeiraAtendente(""), null);
  assert.equal(primeiraAtendente(null), null);
});

test("follow-up: numeração de cada toque", () => {
  const o = { atendente: "Maria" };
  assert.equal(rotuloDoToque("A1", o), "Follow-up 1 de 5 · Alice");
  assert.equal(rotuloDoToque("A2", o), "Follow-up 2 de 5 · Alice");
  assert.equal(rotuloDoToque("A3", o), "Follow-up 3 de 5 · Maria");
  assert.equal(rotuloDoToque("A4", o), "Follow-up 4 de 5 · Maria");
  assert.equal(rotuloDoToque("A5", o), "Follow-up 5 de 5 · desconto · Alice");
  assert.equal(rotuloDoToque("A_FIM", o), "Encerramento · Alice");
  assert.equal(rotuloDoToque("B1", o), "Follow-up 1 de 4 · Alice");
  assert.equal(rotuloDoToque("VC", o), "Voltar na conversa · Maria");
  assert.equal(rotuloDoToque("A3", {}), "Follow-up 3 de 5 · equipe");
  assert.equal(rotuloDoToque("G1", o), null);
});

test("follow-up: mensagem da equipe pela tarefa do 3/4 não para a sequência", () => {
  const tarefas = [
    {
      scheduled_at: "2026-11-06T13:00:00Z",
      completed_at: "2026-11-06T14:00:00Z",
      status: "Concluída",
    },
  ];
  assert.equal(mensagemDaSequencia("2026-11-06T13:40:00Z", tarefas), true);
  assert.equal(mensagemDaSequencia("2026-11-06T15:30:00Z", tarefas), true);
  assert.equal(mensagemDaSequencia("2026-11-06T17:00:00Z", tarefas), false);
  assert.equal(mensagemDaSequencia("2026-11-05T20:00:00Z", tarefas), false);
  // Tarefa ainda aberta: vale até ser feita.
  const aberta = [{ scheduled_at: "2026-11-06T13:00:00Z", completed_at: null, status: "Pendente" }];
  assert.equal(mensagemDaSequencia("2026-11-07T12:00:00Z", aberta), true);
  const cancelada = [{ ...aberta[0]!, status: "Cancelada" }];
  assert.equal(mensagemDaSequencia("2026-11-06T13:30:00Z", cancelada), false);
});

test("toque da equipe: abertura do 3 com a atendente se apresentando", () => {
  const e = {
    etapa: "A3" as const,
    nomeCliente: "Ana",
    atendente: "Maria",
    empresa: "Turbine Clean",
  };
  assert.equal(
    aberturaDoToque(e),
    "Oi, Ana, tudo bem? Aqui é a Maria, da equipe da Turbine Clean. A Alice me passou seu orçamento",
  );
  assert.equal(
    aberturaDoToque({ ...e, nomeCliente: null }),
    "Oi, tudo bem? Aqui é a Maria, da equipe da Turbine Clean. A Alice me passou seu orçamento",
  );
  assert.ok(mensagemValida(mensagemReserva(e), e));
  assert.ok(mensagemValida(mensagemReserva({ ...e, etapa: "A4" }), { ...e, etapa: "A4" }));
  assert.ok(mensagemValida(mensagemReserva({ ...e, etapa: "VC" }), { ...e, etapa: "VC" }));
});

test("toque da equipe: trava das regras da mensagem", () => {
  const e = {
    etapa: "A3" as const,
    nomeCliente: "Ana",
    atendente: "Maria",
    empresa: "Turbine Clean",
  };
  const ab = aberturaDoToque(e);
  assert.ok(
    mensagemValida(`${ab} e eu queria te ajudar com o sofá. Qual dia fica melhor pra você?`, e),
  );
  // Sem a abertura do 3.
  assert.equal(mensagemValida("Oi, Ana! Qual dia fica melhor pra você?", e), false);
  // Condição, dúvida e duas perguntas.
  assert.equal(mensagemValida(`${ab} e consegui uma condição melhor. Quer ver?`, e), false);
  assert.equal(mensagemValida(`${ab}. Ficou alguma dúvida?`, e), false);
  assert.equal(mensagemValida(`${ab}. Viu o vídeo? Qual dia fica melhor?`, e), false);
  // Sem pergunta no fim.
  assert.equal(mensagemValida(`${ab} e estou à disposição.`, e), false);
  // Lacuna.
  assert.equal(mensagemValida(`${ab} e o valor é R$ ___. Pode ser?`, e), false);
});
