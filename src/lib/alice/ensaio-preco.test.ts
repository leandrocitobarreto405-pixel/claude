import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirEnsaioPreco, type PassoEnsaioPreco } from "./ensaio-preco.server";

const passo = (p: Partial<PassoEnsaioPreco>): PassoEnsaioPreco => ({
  cliente: "",
  travado: false,
  alice: [],
  retidos: [],
  ferramentas: [],
  ...p,
});

test("conferência: abertura sem preço e orçamento depois com dupla face", () => {
  const bom = [
    passo({
      travado: true,
      alice: [
        "Boa tarde, Rodrigo! Aqui é a Alice, da Empresa 💙\nVi seu CEP, é na Vila Mariana, certo?",
      ],
    }),
    passo({
      alice: ["• Colchão queen – dupla face (2 faces + laterais) — R$ 348,00"],
      ferramentas: [
        {
          nome: "criar_orcamento",
          entrada: '{"itens":[{"item":"Colchão queen","dupla_face":true}]}',
        },
      ],
    }),
  ];
  assert.deepEqual(conferirEnsaioPreco(bom), { passou: true, motivo: "ok" });
  const ruim = [
    passo({ alice: ["*Total:* R$ 239,90", "Eu sou a Alice IA"] }),
    passo({ alice: ["Eu sou a Alice IA de novo"] }),
  ];
  const r = conferirEnsaioPreco(ruim);
  assert.equal(r.passou, false);
  assert.match(r.motivo, /preço na primeira resposta/);
  assert.match(r.motivo, /não chegou ao orçamento/);
  assert.match(r.motivo, /repetiu a apresentação/);
});
