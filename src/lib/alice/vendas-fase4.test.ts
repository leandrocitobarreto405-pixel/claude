import { test } from "node:test";
import assert from "node:assert/strict";
import { CADENCIA, passoDaEtapa, planejarToque, rotuloDoToque } from "./cadencia";
import {
  calcularOferta5,
  chavesFase4,
  comRetomadaManha,
  decisaoForaDaArea,
  deveCobrirRetorno,
  modeloDaOferta5,
  retornoBarraRetomada,
  textoDecisaoForaDaArea,
  textoOferta5,
  textoRetomadaManha,
  textoRetornoDaEquipe,
} from "./vendas-fase4";

const SP = (d: string) => new Date(`${d}-03:00`);
const base = { oferta: false, ultimaDoCliente: null as Date | null, retorno: null as Date | null };

test("chaves da fase 4: todas desligadas por padrão, com os valores combinados", () => {
  assert.deepEqual(chavesFase4({}), {
    retomadaManha: false,
    followup5: false,
    followup5Pct: 20,
    followup5Piso: 200,
    retornoCobre: false,
    retornoCobreMin: 15,
    foraAreaRegra: false,
    foraAreaKm: 50,
    foraAreaPedidoMinimo: 1000,
  });
  assert.equal(
    chavesFase4({ followup5_novo: true, followup5_total_pct: "20.00" }).followup5Pct,
    20,
  );
});

test("retomada da manhã: sem a chave, o toque 3 continua da equipe às 10h", () => {
  const a3 = CADENCIA.A.find((p) => p.etapa === "A3")!;
  assert.equal(comRetomadaManha(a3, false), a3);
  const r = comRetomadaManha(a3, true);
  assert.deepEqual(r.quando, { dia: 1, hora: 8 });
  assert.equal(r.equipe, false);
  assert.equal(r.retomadaManha, true);
  assert.equal(r.modelo, "fu_retomada_manha");
  // Os outros passos não mudam.
  const a4 = passoDaEtapa("A4")!;
  assert.equal(comRetomadaManha(a4, true), a4);
});

test("retomada da manhã no planejamento: D1 às 8h, inclusive quando o cliente falou no dia", () => {
  const ancora = SP("2026-11-12T15:00:00");
  const feitos = [
    { etapa: "A1", em: SP("2026-11-12T15:10:00").toISOString() },
    { etapa: "A2", em: SP("2026-11-12T15:40:00").toISOString() },
  ];
  const ligada = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-11-12T15:41:00"),
    ancoraOrcamento: ancora,
    feitos,
    retomadaManha: true,
  })!;
  assert.equal(ligada.passo.etapa, "A3");
  assert.equal(ligada.passo.retomadaManha, true);
  assert.equal(ligada.quando.toISOString(), SP("2026-11-13T08:00:00").toISOString());
  const desligada = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-11-12T15:41:00"),
    ancoraOrcamento: ancora,
    feitos,
  })!;
  assert.equal(desligada.quando.toISOString(), SP("2026-11-13T10:00:00").toISOString());
  assert.equal(desligada.passo.equipe, true);
  // Cliente falou hoje à noite ("vou ver com meu marido"): a retomada fica para amanhã às 8h.
  const falou = planejarToque({
    ...base,
    trilha: "A",
    agora: SP("2026-11-12T20:30:00"),
    ancoraOrcamento: ancora,
    feitos,
    ultimaDoCliente: SP("2026-11-12T20:20:00"),
    retomadaManha: true,
  })!;
  assert.equal(falou.passo.etapa, "A3");
  assert.equal(falou.quando.toISOString(), SP("2026-11-13T08:00:00").toISOString());
});

test("numeração: com a retomada, o 3 é da Alice; o 4 continua da Maria", () => {
  assert.equal(rotuloDoToque("A3", { atendente: "Maria" }), "Follow-up 3 de 5 · Maria");
  assert.equal(
    rotuloDoToque("A3", { atendente: "Maria", retomadaManha: true }),
    "Follow-up 3 de 5 · Alice",
  );
  assert.equal(
    rotuloDoToque("A4", { atendente: "Maria", retomadaManha: true }),
    "Follow-up 4 de 5 · Maria",
  );
});

