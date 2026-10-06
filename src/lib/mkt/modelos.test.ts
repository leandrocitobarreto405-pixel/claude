import { test } from "node:test";
import assert from "node:assert/strict";
import {
  juntarComMeta,
  precisaConferirNaMeta,
  preencher,
  situacaoModelo,
  templateParams,
  textoCondicao,
  variaveis,
  type ModeloMeta,
} from "./modelos";

const corpo = (text: string, extra: ModeloMeta["components"] = []): ModeloMeta["components"] => [
  { type: "BODY", text },
  ...extra,
];
const oferta: ModeloMeta = {
  name: "tc_oferta_trimestral",
  language: "pt_BR",
  status: "APPROVED",
  category: "MARKETING",
  components: corpo("Oi, {{1}}! Nesta semana: {{2}}.\nQuer ver as datas?", [
    { type: "FOOTER", text: "Turbine Clean" },
    {
      type: "BUTTONS",
      buttons: [{ text: "Quero ver as datas" }, { text: "Não quero mais ofertas" }],
    },
  ]),
};
const ofertaSn: ModeloMeta = {
  ...oferta,
  name: "tc_oferta_trimestral_sn",
  components: corpo("Oi! Nesta semana: {{1}}."),
};

test("variáveis na ordem, sem repetir", () => {
  assert.deepEqual(variaveis("{{1}} e {{ 2 }} e {{1}} e {{nome}}"), ["1", "2", "nome"]);
});

test("modelo aprovado, em outro idioma, pendente ou inexistente", () => {
  assert.equal(situacaoModelo([oferta], "tc_oferta_trimestral", "pt_BR").ok, true);
  const r1 = situacaoModelo([oferta], "tc_oferta_trimestral", "en_US");
  assert.equal(r1.ok, false);
  assert.match(!r1.ok ? r1.erro : "", /só em pt_BR/);
  const r2 = situacaoModelo([{ ...oferta, status: "PENDING" }], "tc_oferta_trimestral", "pt_BR");
  assert.match(!r2.ok ? r2.erro : "", /não está aprovado/);
  const r3 = situacaoModelo([], "tc_x", "pt_BR");
  assert.match(!r3.ok ? r3.erro : "", /não existe/);
});

test("preenche nome e condição; variante _sn só a condição", () => {
  const r = preencher(oferta, { primeiroNome: "Ana", condicao: "10% na higienização" });
  assert.ok(r.ok);
  assert.deepEqual(r.parametros, { "1": "Ana", "2": "10% na higienização" });
  assert.equal(
    r.texto,
    "Oi, Ana! Nesta semana: 10% na higienização.\nQuer ver as datas?\n\nTurbine Clean",
  );
  assert.deepEqual(r.botoes, ["Quero ver as datas", "Não quero mais ofertas"]);
  const sn = preencher(ofertaSn, { primeiroNome: null, condicao: "10% na higienização" });
  assert.ok(sn.ok);
  assert.deepEqual(sn.parametros, { "1": "10% na higienização" });
  assert.deepEqual(templateParams(oferta, { "1": "Ana" }), {
    name: "tc_oferta_trimestral",
    category: "MARKETING",
    language: "pt_BR",
    processed_params: { body: { "1": "Ana" } },
  });
});

test("não preenche o que não tem", () => {
  const semCond = preencher(oferta, { primeiroNome: "Ana", condicao: null });
  assert.match(!semCond.ok ? semCond.erro : "", /sem condição/);
  const semNome = preencher(oferta, { primeiroNome: null, condicao: "x" });
  assert.match(!semNome.ok ? semNome.erro : "", /nome confiável/);
  const demais = preencher(
    { ...oferta, components: corpo("{{1}} {{2}} {{3}}") },
    { primeiroNome: "Ana", condicao: "x" },
  );
  assert.match(!demais.ok ? demais.erro : "", /\{\{3\}\}/);
  const midia = preencher(
    { ...oferta, components: [{ type: "HEADER", format: "IMAGE" }, ...corpo("Oi")!] },
    { primeiroNome: "Ana", condicao: null },
  );
  assert.match(!midia.ok ? midia.erro : "", /IMAGE no cabeçalho/);
  const nomeado = preencher(
    { ...oferta, components: corpo("Oi {{nome}}, {{condicao}}") },
    { primeiroNome: "Bia", condicao: "frete grátis" },
  );
  assert.ok(nomeado.ok);
  assert.equal(nomeado.texto, "Oi Bia, frete grátis");
  const semVariavel = preencher(
    { ...oferta, components: corpo("Oi! Tudo bem?") },
    {
      primeiroNome: null,
      condicao: null,
    },
  );
  assert.ok(semVariavel.ok);
  assert.deepEqual(templateParams(oferta, {}).processed_params, {});
});

test("texto da condição", () => {
  assert.equal(textoCondicao(" 10% na impermeabilização ", 10), "10% na impermeabilização");
  assert.equal(textoCondicao(null, 7.5), "7,5% de desconto");
  assert.equal(textoCondicao("", 0), null);
});

test("promoção: {{3}} vem dos extras (desconto do Pix); sem extras, não preenche", () => {
  const promo: ModeloMeta = {
    name: "tc_promocao_agenda",
    language: "pt_BR",
    status: "APPROVED",
    category: "MARKETING",
    components: corpo("Oi, {{1}}! Desconto de {{2}}, e mais {{3}} no Pix."),
  };
  const r = preencher(promo, { primeiroNome: "Ana", condicao: "20%", extras: ["5%"] });
  assert.ok(r.ok);
  assert.deepEqual(r.parametros, { "1": "Ana", "2": "20%", "3": "5%" });
  assert.equal(r.texto, "Oi, Ana! Desconto de 20%, e mais 5% no Pix.");
  const sem = preencher(promo, { primeiroNome: "Ana", condicao: "20%" });
  assert.equal(sem.ok, false);
});

test("situação dos modelos: Chatwoot atrasado, vale a Meta", () => {
  const cw: ModeloMeta[] = [
    { name: "tc_reativacao_cliente", language: "pt_BR", status: "APPROVED" },
    { name: "tc_reativacao_cliente_sn", language: "pt_BR", status: "PENDING" },
  ];
  assert.equal(precisaConferirNaMeta(cw, ["tc_reativacao_cliente"], "pt_BR"), false);
  assert.equal(
    precisaConferirNaMeta(cw, ["tc_reativacao_cliente", "tc_reativacao_cliente_sn"], "pt_BR"),
    true,
  );
  const meta: ModeloMeta[] = [
    { name: "tc_reativacao_cliente", language: "pt_BR", status: "APPROVED" },
    { name: "tc_reativacao_cliente_sn", language: "pt_BR", status: "APPROVED" },
    { name: "tc_novo", language: "pt_BR", status: "APPROVED" },
    { name: "tc_apagado", language: "pt_BR", status: "DELETED" },
  ];
  const r = juntarComMeta(cw, meta);
  assert.ok(situacaoModelo(r.modelos, "tc_reativacao_cliente_sn", "pt_BR").ok);
  assert.ok(situacaoModelo(r.modelos, "tc_novo", "pt_BR").ok);
  assert.deepEqual(r.divergentes, [
    { nome: "tc_reativacao_cliente_sn", idioma: "pt_BR", chatwoot: "PENDING", meta: "APPROVED" },
    { nome: "tc_novo", idioma: "pt_BR", chatwoot: null, meta: "APPROVED" },
  ]);
  assert.equal(r.modelos.length, 3);
});
