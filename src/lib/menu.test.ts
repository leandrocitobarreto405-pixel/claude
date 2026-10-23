import { test } from "node:test";
import assert from "node:assert/strict";
import { ABAS_DE_TELA, abasPermitidas, itemAtivo, menuDoPapel, REDIRECIONAMENTOS } from "./menu";
import { podeAcessar } from "./tenant";

const rotas = (g: ReturnType<typeof menuDoPapel>) =>
  Object.fromEntries(g.map((x) => [x.rotulo, x.itens.map((i) => i.to)]));

test("admin: Dia a dia, Vendas, Financeiro e Empresa (sem Nexa)", () => {
  assert.deepEqual(rotas(menuDoPapel("admin")), {
    "Dia a dia": ["/inicio", "/conversas", "/agenda", "/oss", "/mensagens"],
    Vendas: ["/crm/funil", "/crm/retornos", "/marketing"],
    Financeiro: ["/financeiro", "/notas", "/exportacoes"],
    Empresa: ["/configuracoes"],
  });
});

test("Primeiros passos só enquanto faltar etapa, com o progresso no rótulo", () => {
  const faltando = menuDoPapel("admin", false, { faltam: true, progresso: "3 de 9" });
  const empresa = faltando.find((g) => g.id === "empresa")!;
  assert.deepEqual(
    empresa.itens.map((i) => [i.to, i.rotulo]),
    [
      ["/configuracoes", "Configurações"],
      ["/implantacao", "Primeiros passos · 3 de 9"],
    ],
  );
  const pronto = menuDoPapel("admin", false, { faltam: false, progresso: "9 de 9" });
  assert.deepEqual(
    pronto.find((g) => g.id === "empresa")!.itens.map((i) => i.to),
    ["/configuracoes"],
  );
});

test("atendente: no Financeiro só A receber, sem Empresa; técnico: só Agenda e Serviços", () => {
  assert.deepEqual(rotas(menuDoPapel("atendente")), {
    "Dia a dia": ["/inicio", "/conversas", "/agenda", "/oss", "/mensagens"],
    Vendas: ["/crm/funil", "/crm/retornos", "/marketing"],
    Financeiro: ["/a-receber"],
  });
  assert.deepEqual(rotas(menuDoPapel("tecnico")), { "Dia a dia": ["/agenda", "/servicos"] });
  assert.deepEqual(menuDoPapel(null), []);
});

test("Nexa vê o grupo Nexa; sem empresa, só ele", () => {
  const comEmpresa = menuDoPapel("admin", true);
  assert.deepEqual(
    comEmpresa.at(-1)!.itens.map((i) => i.to),
    ["/nexa/empresas", "/nexa/planos", "/nexa/comissoes", "/nexa/alice", "/nexa/chatwoot"],
  );
  assert.deepEqual(rotas(menuDoPapel(null, true)), {
    Nexa: ["/nexa/empresas", "/nexa/planos", "/nexa/comissoes", "/nexa/alice", "/nexa/chatwoot"],
  });
});

test("todo item do menu abre para quem o vê, e as abas de cada tela também", () => {
  for (const papel of ["admin", "atendente", "tecnico"] as const) {
    for (const g of menuDoPapel(papel))
      for (const i of g.itens) {
        assert.ok(podeAcessar(papel, i.to), `${papel} ${i.to}`);
        for (const extra of i.ativoEm ?? [])
          assert.ok(podeAcessar(papel, extra), `${papel} ${extra}`);
      }
  }
  for (const abas of Object.values(ABAS_DE_TELA))
    for (const a of abas) assert.ok(podeAcessar("admin", a.to), a.to);
});

test("o item fica marcado nas abas da mesma tela", () => {
  const agenda = { to: "/agenda", ativoEm: ["/servicos", "/servico"] };
  assert.equal(itemAtivo(agenda, "/agenda"), true);
  assert.equal(itemAtivo(agenda, "/servicos"), true);
  assert.equal(itemAtivo(agenda, "/servico/abc"), true);
  assert.equal(itemAtivo(agenda, "/oss"), false);
});

test("endereços antigos têm destino", () => {
  assert.deepEqual(REDIRECIONAMENTOS["/avisos"], { to: "/inicio", search: { avisos: "1" } });
  assert.equal(REDIRECIONAMENTOS["/crm/repescagens"]?.to, "/crm/retornos");
  assert.equal(REDIRECIONAMENTOS["/crm/visao-geral"]?.to, "/indicadores");
  assert.equal(REDIRECIONAMENTOS["/usuarios"]?.to, "/configuracoes/equipe");
  for (const r of Object.values(REDIRECIONAMENTOS)) assert.ok(podeAcessar("admin", r.to), r.to);
});

test("abas do Financeiro: admin vê as seis (com Comissões); atendente só A receber", () => {
  assert.deepEqual(
    abasPermitidas(ABAS_DE_TELA.financeiro, "admin").map((a) => a.to),
    ["/financeiro", "/a-receber", "/pagamentos", "/despesas", "/dre", "/comissoes"],
  );
  assert.deepEqual(
    abasPermitidas(ABAS_DE_TELA.financeiro, "atendente").map((a) => a.to),
    ["/a-receber"],
  );
});
