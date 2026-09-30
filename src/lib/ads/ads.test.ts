import { test } from "node:test";
import assert from "node:assert/strict";
import { dadosDoPopup, hostDe, lerCorpo } from "./captacao.server";
import { juntarLinhas, linhasRecentes, PARAMETROS } from "./exportar-google.server";

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
    [PARAMETROS],
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
