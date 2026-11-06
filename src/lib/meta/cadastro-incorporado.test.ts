// Leitura do postMessage do Cadastro Incorporado da Meta. IDs fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerMensagemCadastro } from "./cadastro-incorporado";

const META = "https://www.facebook.com";

test("cadastro: FINISH traz waba_id e phone_number_id", () => {
  const dado = JSON.stringify({
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { phone_number_id: "1111111111", waba_id: "2222222222" },
  });
  assert.deepEqual(lerMensagemCadastro(META, dado), {
    tipo: "concluido",
    wabaId: "2222222222",
    phoneNumberId: "1111111111",
  });
  // Também aceita o objeto já pronto.
  assert.equal(
    lerMensagemCadastro("https://web.facebook.com", JSON.parse(dado))?.tipo,
    "concluido",
  );
});

test("cadastro: cancelado, só a conta e erro", () => {
  assert.deepEqual(
    lerMensagemCadastro(META, {
      type: "WA_EMBEDDED_SIGNUP",
      event: "CANCEL",
      data: { current_step: "PHONE_NUMBER_SETUP" },
    }),
    { tipo: "cancelado", etapa: "PHONE_NUMBER_SETUP" },
  );
  assert.deepEqual(
    lerMensagemCadastro(META, {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_ONLY_WABA",
      data: { waba_id: "2222222222" },
    }),
    { tipo: "so_waba", wabaId: "2222222222" },
  );
  assert.equal(
    lerMensagemCadastro(META, {
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: { error_message: "x" },
    })?.tipo,
    "erro",
  );
  // FINISH sem número vira erro.
  assert.equal(
    lerMensagemCadastro(META, {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "2222222222" },
    })?.tipo,
    "erro",
  );
});

test("cadastro: ignora outras origens e outras mensagens", () => {
  const ok = {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { phone_number_id: "1111111111", waba_id: "2222222222" },
  };
  assert.equal(lerMensagemCadastro("https://facebook.com.golpe.com", ok), null);
  assert.equal(lerMensagemCadastro("https://app.nexaperformanceos.com.br", ok), null);
  assert.equal(lerMensagemCadastro(META, "texto qualquer"), null);
  assert.equal(lerMensagemCadastro(META, { type: "OUTRA" }), null);
  // ID com letras não passa.
  assert.equal(
    lerMensagemCadastro(META, {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { phone_number_id: "abc", waba_id: "2222222222" },
    })?.tipo,
    "erro",
  );
});
