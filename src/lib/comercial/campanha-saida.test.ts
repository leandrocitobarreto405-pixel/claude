import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diasDoResultado,
  ehTarefaDeVenda,
  linhaDasSaidas,
  marcaSegurada,
  notasDaSegurada,
  PREFIXO_CAMPANHA,
  resultadoCampanha,
  saiParaCampanha,
  seguradaEm,
  type SinaisDaSaida,
} from "./campanha-saida";

const o = { agora: new Date("2026-11-13T00:30:00Z"), hoje: "2026-11-12" };
const base: SinaisDaSaida = {
  tipo: "mensagem",
  prioridade: 3,
  notas: "Tatiana: retomar o orçamento",
  ultimaDoCliente: "2026-10-30T15:00:00Z",
  orcamentoEm: "2026-10-31T15:00:00Z",
  dataCombinada: false,
  osAberta: false,
  acertoPendente: false,
};
const com = (x: Partial<SinaisDaSaida>) => saiParaCampanha({ ...base, ...x }, o);

test("sai: mais de 7 dias da última mensagem do cliente ou do orçamento, o mais recente", () => {
  assert.deepEqual(com({}), { sai: true, dias: 12 });
  // A tarefa pode ter sido criada ontem: o que conta é o cliente e o orçamento.
  assert.deepEqual(com({ ultimaDoCliente: "2026-11-01T12:00:00Z", orcamentoEm: null }), {
    sai: true,
    dias: 11,
  });
  assert.deepEqual(com({ ultimaDoCliente: null }), { sai: true, dias: 12 });
  // Exatamente 7 dias ainda não é "mais de 7".
  assert.deepEqual(com({ ultimaDoCliente: "2026-11-06T00:30:00Z", orcamentoEm: null }), {
    sai: false,
    motivo: "respondeu",
  });
  assert.deepEqual(com({ ultimaDoCliente: "2026-11-05T23:00:00Z", orcamentoEm: null }), {
    sai: true,
    dias: 7,
  });
  for (const tipo of ["ligar", "follow_up_esquecido", null])
    assert.equal(com({ tipo }).sai, true, String(tipo));
});

test("não sai: respondeu ou recebeu orçamento nos últimos 7 dias", () => {
  assert.deepEqual(com({ ultimaDoCliente: "2026-11-10T12:00:00Z" }), {
    sai: false,
    motivo: "respondeu",
  });
  assert.deepEqual(com({ orcamentoEm: "2026-11-08T12:00:00Z" }), {
    sai: false,
    motivo: "respondeu",
  });
  assert.deepEqual(com({ ultimaDoCliente: null, orcamentoEm: null }), {
    sai: false,
    motivo: "sem_referencia",
  });
});

test("não sai: data combinada, negociação P1, OS em aberto, acerto pendente, outra tarefa", () => {
  assert.deepEqual(com({ dataCombinada: true }), { sai: false, motivo: "data_combinada" });
  assert.deepEqual(com({ prioridade: 1 }), { sai: false, motivo: "negociacao_p1" });
  assert.deepEqual(com({ osAberta: true }), { sai: false, motivo: "os_aberta" });
  assert.deepEqual(com({ acertoPendente: true }), { sai: false, motivo: "acerto_pendente" });
  for (const tipo of ["pos_venda", "remarcar", "lead_site"])
    assert.deepEqual(com({ tipo }), { sai: false, motivo: "nao_e_venda" }, tipo);
  assert.equal(ehTarefaDeVenda("mensagem"), true);
  assert.equal(com({ prioridade: null }).sai, true);
  assert.equal(com({ prioridade: 2 }).sai, true);
});

test("segurar na lista: a equipe segura e a tarefa não sai de novo por 7 dias", () => {
  const notas = notasDaSegurada("Tatiana: retomar o orçamento", "2026-11-12");
  assert.equal(notas, "Tatiana: retomar o orçamento [segurada:2026-11-12]");
  assert.equal(seguradaEm(notas), "2026-11-12");
  assert.equal(seguradaEm("Tatiana: retomar"), null);
  assert.deepEqual(com({ notas }), { sai: false, motivo: "segurada" });
  assert.deepEqual(com({ notas: `x ${marcaSegurada("2026-11-06")}` }), {
    sai: false,
    motivo: "segurada",
  });
  // Passados os 7 dias, volta a valer a regra.
  assert.equal(com({ notas: `x ${marcaSegurada("2026-11-05")}` }).sai, true);
  // Segurar de novo troca a data, sem empilhar marcas nem passar de 500 caracteres.
  const outra = notasDaSegurada(`${"a".repeat(600)} ${marcaSegurada("2026-11-01")}`, "2026-11-12");
  assert.equal(outra.match(/\[segurada:/g)?.length, 1);
  assert.ok(outra.endsWith("[segurada:2026-11-12]"));
  assert.ok(outra.length <= 500);
});

test("resultado gravado e linha do resumo da manhã", () => {
  const r = resultadoCampanha(12);
  assert.ok(r.startsWith(PREFIXO_CAMPANHA));
  assert.equal(diasDoResultado(r), 12);
  assert.equal(diasDoResultado("Pulada"), null);
  assert.equal(linhaDasSaidas(0), null);
  assert.match(linhaDasSaidas(1) ?? "", /^1 lead saiu para a lista de campanha/);
  assert.match(linhaDasSaidas(3) ?? "", /^3 leads saíram para a lista de campanha/);
  assert.match(linhaDasSaidas(3) ?? "", /Segurar na lista\.$/);
  assert.ok(!(linhaDasSaidas(3) ?? "").includes("—"));
});
