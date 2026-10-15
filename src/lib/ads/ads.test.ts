import { test } from "node:test";
import assert from "node:assert/strict";
import { dadosDoPopup, hostDe, lerCorpo } from "./captacao.server";
import {
  CABECALHO,
  formatoCerto,
  juntarLinhas,
  linhasRecentes,
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

test("planilha: mantém só conversões recentes e não repete", () => {
  const agora = new Date("2026-10-01T12:00:00-03:00");
  const valores = [
    ["Parameters:TimeZone=America/Sao_Paulo"],
    [
      "Google Click ID",
      "Conversion Name",
      "Conversion Time",
      "Conversion Value",
      "Conversion Currency",
    ],
    ["G1", "Venda Higienização", "2026-09-20 12:00:00-03:00", 359.9, "BRL"],
    ["G0", "Venda Higienização", "2026-05-01 12:00:00-03:00", 100, "BRL"],
    ["", "", "", "", ""],
  ];
  const antigas = linhasRecentes(valores, agora);
  assert.deepEqual(antigas, [
    ["G1", "Venda Higienização", "2026-09-20 12:00:00-03:00", 359.9, "BRL"],
  ]);
  const juntas = juntarLinhas(antigas, [
    ["G1", "Venda Higienização", "2026-09-20 12:00:00-03:00", 359.9, "BRL"],
    ["G2", "Venda Impermeabilização", "2026-09-30 12:00:00-03:00", 649.9, "BRL"],
  ]);
  assert.deepEqual(
    juntas.map((l) => l[0]),
    ["G1", "G2"],
  );
});

test("planilha: formato da importação (cabeçalho na linha 1)", () => {
  assert.equal(formatoCerto([[...CABECALHO]]), true);
  assert.equal(formatoCerto([[...CABECALHO, ""], ["G1"]]), true);
  assert.equal(formatoCerto([]), false);
  assert.equal(formatoCerto([["Parameters:TimeZone=America/Sao_Paulo"], [...CABECALHO]]), false);
  assert.equal(formatoCerto([[...CABECALHO, "x"]]), false);
  assert.equal(formatoCerto([["Google Click ID", "Conversion Name"]]), false);
});

test("planilha: Conversion Value como número (texto com vírgula é detectado e corrigido)", () => {
  const agora = new Date("2026-10-14T05:00:00-03:00");
  const texto = [
    [...CABECALHO],
    ["G1", "Venda Higienização", "2026-10-13 10:00:00-03:00", "295,8", "BRL"],
    ["G2", "Venda Higienização", "2026-10-13 11:00:00-03:00", 308, "BRL"],
  ];
  assert.equal(valoresComoTexto(texto), 1, "só a célula de texto conta");
  assert.equal(valoresComoTexto([[...CABECALHO], ["G2", "V", "x", 249.9, "BRL"]]), 0);
  // Regravada, a linha antiga sai como número (295.8), não como "295,8".
  assert.deepEqual(
    linhasRecentes(texto, agora).map((l) => l[3]),
    [295.8, 308],
  );
  assert.equal(valorNumerico("295.8"), 295.8);
  assert.equal(valorNumerico(" 1.249,90 "), 1249.9);
  assert.equal(valorNumerico("abc"), 0);
  // O que vai para a planilha (valueInputOption=RAW) é número no JSON, nunca texto.
  const corpo = JSON.stringify({ values: linhasRecentes(texto, agora) });
  assert.match(corpo, /,295\.8,"BRL"/);
  assert.doesNotMatch(corpo, /"295,8"/);
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
