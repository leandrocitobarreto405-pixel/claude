import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasPagamento as bruto } from "./texto-pagamento";

// O brl usa espaço não separável depois do "R$".
const linhasPagamento = (v: Parameters<typeof bruto>[0]) => bruto(v).replace(/\u00a0/g, " ");

test("total no cartão com parcelas e, se houver desconto, a linha do Pix", () => {
  assert.equal(
    linhasPagamento({ total: 339, parcelas: 5, pix: 322.05, pixPct: 5 }),
    "*Total:* R$ 339,00 em até 5x de R$ 67,80 sem juros no cartão\n*No Pix (5% de desconto): R$ 322,05*",
  );
  // Parcelas e percentual vêm da empresa.
  assert.equal(
    linhasPagamento({ total: 400, parcelas: 10, pix: 360, pixPct: 10 }),
    "*Total:* R$ 400,00 em até 10x de R$ 40,00 sem juros no cartão\n*No Pix (10% de desconto): R$ 360,00*",
  );
  assert.equal(
    linhasPagamento({ total: 200, parcelas: 3, pix: 185, pixPct: 7.5 }),
    "*Total:* R$ 200,00 em até 3x de R$ 66,67 sem juros no cartão\n*No Pix (7,5% de desconto): R$ 185,00*",
  );
});

test("sem desconto no Pix (ou Pix igual ao total): só a linha do cartão", () => {
  const so = "*Total:* R$ 339,00 em até 5x de R$ 67,80 sem juros no cartão";
  assert.equal(linhasPagamento({ total: 339, parcelas: 5, pix: null, pixPct: 0 }), so);
  assert.equal(linhasPagamento({ total: 339, parcelas: 5, pix: 322.05, pixPct: 0 }), so);
  assert.equal(linhasPagamento({ total: 339, parcelas: 5, pix: 339, pixPct: 5 }), so);
});

test("uma parcela só e Pix editado à mão (o percentual acompanha o valor)", () => {
  assert.equal(
    linhasPagamento({ total: 339, parcelas: 1, pix: null, pixPct: 0 }),
    "*Total:* R$ 339,00 no cartão",
  );
  assert.equal(
    linhasPagamento({ total: 300, parcelas: 5, pix: 270, pixPct: 5 }),
    "*Total:* R$ 300,00 em até 5x de R$ 60,00 sem juros no cartão\n*No Pix (10% de desconto): R$ 270,00*",
  );
});
