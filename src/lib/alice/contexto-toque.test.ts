import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOTIVO_DO_CONTEXTO,
  ehConcorrencia,
  historicoParaClassificar,
  lerClassificacao,
} from "./contexto-toque";

test("lê a classificação da IA; resposta estranha vira 'segue'", () => {
  assert.deepEqual(
    lerClassificacao('{"classe":"fechou_outra","trecho":"optei por outra empresa"}'),
    {
      classe: "fechou_outra",
      trecho: "optei por outra empresa",
    },
  );
  assert.equal(lerClassificacao('Claro: {"classe": "ja_fez", "trecho": ""}').classe, "ja_fez");
  assert.equal(lerClassificacao('{"classe":"talvez"}').classe, "segue");
  assert.equal(lerClassificacao("não sei").classe, "segue");
});

test("motivo sugerido e concorrência", () => {
  assert.equal(MOTIVO_DO_CONTEXTO.mais_barato, "Preço alto – fechou com outra empresa");
  assert.equal(MOTIVO_DO_CONTEXTO.ja_fez, "Fechou com outra empresa (motivo não informado)");
  assert.equal(MOTIVO_DO_CONTEXTO.nao_quer, "Não precisa mais");
  assert.equal(ehConcorrencia("fechou_outra"), true);
  assert.equal(ehConcorrencia("mais_barato"), true);
  assert.equal(ehConcorrencia("ja_fez"), false);
});

test("histórico para a IA: só texto, mais antigas primeiro, quem falou", () => {
  const h = historicoParaClassificar([
    { direcao: "Enviada", texto: "Segue o orçamento", quando: "2026-10-20T10:00:00Z" },
    { direcao: "Recebida", texto: null, quando: "2026-10-20T10:01:00Z" },
    { direcao: "Recebida", texto: "Optarei por outra   empresa", quando: "2026-10-22T13:49:00Z" },
  ]);
  assert.equal(
    h,
    "2026-10-20 empresa: Segue o orçamento\n2026-10-22 cliente: Optarei por outra empresa",
  );
});
