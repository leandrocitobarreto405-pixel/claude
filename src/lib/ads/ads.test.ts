import { test } from "node:test";
import assert from "node:assert/strict";
import { dadosDoPopup, hostDe, lerCorpo } from "./captacao.server";
import {
  CABECALHO,
  CABECALHO_ANTIGO,
  formatoCerto,
  lerLinhas,
  linhaDaConversao,
  valorNumerico,
  valoresComoTexto,
  localidadeCerta,
  linhasParaRegistro,
} from "./exportar-google.server";

test("pop-up: JSON, formulário e nomes alternativos", () => {
  assert.deepEqual(lerCorpo('{"nome":"Ana"}'), { nome: "Ana" });
  assert.deepEqual(lerCorpo("nome=Ana&telefone=11999998888"), {
    nome: "Ana",
    telefone: "11999998888",
  });
  assert.deepEqual(lerCorpo("{quebrado"), {});
  assert.deepEqual(lerCorpo("[1,2]"), {});
  const d = dadosDoPopup({
    name: "Ana",
    whatsapp: 11999998888,
    utm: { utm_source: "google" },
    pageUrl: "https://x.lovable.app/?gclid=ABC_123&utm_campaign=sp&gclid=outro",
  });
  assert.equal(d.nome, "Ana");
  assert.equal(d.telefone, "11999998888");
  assert.equal(d.utm_source, "google");
  assert.equal(d.gclid, "ABC_123");
  assert.equal(d.utm_campaign, "sp");
  // Campo enviado vale mais que o da URL.
  assert.equal(
    dadosDoPopup({ gclid: "DIRETO", page_url: "https://x.app/?gclid=URL" }).gclid,
    "DIRETO",
  );
});

test("pop-up: domínio pelo Origin, Referer ou page_url", () => {
  const req = (h: Record<string, string>) => new Request("http://nexa/api", { headers: h });
  assert.equal(hostDe(req({ origin: "https://Landing.Lovable.app" })), "landing.lovable.app");
  assert.equal(hostDe(req({ referer: "https://b.lovable.app/pagina" })), "b.lovable.app");
  assert.equal(hostDe(req({}), { page_url: "https://c.lovable.app/?x=1" }), "c.lovable.app");
  assert.equal(hostDe(req({}), { page_url: "sem url" }), null);
});

test("planilha: lê o formato antigo e o novo pelos nomes das colunas", () => {
  const antiga = [
    ["Parameters:TimeZone=America/Sao_Paulo"],
    [...CABECALHO_ANTIGO],
    ["G1", "Venda Higienização", "2026-09-20 12:00:00-03:00", 359.9, "BRL"],
    ["", "", "", "", ""],
  ];
  // linha "Parameters" e vazias saem; nome, horário e valor ficam iguais
  assert.deepEqual(lerLinhas([[...CABECALHO_ANTIGO], ...antiga.slice(2)]), [
    { gclid: "G1", nome: "Venda Higienização", horario: "2026-09-20 12:00:00-03:00", valor: 359.9 },
  ]);
  const nova = [
    [...CABECALHO],
    [
      "",
      "",
      "",
      "e".repeat(64),
      "f".repeat(64),
      "Venda Higienização",
      "2026-10-20 10:00:00-03:00",
      300,
      "BRL",
    ],
  ];
  assert.deepEqual(lerLinhas(nova), [
    { gclid: "", nome: "Venda Higienização", horario: "2026-10-20 10:00:00-03:00", valor: 300 },
  ]);
});

test("planilha: linha da conversão nas colunas novas (clique, e-mail e telefone com hash)", () => {
  const linha = linhaDaConversao({
    work_order_id: "os",
    crm_lead_id: null,
    ads_click_id: null,
    gclid: null,
    gbraid: "B1",
    wbraid: null,
    email_sha256: "a".repeat(64),
    telefone_sha256: null,
    conversao_nome: "Venda Impermeabilização",
    conversao_horario: "2026-10-21 09:00:00-03:00",
    valor: 649.9,
    base: "clique",
    order_id: "9001",
  });
  assert.deepEqual(linha, [
    "",
    "B1",
    "",
    "a".repeat(64),
    "",
    "Venda Impermeabilização",
    "2026-10-21 09:00:00-03:00",
    649.9,
    "BRL",
    "9001",
  ]);
  assert.equal(linha.length, CABECALHO.length);
  assert.equal(CABECALHO.at(-1), "Order ID");
});

test("planilha: formato da importação (cabeçalho na linha 1)", () => {
  assert.equal(formatoCerto([[...CABECALHO]]), true);
  assert.equal(formatoCerto([[...CABECALHO, ""], ["G1"]]), true);
  assert.equal(formatoCerto([]), false);
  assert.equal(formatoCerto([["Parameters:TimeZone=America/Sao_Paulo"], [...CABECALHO]]), false);
  assert.equal(formatoCerto([[...CABECALHO, "x"]]), false);
  assert.equal(formatoCerto([["Google Click ID", "Conversion Name"]]), false);
  assert.equal(formatoCerto([[...CABECALHO_ANTIGO]]), false, "formato antigo é regravado");
});

