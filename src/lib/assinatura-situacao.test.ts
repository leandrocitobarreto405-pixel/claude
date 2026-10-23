import { test } from "node:test";
import assert from "node:assert/strict";
import { textoAvisoAssinatura } from "./assinatura-situacao";

test("aviso da assinatura: dias até o somente leitura, somente leitura e nada quando em dia", () => {
  assert.equal(textoAvisoAssinatura({ situacao: "ok" }), null);
  assert.equal(textoAvisoAssinatura(undefined), null);
  assert.match(
    textoAvisoAssinatura({ situacao: "aviso", dias_para_somente_leitura: 5 }) ?? "",
    /em 5 dias o app fica só para consulta/,
  );
  assert.match(
    textoAvisoAssinatura({ situacao: "aviso", dias_para_somente_leitura: 1 }) ?? "",
    /a partir de amanhã/,
  );
  assert.match(textoAvisoAssinatura({ situacao: "somente_leitura" }) ?? "", /só para consulta/);
  // Bloqueada tem tela própria, não faixa.
  assert.equal(textoAvisoAssinatura({ situacao: "bloqueada" }), null);
});
