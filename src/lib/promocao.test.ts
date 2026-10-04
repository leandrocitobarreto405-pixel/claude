import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertaRodizio,
  diaDaSemana,
  horariosLivres,
  montarDestinatarios,
  pct,
  previaMensagem,
  type HorarioBase,
  avaliarLimites,
  custoProduto,
  distanciaKm,
  margemEstimada,
  tipoDoOrcamento,
  valorComDesconto,
  prepararDestinatario,
  type EntradaPromocao,
} from "./promocao";

const josue = (diaSemana: number, hora: string): HorarioBase => ({
  tecnicoId: "j",
  tecnico: "Josué",
  diaSemana,
  hora,
});
const BASE = [
  josue(1, "10:00"),
  josue(1, "14:00"),
  josue(2, "11:00"),
  josue(2, "14:00"),
  josue(3, "10:00"),
  josue(3, "14:00"),
  josue(4, "09:00"),
  josue(4, "14:00"),
  josue(5, "10:00"),
  josue(5, "14:00"),
];

test("dia da semana", () => {
  assert.equal(diaDaSemana("2026-10-06"), 2); // terça
  assert.equal(diaDaSemana("2026-10-04"), 0); // domingo
});

test("horários livres: só os horários base sem atendimento", () => {
  // Terça: 11h e 14h. Atendimento às 11h ocupa; encaixe às 16h não conta.
  assert.deepEqual(
    horariosLivres(
      BASE,
      [
        { tecnicoId: "j", hora: "11:00:00", status: "Agendado" },
        { tecnicoId: "j", hora: "16:00:00", status: "Agendado" },
      ],
      "2026-10-06",
    ),
    [{ tecnicoId: "j", tecnico: "Josué", hora: "14:00" }],
  );
  // Cancelado não ocupa; atendimento sem técnico ocupa.
  assert.equal(
    horariosLivres(
      BASE,
      [
        { tecnicoId: null, hora: "09:00", status: "Agendado" },
        { tecnicoId: "j", hora: "14:00", status: "Cancelado" },
      ],
      "2026-10-08",
    ).length,
    1,
  );
  // Outro técnico no mesmo horário não ocupa o do Josué.
  assert.equal(
    horariosLivres(BASE, [{ tecnicoId: "outro", hora: "10:00", status: "Agendado" }], "2026-10-05")
      .length,
    2,
  );
  // Domingo: sem horário base.
  assert.deepEqual(horariosLivres(BASE, [], "2026-10-04"), []);
});

test("destinatários: sem repetir, sem agendado, sem interno, sem opt-out", () => {
  const lista = montarDestinatarios(
    [
      {
        telefone: "(11) 97777-0001",
        nome: "Carla Mendes",
        origem: "orcamento",
        desde: "2026-10-01",
      },
      { telefone: "5511977770001", nome: "Carla", origem: "conversa", desde: "2026-10-05" },
      { telefone: "11977770002", nome: "João", origem: "orcamento", desde: "2026-10-02" },
      { telefone: "11977770003", nome: "Leandro", origem: "conversa", desde: "2026-10-05" },
      { telefone: "11977770004", nome: "Saiu", origem: "orcamento", desde: "2026-10-03" },
      { telefone: "11977770005", nome: "  ", origem: "conversa", desde: "2026-10-05" },
      { telefone: "123", nome: "Inválido", origem: "conversa", desde: "2026-10-05" },
    ],
    {
      comAgendamento: ["11977770002"],
      internos: ["1177770003"],
      optout: ["5511977770004"],
    },
  );
  assert.deepEqual(
    lista.map((d) => d.nome),
    ["Carla Mendes"],
  );
  assert.equal(lista[0]!.chave, "1177770001");
});

test("prévia e percentuais", () => {
  assert.equal(pct(20), "20%");
  assert.equal(pct(12.5), "12,5%");
  assert.equal(
    previaMensagem("Carla Mendes", 20, 5, "Turbine Clean"),
    "Oi, Carla! Aqui é da Turbine Clean. Abriu um horário amanhã e consigo fazer o seu serviço com 20% de desconto, e mais 5% se pagar no Pix. Quer que eu reserve para você?",
  );
});

test("alerta do rodízio (terça, Carro do Josué)", () => {
  const veiculos = [{ nome: "Carro do Josué", tecnicoId: "j", diaRodizio: 2 }];
  const cfg = { comecarAPartir: "11:00", tardeInicio: "17:00", duracaoMin: 180, voltaMin: 30 };
  // 11h: termina 14h + 30 = 14h30 → ok.
  assert.equal(
    alertaRodizio({ data: "2026-10-06", hora: "11:00", tecnicoId: "j" }, veiculos, cfg),
    null,
  );
  // 10h: antes das 11h.
  assert.match(
    alertaRodizio({ data: "2026-10-06", hora: "10:00", tecnicoId: "j" }, veiculos, cfg) ?? "",
    /começa antes das 11:00/,
  );
  // 14h: 17h + 30 = 17h30 → passa das 17h.
  assert.equal(
    alertaRodizio({ data: "2026-10-06", hora: "14:00", tecnicoId: "j" }, veiculos, cfg),
    "Dia de rodízio do Carro do Josué (terça): com a volta, termina por volta das 17:30 (rodízio a partir das 17:00).",
  );
  // 13h30: 16h30 + 30 = 17h → no limite, ok.
  assert.equal(
    alertaRodizio({ data: "2026-10-06", hora: "13:30", tecnicoId: "j" }, veiculos, cfg),
    null,
  );
  // Quarta: não é rodízio. Outro técnico: sem veículo.
  assert.equal(
    alertaRodizio({ data: "2026-10-07", hora: "08:00", tecnicoId: "j" }, veiculos, cfg),
    null,
  );
  assert.equal(
    alertaRodizio({ data: "2026-10-06", hora: "08:00", tecnicoId: "x" }, veiculos, cfg),
    null,
  );
});