test("textos da retomada (aprovados)", () => {
  assert.equal(
    textoRetomadaManha("Carlos", null),
    "Oi, Carlos, bom dia! Conseguiu analisar o orçamento?",
  );
  assert.equal(
    textoRetomadaManha("Ana", "marido"),
    "Oi, Ana, bom dia! Conseguiu ver com o seu marido?",
  );
  assert.equal(
    textoRetomadaManha("Rui", "esposa"),
    "Oi, Rui, bom dia! Conseguiu ver com a sua esposa?",
  );
  assert.equal(textoRetomadaManha(null, null), "Oi, bom dia! Conseguiu analisar o orçamento?");
});

test("follow-up 5: sem desconto, 20%; com cupom, só o que falta; piso de R$ 200", () => {
  const p = { pct: 20, piso: 200, negociou: false };
  assert.deepEqual(calcularOferta5({ ...p, cheio: 600, descontoAtual: 0 }), {
    tipo: "desconto",
    valor: 480,
    vinte: true,
  });
  // Exemplo do dono: R$ 600 com cupom de R$ 50 → R$ 480 (sem a porcentagem no texto).
  assert.deepEqual(calcularOferta5({ ...p, cheio: 600, descontoAtual: 50 }), {
    tipo: "desconto",
    valor: 480,
    vinte: false,
  });
  // Piso: R$ 240 → 20% daria R$ 192; fica R$ 200.
  assert.deepEqual(calcularOferta5({ ...p, cheio: 240, descontoAtual: 0 }), {
    tipo: "desconto",
    valor: 200,
    vinte: false,
  });
  // Já em 20% ou mais: lembra o valor.
  assert.deepEqual(calcularOferta5({ ...p, cheio: 600, descontoAtual: 130 }), {
    tipo: "lembrete",
    valor: 470,
  });
  // Já negociou: lembra o valor, sem desconto novo.
  assert.deepEqual(calcularOferta5({ ...p, cheio: 600, descontoAtual: 0, negociou: true }), {
    tipo: "lembrete",
    valor: 600,
  });
  // Abaixo do piso já: lembra.
  assert.deepEqual(calcularOferta5({ ...p, cheio: 190, descontoAtual: 0 }), {
    tipo: "lembrete",
    valor: 190,
  });
});

test("follow-up 5: os textos aprovados, nas duas versões da agenda", () => {
  const vinte = { tipo: "desconto" as const, valor: 480, vinte: true };
  const menor = { tipo: "desconto" as const, valor: 480, vinte: false };
  assert.equal(
    textoOferta5({ nome: "Carla", oferta: vinte, comVaga: true, pct: 20, prazo: "sábado" }),
    "Carla, abriram alguns horários nesta semana e consigo chegar em 20% de desconto no seu orçamento: fica R$ 480,00. Quer ver os horários disponíveis?",
  );
  assert.equal(
    textoOferta5({ nome: "Carla", oferta: vinte, comVaga: false, pct: 20, prazo: "sábado" }),
    "Carla, as vagas desta semana já esgotaram e estamos fechando a agenda da semana que vem. Como você já fez o orçamento com a gente, consigo 20% de desconto: fica R$ 480,00. Quer aproveitar?",
  );
  assert.equal(
    textoOferta5({ nome: "Carla", oferta: menor, comVaga: false, pct: 20, prazo: "sábado" }),
    "Carla, as vagas desta semana já esgotaram e estamos fechando a agenda da semana que vem. Como você já fez o orçamento com a gente, consigo fazer por R$ 480,00. Quer aproveitar?",
  );
  assert.equal(
    textoOferta5({
      nome: null,
      oferta: { tipo: "lembrete", valor: 470 },
      comVaga: false,
      pct: 20,
      prazo: "sábado",
    }),
    "Seu orçamento de R$ 470,00 vale até sábado. Quer que eu reserve um horário pra você?",
  );
});

test("follow-up 5 fora da janela: modelo só com os 20% cheios e com nome", () => {
  const vinte = { tipo: "desconto" as const, valor: 1234.5, vinte: true };
  assert.deepEqual(modeloDaOferta5({ nome: "Carla", oferta: vinte, comVaga: true }), {
    modelo: "fu_orcamento_20_vaga",
    valores: ["Carla", "1.234,50"],
  });
  assert.equal(
    modeloDaOferta5({ nome: "Carla", oferta: vinte, comVaga: false })?.modelo,
    "fu_orcamento_20_proxima_semana",
  );
  assert.equal(modeloDaOferta5({ nome: null, oferta: vinte, comVaga: true }), null);
  assert.equal(
    modeloDaOferta5({ nome: "Carla", oferta: { ...vinte, vinte: false }, comVaga: true }),
    null,
  );
});