test("planilha: Conversion Value como número (texto com vírgula é detectado e corrigido)", () => {
  const texto = [
    [...CABECALHO_ANTIGO],
    ["G1", "Venda Higienização", "2026-10-13 10:00:00-03:00", "295,8", "BRL"],
    ["G2", "Venda Higienização", "2026-10-13 11:00:00-03:00", 308, "BRL"],
  ];
  assert.equal(valoresComoTexto(texto), 1, "só a célula de texto conta");
  assert.equal(
    valoresComoTexto([[...CABECALHO], ["", "", "", "", "h", "V", "x", "249,9", "BRL"]]),
    1,
    "no formato novo, a coluna do valor é achada pelo nome (linha sem gclid também conta)",
  );
  // Lida de novo, a linha antiga vira número (295.8), não "295,8".
  assert.deepEqual(
    lerLinhas(texto).map((l) => l.valor),
    [295.8, 308],
  );
  assert.equal(valorNumerico("295.8"), 295.8);
  assert.equal(valorNumerico(" 1.249,90 "), 1249.9);
  assert.equal(valorNumerico("abc"), 0);
});

test("domínio não liberado: registra uma vez por domínio a cada hora", async () => {
  const { deveRegistrarDesconhecido } = await import("./captacao.server");
  const memoria = new Map<string, number>();
  const t0 = Date.parse("2026-10-13T10:00:00Z");
  assert.equal(deveRegistrarDesconhecido("site-novo.lovable.app", t0, memoria), true);
  assert.equal(
    deveRegistrarDesconhecido("site-novo.lovable.app", t0 + 30 * 60_000, memoria),
    false,
  );
  assert.equal(deveRegistrarDesconhecido("outro.com", t0 + 30 * 60_000, memoria), true);
  assert.equal(deveRegistrarDesconhecido("site-novo.lovable.app", t0 + 61 * 60_000, memoria), true);
});

test("exportação recusada: identifica OIDC, Bearer errado ou sem autorização", async () => {
  const { tipoDeAutorizacao } = await import("./exportar-google.server");
  assert.equal(tipoDeAutorizacao(null), "nenhuma");
  assert.equal(
    tipoDeAutorizacao("Bearer eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJ4In0.assinatura-abc"),
    "oidc",
  );
  assert.equal(tipoDeAutorizacao("Bearer segredo-errado"), "bearer");
  assert.equal(tipoDeAutorizacao("Basic abc"), "outra");
});

test("planilha precisa estar em en_US para o valor sair com ponto", () => {
  assert.equal(localidadeCerta("en_US"), true);
  assert.equal(localidadeCerta("en-US"), true);
  assert.equal(localidadeCerta("pt_BR"), false);
  assert.equal(localidadeCerta(undefined), false);
});

test("linhas para registro: gclid abreviado, cabeçalho inteiro", () => {
  const linhas = linhasParaRegistro([
    [
      "Google Click ID",
      "Conversion Name",
      "Conversion Time",
      "Conversion Value",
      "Conversion Currency",
    ],
    ["CjwKCAjw_pzWBhAkEiwAwDCi1X", "Venda", "2026-10-09 11:47:30-03:00", "295.8", "BRL"],
  ]);
  assert.deepEqual(linhas[0]![0], "Google Click ID");
  assert.deepEqual(linhas[1], [
    "CjwKCAjw_pzW…",
    "Venda",
    "2026-10-09 11:47:30-03:00",
    "295.8",
    "BRL",
  ]);
});

test("estorno: venda cancelada vira retratação com o mesmo gclid, nome e horário", async () => {
  const { linhaDoEstorno, motivoInvalida, horarioSP, CABECALHO_AJUSTES } =
    await import("./exportar-google.server");
  assert.equal(
    motivoInvalida({ status: "Cancelada", deleted_at: null, eh_teste: false }),
    "OS cancelada",
  );
  assert.equal(
    motivoInvalida({ status: "Agendada", deleted_at: "2026-10-27", eh_teste: false }),
    "OS apagada",
  );
  assert.equal(
    motivoInvalida({ status: "Agendada", deleted_at: null, eh_teste: true }),
    "OS de teste",
  );
  assert.equal(motivoInvalida({ status: "Concluída", deleted_at: null, eh_teste: false }), null);
  assert.equal(horarioSP(new Date("2026-10-27T16:25:13Z")), "2026-10-27 13:25:13-03:00");
  assert.deepEqual(
    linhaDoEstorno({
      gclid: "gclid-ficticio",
      order_id: "9001",
      conversao_nome: "Venda Higienização",
      conversao_horario: "2026-10-20 10:00:00-03:00",
      estorno_horario: "2026-10-27 13:25:13-03:00",
    }),
    [
      "gclid-ficticio",
      "Venda Higienização",
      "2026-10-20 10:00:00-03:00",
      "2026-10-27 13:25:13-03:00",
      "RETRACT",
      "",
      "",
      "",
    ],
  );
  // Sem gclid: pelo Order ID (número da OS), sem o horário da conversão.
  assert.deepEqual(
    linhaDoEstorno({
      gclid: null,
      order_id: "9001",
      conversao_nome: "Venda Higienização",
      conversao_horario: "2026-10-20 10:00:00-03:00",
      estorno_horario: "2026-10-27 13:25:13-03:00",
    }),
    ["", "Venda Higienização", "", "2026-10-27 13:25:13-03:00", "RETRACT", "", "", "9001"],
  );
  assert.equal(CABECALHO_AJUSTES.at(-1), "Order ID");
});