test("valor com desconto, tipo do orçamento e custo de produto", () => {
  assert.equal(valorComDesconto(400, 20, 5), 300);
  assert.equal(tipoDoOrcamento(["higienizacao", "higienizacao"]), "higienizacao");
  assert.equal(tipoDoOrcamento(["Higienização", "impermeabilizacao"]), "ambos");
  assert.equal(tipoDoOrcamento([null]), null);
  const c = { impostoPct: 6, custoKm: 1.2, produtoHigienizacao: 6, produtoImpermeabilizacao: 80 };
  assert.equal(custoProduto("ambos", c), 86);
});

test("margem: valor − imposto − deslocamento − produto (sem mão de obra)", () => {
  const c = { impostoPct: 6, custoKm: 1.2, produtoHigienizacao: 6, produtoImpermeabilizacao: 80 };
  assert.deepEqual(margemEstimada(300, 20, "higienizacao", c), {
    valor: 252,
    imposto: 18,
    deslocamento: 24,
    produto: 6,
  });
  // Sem custo por km configurado: deslocamento fica de fora (null).
  assert.equal(
    margemEstimada(300, 20, "impermeabilizacao", { ...c, custoKm: null }).deslocamento,
    null,
  );
  assert.equal(margemEstimada(300, 20, "impermeabilizacao", { ...c, custoKm: null }).valor, 202);
});

test("distância e limites (margem mínima e km máximo)", () => {
  const paulista = { lat: -23.5614, lon: -46.6559 };
  const se = { lat: -23.5503, lon: -46.6339 };
  const d = distanciaKm(paulista, se);
  assert.ok(d > 2 && d < 3, `≈2,6 km (${d})`);
  assert.deepEqual(avaliarLimites({ margem: 250, km: 5 }, { margemMin: 200, kmMax: 15 }), {
    marcado: true,
    motivo: null,
  });
  const fora = avaliarLimites({ margem: 150, km: 22.5 }, { margemMin: 200, kmMax: 15 });
  assert.equal(fora.marcado, false);
  assert.match(fora.motivo ?? "", /margem abaixo de R\$\s?200,00 e a 22,5 km \(máximo 15 km\)/);
  // Sem orçamento ou sem endereço: não dá para avaliar, fica marcado.
  assert.equal(
    avaliarLimites({ margem: null, km: null }, { margemMin: 200, kmMax: 15 }).marcado,
    true,
  );
});

test("destinatário da promoção: técnico mais perto, margem no Pix, limites e avisos", () => {
  const custos = {
    impostoPct: 6,
    custoKm: 1,
    produtoHigienizacao: 6,
    produtoImpermeabilizacao: 80,
  };
  const cfg = { descontoPct: 20, pixPct: 5, margemMin: 100, kmMax: 20 };
  const base = { lat: -23.55, lon: -46.63 };
  const pontos = [
    { tecnicoId: "j", tecnico: "Josué", base, servicos: [{ lat: -23.6, lon: -46.63 }] },
  ];
  const e: EntradaPromocao = {
    chave: "11999990000",
    telefone: "5511999990000",
    nome: "Carla Souza",
    familias: ["orcamento"],
    diasOrcamento: 3,
    diasConversa: null,
    valor: 400,
    kmOrcamento: null,
    tipo: "higienizacao",
    coord: { lat: -23.61, lon: -46.63 },
  };
  const d = prepararDestinatario(e, pontos, cfg, custos);
  assert.equal(d.tecnico, "Josué");
  assert.equal(d.valorPromo, 320);
  assert.equal(d.valorPix, 300);
  // perto do serviço do dia (~1,1 km), mais que da base (~6,7 km)
  assert.ok(d.km !== null && d.km < 2 && d.kmBase !== null && d.kmBase > 6);
  // 300 − 18 de imposto − 2×km×1 − 6 de produto
  assert.equal(d.margem?.produto, 6);
  assert.ok(d.margem!.valor > 270 && d.margem!.valor < 276);
  assert.equal(d.marcado, true);
  assert.deepEqual(d.avisos, []);

  // longe demais: desmarcado com o motivo
  const longe = prepararDestinatario(
    { ...e, coord: { lat: -23.95, lon: -46.63 } },
    pontos,
    cfg,
    custos,
  );
  assert.equal(longe.marcado, false);
  assert.match(longe.motivo ?? "", /km/);

  // sem orçamento e sem endereço: marcado, só com avisos
  const sem = prepararDestinatario({ ...e, valor: null, coord: null }, pontos, cfg, custos);
  assert.equal(sem.marcado, true);
  assert.deepEqual(sem.avisos, ["sem orçamento", "sem endereço"]);

  // sem endereço, mas com km do orçamento (ida e volta)
  const peloOrc = prepararDestinatario({ ...e, coord: null, kmOrcamento: 30 }, pontos, cfg, custos);
  assert.equal(peloOrc.km, 15);
  assert.equal(peloOrc.kmDoOrcamento, true);

  // sem nome: não dá para enviar
  const semNome = prepararDestinatario({ ...e, nome: " " }, pontos, cfg, custos);
  assert.equal(semNome.podeEnviar, false);
  assert.equal(semNome.marcado, false);
});