test("retorno da equipe: a Alice só chama depois de 15 min, sem ninguém ter chamado, na janela", () => {
  const agendado = SP("2026-11-13T11:00:00");
  const cliente = SP("2026-11-12T20:00:00");
  const o = {
    agendado,
    minutos: 15,
    ultimaDoCliente: cliente,
    ultimaEnviada: SP("2026-11-12T20:01:00"),
  };
  assert.equal(deveCobrirRetorno({ ...o, agora: SP("2026-11-13T11:10:00") }).cobrir, false);
  assert.equal(deveCobrirRetorno({ ...o, agora: SP("2026-11-13T11:16:00") }).cobrir, true);
  assert.deepEqual(
    deveCobrirRetorno({
      ...o,
      agora: SP("2026-11-13T11:16:00"),
      ultimaEnviada: SP("2026-11-13T11:02:00"),
    }),
    { cobrir: false, motivo: "a equipe já chamou" },
  );
  assert.deepEqual(
    deveCobrirRetorno({
      ...o,
      agora: SP("2026-11-13T11:16:00"),
      ultimaDoCliente: SP("2026-11-13T11:05:00"),
    }),
    { cobrir: false, motivo: "o cliente já escreveu" },
  );
  assert.deepEqual(
    deveCobrirRetorno({
      ...o,
      agora: SP("2026-11-13T11:16:00"),
      ultimaDoCliente: SP("2026-11-12T09:00:00"),
    }),
    { cobrir: false, motivo: "fora da janela de 24 h (fica com a equipe)" },
  );
  assert.equal(deveCobrirRetorno({ ...o, agora: SP("2026-11-13T14:30:00") }).cobrir, false);
  assert.equal(
    textoRetornoDaEquipe("Carlos", "Maria"),
    "Oi, Carlos! A Maria me pediu pra te chamar no horário combinado 💙 Conseguiu ver a proposta?",
  );
});

test("fora da área: transfere só pedido grande e perto; senão, despedida e motivo", () => {
  const r = { km: 50, pedidoMinimo: 1000 };
  assert.equal(decisaoForaDaArea({ ...r, kmIda: 42, valorItens: 1200 }), "transferir");
  assert.equal(decisaoForaDaArea({ ...r, kmIda: 42, valorItens: 1000 }), "encerrar");
  assert.equal(decisaoForaDaArea({ ...r, kmIda: 55, valorItens: 3000 }), "encerrar");
  assert.equal(decisaoForaDaArea({ ...r, kmIda: null, valorItens: 3000 }), "encerrar");
  const t = textoDecisaoForaDaArea("encerrar", 42, 35);
  assert.match(t, /infelizmente a gente ainda não atende a sua região/);
  assert.match(t, /registrar_motivo_perda/);
  assert.doesNotMatch(textoDecisaoForaDaArea("transferir", 42, 35), /R\$/);
});

test("cliente com retorno combinado amanhã às 11h: a retomada das 8h não sai", () => {
  const agora = SP("2026-11-13T08:00:00");
  // Retorno combinado pela Alice (trilha C) para as 11h: barra.
  assert.equal(
    retornoBarraRetomada(
      [{ scheduled_at: SP("2026-11-13T11:00:00").toISOString(), trilha: "C" }],
      agora,
    ),
    true,
  );
  // Retorno marcado pela equipe (sem trilha) para as 11h: barra também.
  assert.equal(
    retornoBarraRetomada(
      [{ scheduled_at: SP("2026-11-13T11:00:00").toISOString(), trilha: null }],
      agora,
    ),
    true,
  );
  // Só os toques da própria sequência (trilha A) pendentes: a retomada sai.
  assert.equal(
    retornoBarraRetomada(
      [{ scheduled_at: SP("2026-11-13T14:00:00").toISOString(), trilha: "A" }],
      agora,
    ),
    false,
  );
  // Retorno velho, de ontem, que ficou pendente: não barra.
  assert.equal(
    retornoBarraRetomada(
      [{ scheduled_at: SP("2026-11-12T11:00:00").toISOString(), trilha: "C" }],
      agora,
    ),
    false,
  );
  assert.equal(retornoBarraRetomada([], agora), false);
});

test("frase do retorno com o nome de quem marcou", () => {
  assert.equal(
    textoRetornoDaEquipe("Carlos", "Carol"),
    "Oi, Carlos! A Carol me pediu pra te chamar no horário combinado 💙 Conseguiu ver a proposta?",
  );
});
