import { test } from "node:test";
import assert from "node:assert/strict";
import {
  despesaDeRepasse,
  repasseEstimado,
  repasseDaOs,
  repasseDoRecebido,
  valoresDaLinha,
  valorLiquido,
} from "./terceirizados";

test("repasse proporcional ao recebido do atendimento", () => {
  // Atendimento de 681,50 com repasse de 362,50: pago inteiro, metade e nada.
  assert.equal(repasseDoRecebido(362.5, 681.5, 681.5), 362.5);
  assert.equal(repasseDoRecebido(362.5, 681.5, 340.75), 181.25);
  assert.equal(repasseDoRecebido(362.5, 681.5, 0), 0);
  // Recebido acima do valor não passa do repasse; estorno desconta.
  assert.equal(repasseDoRecebido(100, 300, 400), 100);
  assert.equal(repasseDoRecebido(100, 300, -150), -50);
  // Sem repasse ou sem valor: zero.
  assert.equal(repasseDoRecebido(0, 300, 300), 0);
  assert.equal(repasseDoRecebido(100, 0, 300), 0);
});

test("valor líquido, linha e OS", () => {
  assert.equal(valorLiquido(224.64, 108), 116.64);
  assert.equal(valorLiquido(100, 150), 0);
  assert.equal(valorLiquido(100, null), 100);
  assert.deepEqual(valoresDaLinha(681.5, 362.5), { cobrado: 681.5, repasse: 362.5, liquido: 319 });
  assert.equal(repasseDaOs([{ repasse_parceiro: 10.1 }, { repasse_parceiro: 20.2 }]), 30.3);
  assert.equal(repasseDaOs(null), 0);
  assert.equal(repasseDaOs({ repasse_parceiro: 5 }), 5);
});

test("despesa de repasse reconhecida pela chave", () => {
  assert.equal(despesaDeRepasse({ reference_key: "repasse:abc" }), true);
  assert.equal(despesaDeRepasse({ reference_key: "mileage:abc" }), false);
  assert.equal(despesaDeRepasse({ reference_key: null }), false);
});

test("repasse estimado no orçamento pelo custo da tabela", () => {
  const catalogo = [
    { id: "t", terceirizado: true, custo_parceiro: 30, custo_parceiro_impermeabilizacao: 55 },
    { id: "s", terceirizado: false, custo_parceiro: 99 },
  ];
  assert.equal(
    repasseEstimado(
      [
        { tabela_preco_item_id: "t", tipo_servico: "higienizacao", quantidade: 3.6 },
        { tabela_preco_item_id: "t", tipo_servico: "impermeabilizacao", quantidade: 2 },
        { tabela_preco_item_id: "s", tipo_servico: "higienizacao", quantidade: 1 },
      ],
      catalogo,
    ),
    218,
  );
});
