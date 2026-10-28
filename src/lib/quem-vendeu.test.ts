import { test } from "node:test";
import assert from "node:assert/strict";
import { equipeNegociou, vendedoraPelaRegra } from "./quem-vendeu";

const base = { vendedoraOs: "Maria", transferencias: [], mensagensEquipe: [] };

test("orçamento da Alice sem negociação: vendeu a Alice", () => {
  const r = vendedoraPelaRegra({
    ...base,
    orcamento: { vendedora: "Alice (IA)" },
    mensagensEquipe: ["Oi! Confirmado para sexta 😊", "Endereço certinho?"],
  });
  assert.deepEqual(r, { vendedora: "Alice (IA)", regra: "orcamento" });
});

test("transferência por desconto, combo, pagamento ou item fora da tabela: quem está na OS", () => {
  for (const motivo of ["pediu desconto", "combo", "pagamento combinado", "item fora da tabela"]) {
    const r = vendedoraPelaRegra({
      ...base,
      orcamento: { vendedora: "Alice (IA)" },
      transferencias: [motivo],
    });
    assert.deepEqual(r, { vendedora: "Maria", regra: "negociou" }, motivo);
  }
  // Transferência por outro motivo (ex.: dúvida de endereço) não conta.
  assert.equal(
    equipeNegociou({ transferencias: ["dúvida de endereço"], mensagensEquipe: [] }),
    false,
  );
});

test("mensagem da equipe com preço ou condição: quem está na OS", () => {
  for (const t of [
    "Fica R$ 280,00",
    "No Pix sai com 5%",
    "Posso parcelar em 2x",
    "Dou um desconto",
  ]) {
    assert.equal(
      vendedoraPelaRegra({ ...base, orcamento: { vendedora: "Alice (IA)" }, mensagensEquipe: [t] })
        .vendedora,
      "Maria",
      t,
    );
  }
});

test("OS sem orçamento ligado: quem está na OS", () => {
  assert.deepEqual(vendedoraPelaRegra({ ...base, orcamento: null }), {
    vendedora: "Maria",
    regra: "sem_orcamento",
  });
});

test("orçamento de alguém da equipe sem vendedora cadastrada: quem está na OS", () => {
  assert.equal(vendedoraPelaRegra({ ...base, orcamento: { vendedora: null } }).vendedora, "Maria");
});
