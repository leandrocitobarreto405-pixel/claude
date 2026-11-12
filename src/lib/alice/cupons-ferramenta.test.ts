// criar_orcamento com cupom, de ponta a ponta (banco simulado): o texto que a Alice recebe e o
// orçamento gravado (desconto em reais, cupom, Pix sobre o total com cupom). Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executarFerramenta } from "./ferramentas.server";
import { contexto } from "./banco-simulado";

const semNbsp = (s: string) => s.replace(/\u00a0/g, " ");

const CASOS = [
  {
    cupom: "BLOG50",
    servico: "higienizacao",
    total: "R$ 210,00",
    pix: "R$ 199,50",
    parcela: "R$ 42,00",
    desconto: 50,
  },
  {
    cupom: "SITE50",
    servico: "higienizacao",
    total: "R$ 210,00",
    pix: "R$ 199,50",
    parcela: "R$ 42,00",
    desconto: 50,
  },
  {
    cupom: "BLOG82",
    servico: "impermeabilizacao",
    total: "R$ 438,00",
    pix: "R$ 416,10",
    parcela: "R$ 87,60",
    desconto: 82,
  },
  {
    cupom: "SITE82",
    servico: "impermeabilizacao",
    total: "R$ 438,00",
    pix: "R$ 416,10",
    parcela: "R$ 87,60",
    desconto: 82,
  },
] as const;

for (const c of CASOS) {
  test(`criar_orcamento com ${c.cupom}: sofá comum 3 lugares (${c.servico})`, async () => {
    const { ctx, tabelas } = contexto();
    const r = await executarFerramenta(ctx, "criar_orcamento", {
      servico: c.servico,
      itens: [{ item: "Sofá comum 3 lugares", quantidade: 1 }],
      endereco: "Rua Fictícia, Bairro Teste",
      cupom: c.cupom.toLowerCase(),
    });
    assert.equal(r.erro, false, r.conteudo);
    const texto = semNbsp(r.conteudo);
    assert.match(texto, new RegExp(`Cupom ${c.cupom}: −R\\$ ${c.desconto},00`));
    assert.match(texto, new RegExp(`Total com desconto: ${c.total.replace("$", "\\$")}`));
    assert.ok(texto.includes(c.pix), `Pix ${c.pix} em:\n${texto}`);
    assert.ok(texto.includes(c.parcela), `parcela ${c.parcela} em:\n${texto}`);
    const q = tabelas["quotes"]![0]!;
    assert.equal(q["cupom"], c.cupom);
    assert.equal(q["desconto_tipo"], "manual");
    assert.equal(Number(q["desconto"]), c.desconto);
  });
}

test("criar_orcamento sem CEP nem endereço: não cria e pede só o CEP", async () => {
  const { ctx, tabelas } = contexto();
  const r = await executarFerramenta(ctx, "criar_orcamento", {
    servico: "higienizacao",
    itens: [{ item: "Sofá comum 3 lugares", quantidade: 1 }],
  });
  assert.equal(r.erro, true);
  assert.match(r.conteudo, /Sem CEP nem endereço o orçamento não sai/);
  assert.equal((tabelas["quotes"] ?? []).length, 0);
});

test("criar_orcamento com cupom do outro serviço: não cria e indica o cupom certo", async () => {
  const { ctx, tabelas } = contexto();
  const r = await executarFerramenta(ctx, "criar_orcamento", {
    servico: "impermeabilizacao",
    itens: [{ item: "Sofá comum 3 lugares", quantidade: 1 }],
    cupom: "BLOG50",
  });
  assert.equal(r.erro, true);
  assert.match(semNbsp(r.conteudo), /BLOG50 vale só para higienização.*BLOG82/);
  assert.equal(tabelas["quotes"]!.length, 0);
});

test("atualizar_lead com a origem informada: só grava em lead sem origem", async () => {
  const { ctx, tabelas } = contexto();
  tabelas["config_options"] = [
    { id: "orig-blog", empresa_id: "emp", kind: "sales_origin", active: true },
  ];
  const r = await executarFerramenta(ctx, "atualizar_lead", { origem: "google_artigo" });
  assert.equal(r.erro, false);
  assert.equal(tabelas["crm_leads"]![0]!["sales_origin_id"], "orig-blog");
  const r2 = await executarFerramenta(ctx, "atualizar_lead", { origem: "instagram" });
  assert.match(r2.conteudo, /já era conhecida/);
  assert.equal(tabelas["crm_leads"]![0]!["sales_origin_id"], "orig-blog");
});
