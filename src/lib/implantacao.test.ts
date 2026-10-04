import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avaliarEtapas,
  marcacaoPermitida,
  resumoEtapas,
  textoProgresso,
  validarDadosEmpresa,
  ESTADOS,
  type Fatos,
} from "./implantacao";

const vazia: Fatos = {
  empresa: { nome: "Lava Bem", cnpj: null, telefone: "", cidade: null, estado: null },
  usuarios: { admin: 1, atendente: 0, tecnico: 0, convitesPendentes: 2 },
  precos: 0,
  taxas: 0,
  textosSalvos: false,
  tecnicosAtivos: 0,
  horariosBase: 0,
  whatsapp: { caixasChatwoot: 0 },
  modelos: null,
  alice: null,
  tokenMeta: false,
  veiculos: { total: 0, comRodizio: 0 },
  google: false,
  marketing: { contatos: 0, campanhas: 0 },
  notificacoes: 0,
  marcadas: {},
};

const pronta: Fatos = {
  empresa: {
    nome: "Lava Bem",
    cnpj: "00.000.000/0001-00",
    telefone: "11999990000",
    cidade: "Cuiabá",
    estado: "MT",
  },
  usuarios: { admin: 1, atendente: 1, tecnico: 1, convitesPendentes: 0 },
  precos: 12,
  taxas: 4,
  textosSalvos: true,
  tecnicosAtivos: 2,
  horariosBase: 10,
  whatsapp: { caixasChatwoot: 1 },
  modelos: { faltando: [], naoAprovados: [] },
  alice: {
    nome: true,
    descricao: true,
    instrucoes: true,
    perguntas: true,
    horario: true,
    area: true,
  },
  tokenMeta: true,
  veiculos: { total: 2, comRodizio: 1 },
  google: true,
  marketing: { contatos: 300, campanhas: 1 },
  notificacoes: 2,
  marcadas: { taxas: "revisado" },
};

const etapa = (f: Fatos, chave: string) => avaliarEtapas(f).find((e) => e.chave === chave)!;

test("empresa nova: nada pronto, WhatsApp aguardando conexão", () => {
  const r = resumoEtapas(avaliarEtapas(vazia));
  assert.equal(textoProgresso(r), "0 de 9 obrigatórias · 1 de 6 opcionais");
  assert.equal(r.podeLiberar, false);
  assert.equal(etapa(vazia, "whatsapp").situacao, "aguardando");
  assert.equal(etapa(vazia, "whatsapp").detalhe, "Aguardando conexão.");
  assert.equal(etapa(vazia, "dados").detalhe, "Falta o CNPJ, o telefone, a cidade e o estado.");
  assert.match(
    etapa(vazia, "usuarios").detalhe,
    /Falta 1 atendente e 1 técnico com acesso\. 2 convites/,
  );
  assert.equal(etapa(vazia, "modelos").situacao, "aguardando");
});

test("tudo pronto: pode liberar", () => {
  const r = resumoEtapas(avaliarEtapas(pronta));
  assert.equal(textoProgresso(r), "9 de 9 obrigatórias · 6 de 6 opcionais");
  assert.equal(r.podeLiberar, true);
});

test("taxas só ficam prontas com 'Revisei'; textos pelo salvamento ou 'Revisei'", () => {
  const sem = { ...pronta, marcadas: {} };
  assert.equal(etapa(sem, "taxas").situacao, "falta");
  assert.equal(resumoEtapas(avaliarEtapas(sem)).podeLiberar, false);
  const textos = { ...pronta, textosSalvos: false, marcadas: { taxas: "revisado" as const } };
  assert.equal(etapa(textos, "textos").situacao, "falta");
  assert.equal(
    etapa({ ...textos, marcadas: { ...textos.marcadas, textos: "revisado" } }, "textos").situacao,
    "pronta",
  );
});

