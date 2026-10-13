import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cadastroDeTeste,
  chaveDoCadastro,
  dentroDoHorario,
  lerDataHora,
  linhasNovas,
  primeiroNomeLead,
  telefoneDoLead,
  textoResumoLeads,
  textoSemChamar,
} from "./leads-site";

test("telefone: celular com DDD vale; curto, 10 dígitos com 9 e DDD com 0 não", () => {
  assert.equal(telefoneDoLead("11987650001"), "5511987650001");
  assert.equal(telefoneDoLead("(11) 98765-0001"), "5511987650001");
  assert.equal(telefoneDoLead("5511987650001"), "5511987650001");
  assert.equal(telefoneDoLead("1133334444"), "551133334444", "fixo com DDD vale (dá para ligar)");
  assert.equal(telefoneDoLead("1198765000"), null, "10 dígitos começando com 9: falta um dígito");
  assert.equal(telefoneDoLead("987650001"), null, "sem DDD");
  assert.equal(telefoneDoLead("0187650001"), null, "DDD com 0");
  assert.equal(telefoneDoLead("119876500012"), null, "dígito a mais");
  assert.equal(telefoneDoLead(""), null);
  assert.equal(telefoneDoLead(null), null);
});

test("data e hora da planilha (São Paulo)", () => {
  assert.equal(lerDataHora("13/10/2026, 14:05:33"), "2026-10-13T17:05:33.000Z");
  assert.equal(lerDataHora("3/1/2026 08:07"), "2026-01-03T11:07:00.000Z");
  assert.equal(lerDataHora("31/02/2026, 10:00:00"), null);
  assert.equal(lerDataHora("ontem"), null);
});

test("linhas novas pelo cabeçalho, pulando linhas vazias", () => {
  const cab = [
    "Data e Hora",
    "Nome",
    "WhatsApp",
    "Serviço",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "Link da Página",
  ];
  const agora = new Date("2026-10-13T15:00:00Z");
  const r = linhasNovas(
    cab,
    [
      [
        "13/10/2026, 10:00:00",
        "Pessoa Teste",
        "11987650001",
        "Sofá",
        "google",
        "cpc",
        "c",
        "higienização de sofá",
        "",
        "abc",
      ],
      [],
      ["sem data", "Outra Pessoa", "1198765"],
    ],
    5,
    agora,
  );
  assert.equal(r.erro, null);
  assert.equal(r.ultima, 7);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(
    { ...r.linhas[0], pagina: r.linhas[0]!.pagina },
    {
      linha: 5,
      chave: "13/10/2026 10:00:00|11987650001",
      cadastrado_em: "2026-10-13T13:00:00.000Z",
      nome: "Pessoa Teste",
      telefone_digitado: "11987650001",
      telefone: "5511987650001",
      servico: "Sofá",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "c",
      utm_term: "higienização de sofá",
      utm_content: null,
      gclid: "abc",
      gbraid: null,
      wbraid: null,
      fbclid: null,
      pagina: null,
    },
  );
  assert.equal(r.linhas[1]!.linha, 7);
  assert.equal(r.linhas[1]!.telefone, null, "número inválido");
  assert.equal(r.linhas[1]!.cadastrado_em, agora.toISOString(), "sem data usa a hora da leitura");
});

test("aba sem a coluna WhatsApp: erro claro e nada lido", () => {
  const r = linhasNovas(["Nome", "Email"], [["A", "a@b"]], 2, new Date());
  assert.match(r.erro ?? "", /WhatsApp/);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.ultima, 1);
});

test("horário de envio e textos dos avisos", () => {
  assert.equal(dentroDoHorario(new Date("2026-10-13T11:00:00Z"), "08:00", "20:00"), true);
  assert.equal(dentroDoHorario(new Date("2026-10-13T10:59:00Z"), "08:00", "20:00"), false);
  assert.equal(dentroDoHorario(new Date("2026-10-13T23:00:00Z"), "08:00", "20:00"), false);
  assert.equal(primeiroNomeLead("  maria SILVA "), "Maria");
  assert.equal(primeiroNomeLead("123"), "");
  assert.equal(
    textoSemChamar({ nome: "ana souza", lp: "LP Colchão", cadastrado_em: "2026-10-13T13:00:00Z" }),
    "Ana (LP Colchão) se cadastrou às 10:00 e ainda não chamou no WhatsApp. Ligue ou chame em Leads do site.",
  );
  assert.equal(
    textoResumoLeads("2026-10-12", {
      total: 5,
      chamou: 3,
      naoChamou: 1,
      invalido: 1,
      chamadoEquipe: 0,
    }),
    "5 cadastros nas LPs em 12/10/2026, 3 chamaram no WhatsApp, 1 não chamou, 1 com número inválido. Veja em Leads do site.",
  );
});

test("chave do cadastro: data/hora de São Paulo + telefone; sem data, o texto da célula", () => {
  assert.equal(
    chaveDoCadastro("2026-10-13T17:05:33.000Z", "13/10/2026, 14:05:33", "(11) 98765-0001", "Ana"),
    "13/10/2026 14:05:33|11987650001",
  );
  assert.equal(
    chaveDoCadastro(null, "ontem à tarde", "11987650001", "Ana"),
    "sem-data:ontem à tarde|11987650001",
  );
  assert.equal(
    chaveDoCadastro("2026-10-13T17:05:33.000Z", null, null, "Ana"),
    "13/10/2026 14:05:33|nome:Ana",
  );
});

test("cadastro de teste (nome começando com teste) é ignorado", () => {
  assert.equal(cadastroDeTeste("Teste"), true);
  assert.equal(cadastroDeTeste("  TESTE da LP"), true);
  assert.equal(cadastroDeTeste("Maria Teste"), false);
  const r = linhasNovas(
    ["Data e Hora", "Nome", "WhatsApp"],
    [
      ["13/10/2026, 10:00:00", "teste", "11900000001"],
      ["13/10/2026, 10:01:00", "Pessoa Real", "11900000002"],
    ],
    2,
    new Date(),
  );
  assert.deepEqual(
    r.linhas.map((l) => [l.linha, l.nome]),
    [[3, "Pessoa Real"]],
  );
  assert.equal(r.ultima, 3, "a linha de teste conta como lida");
});

test("mesma chave mesmo depois de apagarem uma linha acima (a linha muda, a chave não)", () => {
  const cab = ["Data e Hora", "Nome", "WhatsApp"];
  const a = ["13/10/2026, 10:00:00", "Pessoa A", "11900000001"];
  const b = ["13/10/2026, 11:00:00", "Pessoa B", "11900000002"];
  const antes = linhasNovas(cab, [a, b], 2, new Date());
  const depois = linhasNovas(cab, [b], 2, new Date());
  assert.equal(antes.linhas[1]!.linha, 3);
  assert.equal(depois.linhas[0]!.linha, 2);
  assert.equal(antes.linhas[1]!.chave, depois.linhas[0]!.chave);
});
