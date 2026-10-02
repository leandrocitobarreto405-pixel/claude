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
