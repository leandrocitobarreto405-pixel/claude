// criar_orcamento com combo (higienização + impermeabilização), de ponta a ponta no banco simulado:
// o texto que a Alice recebe e o orçamento gravado. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executarFerramenta, ferramentasDisponiveis } from "./ferramentas.server";
import { contexto } from "./banco-simulado";

const semNbsp = (s: string) => s.replace(/\u00a0/g, " ");
const pedido = {
  servico: "higienizacao",
  itens: [{ item: "Sofá comum 3 lugares", quantidade: 1 }],
  endereco: "Rua Fictícia, Bairro Teste",
  combo: true,
};

test("combo desligado: a Alice não orça e transfere", async () => {
  const { ctx, tabelas } = contexto();
  const r = await executarFerramenta(ctx, "criar_orcamento", pedido);
  assert.equal(r.erro, true);
  assert.match(r.conteudo, /Combo não liberado/);
  assert.equal(tabelas["quotes"]!.length, 0);
  // Sem a chave, a ferramenta nem mostra o campo.
  const def = (cfg: Record<string, unknown>) =>
    JSON.stringify(
      ferramentasDisponiveis(cfg as never, []).find((f) => f.name === "criar_orcamento"),
    );
  assert.equal(def({}).includes('"combo"'), false);
  assert.equal(def({ combo_ligado: true }).includes('"combo"'), true);
});

test("combo ligado: os dois serviços no mesmo orçamento, 10% de desconto e Pix por cima", async () => {
  const { ctx, tabelas } = contexto({ combo_ligado: true, combo_pct: 10 });
  const r = await executarFerramenta(ctx, "criar_orcamento", pedido);
  assert.equal(r.erro, false, r.conteudo);
  const texto = semNbsp(r.conteudo);
  // 260 + 520 = 780; 10% = 78; total 702; Pix 5% = 666,90; 5x de 140,40.
  assert.match(texto, /Serviço: Higienização \+ Impermeabilização \(combo/);
  assert.match(
    texto,
    /• Sofá comum 3 lugares: higienização R\$ 260,00 \+ impermeabilização R\$ 520,00/,
  );
  assert.match(texto, /Valor cheio: R\$ 780,00/);
  assert.match(texto, /Combo higienização \+ impermeabilização \(10%\): -R\$ 78,00/);
  assert.match(texto, /Total com desconto: R\$ 702,00/);
  assert.ok(texto.includes("R$ 666,90"), texto);
  assert.ok(texto.includes("R$ 140,40"), texto);

  const q = tabelas["quotes"]![0]!;
  assert.equal(q["desconto"], 78);
  assert.equal(q["desconto_tipo"], "manual");
  assert.equal(q["total"], 702);
  assert.match(
    semNbsp(String(q["observacoes"])),
    /Combo higienização \+ impermeabilização: 10% \(R\$ 78,00\)/,
  );
  const itens = tabelas["quote_items"]!;
  assert.deepEqual(
    itens.map((i) => [i["tipo_servico"], i["preco_aplicado"]]),
    [
      ["higienizacao", 260],
      ["impermeabilizacao", 520],
    ],
  );
  // Medição.
  const ev = tabelas["alice_eventos"]!;
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!["tipo"], "combo_orcado");
  assert.deepEqual(ev[0]!["dados"], { pct: 10, valor_cheio: 780, total: 702 });
});

test("combo com cupom (regra de 13/11): os dois juntos, sem Pix no cartão; 3% a mais se pedir", async () => {
  // 780 cheio; combo 10% = 78; cupom R$ 50; total 652; Pix (só se pedir) 3% = 632,44.
  const { ctx, tabelas } = contexto({ combo_ligado: true, combo_pct: 10 });
  const r = await executarFerramenta(ctx, "criar_orcamento", { ...pedido, cupom: "BLOG50" });
  assert.equal(r.erro, false, r.conteudo);
  const texto = semNbsp(r.conteudo);
  assert.match(texto, /Valor cheio: R\$ 780,00/);
  assert.match(texto, /Combo higienização \+ impermeabilização \(10%\): -R\$ 78,00/);
  assert.match(texto, /Cupom BLOG50: -R\$ 50,00/);
  assert.match(texto, /Total com desconto: R\$ 652,00/);
  // O cartão vai sem a linha do Pix; o valor do Pix fica só para a Alice, se o cliente perguntar.
  assert.equal(texto.includes("No Pix"), false);
  assert.match(texto, /no Pix tem um desconto a mais: fica R\$ 632,44/);
  const q = tabelas["quotes"]![0]!;
  assert.equal(q["desconto"], 128);
  assert.equal(q["total"], 652);
  assert.equal(q["cupom"], "BLOG50");
  assert.equal(q["valor_a_vista"], 632.44);
});

test("combo sem cupom: continua 10% e o Pix de 5% no cartão", async () => {
  const { ctx } = contexto({ combo_ligado: true, combo_pct: 10 });
  const r = await executarFerramenta(ctx, "criar_orcamento", pedido);
  const texto = semNbsp(r.conteudo);
  assert.match(texto, /No Pix \(5% de desconto\): R\$ 666,90/);
  assert.equal(texto.includes("desconto a mais"), false);
});

test("combo: item sem impermeabilização (ou colchão) não entra", async () => {
  const { ctx, tabelas } = contexto({ combo_ligado: true });
  tabelas["tabela_precos_itens"]!.push({
    id: "item-colchao",
    empresa_id: "emp",
    nome: "Colchão casal",
    preco_higienizacao: 200,
    preco_impermeabilizacao: 300,
    categoria: "colchao",
    ativo: true,
    ordem: 2,
  });
  const r = await executarFerramenta(ctx, "criar_orcamento", {
    ...pedido,
    itens: [{ item: "Colchão casal", quantidade: 1 }],
  });
  assert.equal(r.erro, true);
  assert.match(r.conteudo, /"Colchão casal" não entra no combo/);
  assert.equal(tabelas["quotes"]!.length, 0);
});
