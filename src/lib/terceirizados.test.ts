import { test } from "node:test";
import assert from "node:assert/strict";
import {
  custoDaLinha,
  custoImperIgnorado,
  despesaDeRepasse,
  itemDaLinha,
  linhaDeImpermeabilizacao,
  linhasSemCusto,
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
    {
      id: "tp",
      categoria: "tapete",
      terceirizado: true,
      custo_parceiro: 46.8,
      custo_parceiro_impermeabilizacao: 20,
    },
  ];
  assert.equal(
    repasseEstimado(
      [
        { tabela_preco_item_id: "t", tipo_servico: "higienizacao", quantidade: 3.6 },
        { tabela_preco_item_id: "t", tipo_servico: "impermeabilizacao", quantidade: 2 },
        { tabela_preco_item_id: "s", tipo_servico: "higienizacao", quantidade: 1 },
        // Impermeabilização de tapete: feita pela empresa, sem repasse.
        { tabela_preco_item_id: "tp", tipo_servico: "impermeabilizacao", quantidade: 5 },
      ],
      catalogo,
    ),
    218,
  );
});

const CATALOGO = [
  {
    id: "c",
    nome: "Tapete comum – limpeza (por m²)",
    categoria: "tapete",
    terceirizado: true,
    custo_parceiro: 46.8,
    custo_parceiro_impermeabilizacao: 20,
  },
  { id: "p", nome: "Persiana rolo (até 2 m)", categoria: "persiana", terceirizado: true },
  { id: "s", nome: "Sofá 3 lugares", categoria: "sofa", terceirizado: false },
];

test("item da tabela pela descrição da linha", () => {
  assert.equal(itemDaLinha("Tapete comum – limpeza (por m²) — Limpeza", CATALOGO)?.id, "c");
  assert.equal(itemDaLinha("Persiana rolo (até 2 m)", CATALOGO)?.id, "p");
  assert.equal(itemDaLinha("Persiana rolo (até 2 m) extra", CATALOGO), null);
});

test("limpeza ou impermeabilização pela descrição; sem sufixo, pelo atendimento", () => {
  assert.equal(linhaDeImpermeabilizacao("X — Limpeza", "Impermeabilização"), false);
  assert.equal(linhaDeImpermeabilizacao("X — Impermeabilização", "Higienização"), true);
  assert.equal(linhaDeImpermeabilizacao("X", "Impermeabilização"), true);
  assert.equal(linhaDeImpermeabilizacao("X", null), false);
});

test("custo da linha: tapete impermeabilizado sem repasse; sem custo avisa", () => {
  const limpeza = "Tapete comum – limpeza (por m²) — Limpeza";
  const imper = "Tapete comum – limpeza (por m²) — Impermeabilização";
  assert.equal(custoDaLinha(limpeza, CATALOGO, "Impermeabilização"), 46.8);
  assert.equal(custoDaLinha(imper, CATALOGO), undefined);
  assert.equal(custoDaLinha("Persiana rolo (até 2 m) — Limpeza", CATALOGO), null);
  assert.equal(custoDaLinha("Sofá 3 lugares — Higienização", CATALOGO), undefined);
  assert.deepEqual(
    linhasSemCusto(
      [
        { descricao: limpeza },
        { descricao: "Persiana rolo (até 2 m) — Limpeza" },
        { descricao: "Persiana rolo (até 2 m) — Limpeza" },
      ],
      CATALOGO,
    ),
    ["Persiana rolo (até 2 m) — Limpeza"],
  );
  assert.equal(custoImperIgnorado(CATALOGO[0]!), true);
  assert.equal(
    custoImperIgnorado({ ...CATALOGO[0]!, custo_parceiro_impermeabilizacao: null }),
    false,
  );
});
