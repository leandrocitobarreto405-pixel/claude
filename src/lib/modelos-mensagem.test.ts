import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORM_VAZIO,
  componentesDoFormulario,
  formularioDoModelo,
  motivoDaRecusa,
  ondeEUsado,
  preencherTexto,
  previaDoFormulario,
  regraDeEdicao,
  sugestaoDeModelo,
  textoOuPadrao,
  validarFormulario,
  validarTexto,
  defDoTexto,
} from "./modelos-mensagem";

const promo = sugestaoDeModelo("tc_promocao_agenda")!;

test("formulário válido vira os blocos da Meta, com exemplos", () => {
  assert.deepEqual(validarFormulario(promo), []);
  const c = componentesDoFormulario({ ...promo, rodape: "Turbine Clean" });
  assert.equal(c[0]!.type, "BODY");
  assert.deepEqual(c[0]!.example, { body_text: [["Carla", "20%", "5%"]] });
  assert.deepEqual(c[1], { type: "FOOTER", text: "Turbine Clean" });
  assert.deepEqual(c[2], {
    type: "BUTTONS",
    buttons: [
      { type: "QUICK_REPLY", text: "Quero reservar" },
      { type: "QUICK_REPLY", text: "Não quero mais ofertas" },
    ],
  });
  assert.equal(previaDoFormulario(promo).startsWith("Oi, Carla! Aqui é da Turbine Clean."), true);
});

test("validação: nome, variáveis em sequência, exemplos, começo/fim, botões", () => {
  const p = validarFormulario({
    ...FORM_VAZIO,
    nome: "Promo Agenda",
    corpo: "{{1}}, desconto de {{3}}",
    exemplos: ["Ana"],
    botoes: [{ tipo: "QUICK_REPLY", texto: "Um texto de botão comprido demais" }],
  });
  const tem = (r: RegExp) => p.some((x) => r.test(x));
  assert.ok(tem(/^Nome:/));
  assert.ok(tem(/Falta a variável \{\{2\}\}/));
  assert.ok(tem(/exemplo para \{\{2\}\}/));
  assert.ok(tem(/começando com variável/));
  assert.ok(tem(/terminando com variável/));
  assert.ok(tem(/mais de 25 caracteres/));
  assert.ok(
    validarFormulario({ ...FORM_VAZIO, nome: "x", corpo: "Oi {{nome}}, tudo bem?" }).some((x) =>
      /numeradas/.test(x),
    ),
  );
  assert.ok(
    validarFormulario({
      ...FORM_VAZIO,
      nome: "x",
      corpo: "A {{1}}{{2}} b",
      exemplos: ["1", "2"],
    }).some((x) => /entre duas variáveis/.test(x)),
  );
});

test("modelo da Meta volta para o formulário; formatos sem suporte avisam", () => {
  const f = formularioDoModelo({
    name: "tc_posvenda_resultado",
    language: "pt_BR",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      { type: "BODY", text: "Oi, {{1}}! Como ficou?", example: { body_text: [["Dora"]] } },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://x.com" }] },
    ],
  });
  assert.equal(f.categoria, "UTILITY");
  assert.deepEqual(f.exemplos, ["Dora"]);
  assert.deepEqual(f.botoes, [{ tipo: "URL", texto: "Ver", url: "https://x.com" }]);
  assert.equal(f.naoEditavel, null);
  const img = formularioDoModelo({
    name: "x",
    language: "pt_BR",
    status: "APPROVED",
    components: [
      { type: "HEADER", format: "IMAGE" },
      { type: "BODY", text: "Oi" },
    ],
  });
  assert.match(img.naoEditavel ?? "", /imagem/);
});

test("limite de edições: aprovado 1 por dia e 10 em 30 dias; recusado à vontade; em análise não", () => {
  const agora = new Date("2026-10-10T12:00:00Z");
  const h = (horas: number) => new Date(agora.getTime() - horas * 3600_000).toISOString();
  assert.equal(regraDeEdicao("APPROVED", [], agora).pode, true);
  const ontem = regraDeEdicao("APPROVED", [h(23)], agora);
  assert.equal(ontem.pode, false);
  assert.equal(ontem.liberaEm, new Date(agora.getTime() + 3600_000).toISOString());
  assert.equal(regraDeEdicao("APPROVED", [h(25)], agora).pode, true);
  const dez = Array.from({ length: 10 }, (_, i) => h(30 + i * 48));
  const cheio = regraDeEdicao("APPROVED", dez, agora);
  assert.equal(cheio.pode, false);
  assert.match(cheio.motivo, /10 edições/);
  assert.match(cheio.resumo, /10 de 10/);
  assert.equal(regraDeEdicao("APPROVED", dez.slice(1), agora).pode, true);
  assert.equal(regraDeEdicao("REJECTED", dez, agora).pode, true);
  assert.equal(regraDeEdicao("PAUSED", [h(1)], agora).pode, true);
  assert.equal(regraDeEdicao("PENDING", [], agora).pode, false);
});

test("motivo da recusa e onde é usado", () => {
  assert.match(motivoDaRecusa("INCORRECT_CATEGORY"), /categoria errada/);
  assert.equal(motivoDaRecusa("NONE"), "");
  assert.equal(motivoDaRecusa(null), "");
  const ctx = { modeloAviso: "nexa_aviso", modeloPromocao: "tc_promocao_agenda" };
  assert.equal(ondeEUsado("nexa_aviso", ctx), "Avisos da equipe no WhatsApp");
  assert.match(ondeEUsado("tc_posvenda_resultado_sn", ctx) ?? "", /sem o nome/);
  assert.match(ondeEUsado("tc_sazonal_nov", ctx) ?? "", /sazonal \(nov\)/);
  assert.equal(ondeEUsado("outro", ctx), null);
});

test("textos sem aprovação: variáveis, validação e padrão", () => {
  const def = defDoTexto("aviso_espera")!;
  assert.deepEqual(validarTexto(def, "{cliente} espera há {minutos} min."), []);
  assert.match(validarTexto(def, "{nome} espera")[0] ?? "", /\{nome\} não existe/);
  assert.ok(validarTexto(def, "{{cliente}}").some((x) => /chave só/.test(x)));
  assert.equal(
    preencherTexto(def.padrao!, { cliente: "Carla", minutos: "12", motivo: "" }),
    "Carla espera resposta da equipe há 12 min. Abra Conversas no Nexa.",
  );
  assert.equal(textoOuPadrao("aviso_espera", { aviso_espera: "x" }), "x");
  assert.equal(textoOuPadrao("livre_posvenda", {}), null);
});
