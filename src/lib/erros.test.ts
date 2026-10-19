// Erro técnico vira texto em português (detalhe só no log); mensagem do app aparece como está.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ehErroTecnico, mensagemDeErro, TENTE_DE_NOVO } from "./erros";

const PADRAO = "Não deu para carregar os números agora.";

test("erros técnicos do banco e da rede não chegam crus à tela", () => {
  const tecnicos = [
    "Could not embed because more than one relationship was found for 'work_orders' and 'visits'",
    "permission denied for table work_orders",
    'new row violates row-level security policy for table "quotes"',
    'duplicate key value violates unique constraint "quotes_pkey"',
    "JWT expired",
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
    'invalid input syntax for type uuid: "x"',
    "Cannot read properties of undefined (reading 'id')",
    "Não foi possível salvar: permission denied for table visits",
    "",
  ];
  for (const m of tecnicos) assert.equal(ehErroTecnico(m), true, m);
  const saida = mensagemDeErro(new Error(tecnicos[0]), PADRAO, "teste");
  assert.equal(saida, `${PADRAO} ${TENTE_DE_NOVO}`);
  assert.doesNotMatch(saida, /relationship|embed/);
});

test("mensagens em português escritas pelo app aparecem como estão", () => {
  const nossas = [
    "Esta empresa usa o PDF direto no app: o documento não é gerado no Google Drive.",
    "Informe o nome da empresa.",
    "A origem escolhida não é uma origem de venda.",
    "Selecione uma empresa para continuar.",
  ];
  for (const m of nossas) assert.equal(mensagemDeErro(new Error(m), PADRAO), m);
});

test("erro do PostgREST (objeto, não Error) também é tratado", () => {
  const pg = { message: "Could not find the function public.x", code: "PGRST202", details: null };
  assert.equal(mensagemDeErro(pg, PADRAO), `${PADRAO} ${TENTE_DE_NOVO}`);
  assert.equal(mensagemDeErro("texto solto", PADRAO), `${PADRAO} ${TENTE_DE_NOVO}`);
});

test("número de OS ou CEP numa mensagem nossa não vira erro técnico", () => {
  assert.equal(ehErroTecnico("A OS 12345 já existe nesta empresa."), false);
  assert.equal(ehErroTecnico("CEP 01310 fora da área de atendimento."), false);
});