test("modelos: lista o que falta e o que não foi aprovado", () => {
  const f = {
    ...pronta,
    modelos: { faltando: ["posvenda_resultado"], naoAprovados: ["promocao_agenda"] },
  };
  assert.equal(
    etapa(f, "modelos").detalhe,
    "1 modelo não existe na Meta (posvenda_resultado) e 1 modelo não aprovado (promocao_agenda).",
  );
});

test("'Não se aplica' só nas opcionais e conta como pronta", () => {
  const f = {
    ...vazia,
    marcadas: { google: "nao_se_aplica" as const, precos: "nao_se_aplica" as const },
  };
  assert.equal(etapa(f, "google").situacao, "nao_se_aplica");
  assert.equal(etapa(f, "precos").situacao, "falta");
  // google marcado + rodízio (não se aplica sozinho)
  assert.equal(resumoEtapas(avaliarEtapas(f)).opcionais.prontas, 2);
  assert.equal(marcacaoPermitida("google", "nao_se_aplica"), true);
  assert.equal(marcacaoPermitida("precos", "nao_se_aplica"), false);
  assert.equal(marcacaoPermitida("taxas", "revisado"), true);
  assert.equal(marcacaoPermitida("whatsapp", "revisado"), false);
  assert.equal(marcacaoPermitida("inventada", "pendente"), false);
});

test("rodízio: só vale com veículo com dia de rodízio", () => {
  assert.equal(etapa(vazia, "veiculos").situacao, "nao_se_aplica");
  assert.equal(
    etapa(vazia, "veiculos").detalhe,
    "Rodízio não se aplica: nenhum veículo com dia de rodízio.",
  );
  const semDia = { ...vazia, veiculos: { total: 2, comRodizio: 0 } };
  assert.equal(etapa(semDia, "veiculos").situacao, "nao_se_aplica");
  assert.match(etapa(semDia, "veiculos").detalhe, /2 veículos sem dia de rodízio/);
  assert.equal(etapa(pronta, "veiculos").detalhe, "2 veículos, 1 com dia de rodízio.");
  assert.equal(marcacaoPermitida("veiculos", "nao_se_aplica"), false);
  // Marcação antiga de "Não se aplica" (de quando a etapa aceitava) é ignorada.
  const antiga = {
    ...pronta,
    marcadas: { ...pronta.marcadas, veiculos: "nao_se_aplica" as const },
  };
  assert.equal(etapa(antiga, "veiculos").situacao, "pronta");
  assert.equal(etapa(antiga, "veiculos").marcada, null);
});

test("dados da empresa: valida CNPJ, telefone, cidade e estado; vazio fica como está", () => {
  assert.deepEqual(validarDadosEmpresa({ cidade: "  Cuiabá ", estado: "mt" }), {
    cidade: "Cuiabá",
    estado: "MT",
  });
  assert.deepEqual(validarDadosEmpresa({}), {});
  assert.throws(() => validarDadosEmpresa({ estado: "XX" }), /estado/);
  assert.throws(() => validarDadosEmpresa({ cnpj: "123" }), /CNPJ/);
  assert.throws(() => validarDadosEmpresa({ telefone: "9999" }), /DDD/);
  assert.equal(ESTADOS.length, 27);
  assert.match(etapa(pronta, "dados").detalhe, /Cuiabá\/MT/);
});

test("responsável de cada etapa", () => {
  const nexa = avaliarEtapas(vazia)
    .filter((e) => e.responsavel === "nexa")
    .map((e) => e.chave);
  assert.deepEqual(nexa, ["whatsapp", "modelos", "alice", "token_meta"]);
});

test("base de clientes: pronta quando há contatos; sem eles, aponta os modelos", () => {
  assert.equal(etapa(vazia, "base").situacao, "falta");
  assert.match(etapa(vazia, "base").detalhe, /modelo de compradores/);
  assert.equal(etapa(vazia, "base").resolver?.para, "/marketing?secao=base");
  assert.equal(etapa(pronta, "base").detalhe, "300 contatos na base.");
  assert.equal(marcacaoPermitida("base", "nao_se_aplica"), true);
});
