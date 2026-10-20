// Comissões: mês do recebimento, base cheia (terceirizado), 5º dia útil e "Marcar como paga" sem
// duplicar. Dados fictícios.
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { comissoesDoMes, despesaDeComissao, quintoDiaUtil, referenciaComissao } from "./comissoes";
import { alocarRecebimentos, type OsRecebido, type PagamentoRecebido } from "./recebido";

const VENDEDORA = {
  id: "v1",
  name: "Vendedora Fictícia",
  atendente_nexa: true,
  eh_ia: false,
  commission_percentage: 3,
};

function os(extra: Partial<OsRecebido> = {}): OsRecebido {
  return {
    id: "w1",
    os_number: "0001",
    sale_date: "2026-09-28",
    customer_id: "c1",
    total_gross_value: 1000,
    commission_percentage_snapshot: 3,
    origem: "Google",
    vendedora: VENDEDORA,
    visitas: [{ id: "a", status: "Concluído", repasse_parceiro: 0, servico: "Higienização" }],
    ...extra,
  };
}
const pag = (id: string, data: string, valor: number, w = "w1"): PagamentoRecebido => ({
  id,
  work_order_id: w,
  visit_id: null,
  payment_date: data,
  gross_amount: valor,
});
/** Pagamentos do mês (o banco filtra pela data do pagamento; aqui, a mesma regra). */
const doMes = (lista: PagamentoRecebido[], mes: string) =>
  lista.filter((p) => (p.payment_date ?? "").startsWith(mes));

test("5º dia útil do mês seguinte (seg a sex)", () => {
  assert.equal(quintoDiaUtil("2026-10"), "2026-11-06"); // nov/2026 começa num domingo
  assert.equal(quintoDiaUtil("2026-07"), "2026-08-07"); // ago/2026 começa num sábado
  assert.equal(quintoDiaUtil("2026-12"), "2027-01-07"); // virada do ano
});

test("venda num mês, recebimento no outro: a comissão é do mês do recebimento", () => {
  const pagamentos = [pag("p1", "2026-10-10", 1000)];
  const oss = new Map([["w1", os()]]);
  const set = comissoesDoMes(alocarRecebimentos(doMes(pagamentos, "2026-09"), oss));
  const out = comissoesDoMes(alocarRecebimentos(doMes(pagamentos, "2026-10"), oss));
  assert.equal(set.length, 0);
  assert.equal(out[0]!.comissao, 30);
  assert.equal(out[0]!.linhas[0]!.dataRecebimento, "2026-10-10");
});

test("recebimento parcial em dois meses: cada mês com a sua parte", () => {
  const pagamentos = [pag("p1", "2026-10-20", 400), pag("p2", "2026-11-05", 600)];
  const oss = new Map([["w1", os()]]);
  assert.equal(
    comissoesDoMes(alocarRecebimentos(doMes(pagamentos, "2026-10"), oss))[0]!.comissao,
    12,
  );
  assert.equal(
    comissoesDoMes(alocarRecebimentos(doMes(pagamentos, "2026-11"), oss))[0]!.comissao,
    18,
  );
});

test("item terceirizado: comissão sobre o valor cheio; receita sem o repasse", () => {
  const oss = new Map([
    [
      "w1",
      os({
        visitas: [{ id: "a", status: "Concluído", repasse_parceiro: 400, servico: "Limpeza" }],
      }),
    ],
  ]);
  const aloc = alocarRecebimentos([pag("p1", "2026-10-10", 1000)], oss);
  assert.equal(aloc[0]!.receivedGross, 1000);
  assert.equal(aloc[0]!.repasse, 400);
  assert.equal(aloc[0]!.received, 600);
  assert.equal(comissoesDoMes(aloc)[0]!.comissao, 30);
});

test("percentual da OS; sem ele, o da vendedora; quem recebe vem do cadastro", () => {
  const semSnap = os({
    commission_percentage_snapshot: null,
    vendedora: { ...VENDEDORA, commission_percentage: 5, atendente_nexa: false },
  });
  const c = comissoesDoMes(
    alocarRecebimentos([pag("p1", "2026-10-10", 1000)], new Map([["w1", semSnap]])),
  )[0]!;
  assert.equal(c.comissao, 50);
  assert.equal(c.viaNexa, false);
});

test("despesa de comissão fica fora do DRE e tem chave única por vendedora e mês", () => {
  assert.equal(referenciaComissao("v1", "2026-10"), "comissao:v1:2026-10");
  assert.ok(despesaDeComissao({ reference_key: "comissao:v1:2026-10" }));
  assert.ok(!despesaDeComissao({ reference_key: "repasse:x" }));
});

// ---------------------------------------------------------------- "Marcar como paga"
const despesas: Array<Record<string, unknown>> = [];
class Consulta {
  private filtros: Array<[string, unknown]> = [];
  private upd: Record<string, unknown> | null = null;
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtros.push([c, v]);
    return this;
  }
  private linhas() {
    return despesas.filter((d) => this.filtros.every(([c, v]) => d[c] === v));
  }
  maybeSingle() {
    return Promise.resolve({ data: this.linhas()[0] ?? null, error: null });
  }
  insert(l: Record<string, unknown>) {
    if (despesas.some((d) => d["reference_key"] === l["reference_key"]))
      return Promise.resolve({ error: { code: "23505" } });
    despesas.push({ id: `d${despesas.length + 1}`, deleted_at: null, ...l });
    return Promise.resolve({ error: null });
  }
  update(v: Record<string, unknown>) {
    this.upd = v;
    return this;
  }
  then<A>(ok: (r: { error: null }) => A) {
    if (this.upd) for (const d of this.linhas()) Object.assign(d, this.upd);
    return Promise.resolve({ error: null as null }).then(ok);
  }
}
mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: { from: () => new Consulta() } },
});

test("marcar como paga: lança uma vez; repetir não duplica", async () => {
  const { marcarComissaoPaga } = await import("./comissoes-acoes");
  const c = comissoesDoMes(
    alocarRecebimentos([pag("p1", "2026-10-10", 1000)], new Map([["w1", os()]])),
  )[0]!;
  assert.equal(await marcarComissaoPaga(c, "2026-10", "2026-11-06"), "lancada");
  assert.equal(await marcarComissaoPaga(c, "2026-10", "2026-11-06"), "ja_paga");
  assert.equal(despesas.length, 1);
  assert.equal(despesas[0]!["status"], "Pago");
  assert.equal(despesas[0]!["paid_amount"], 30);
  assert.equal(despesas[0]!["due_date"], "2026-11-06");
  assert.equal(despesas[0]!["beneficiary"], "Nexa");
});

test("marcar como paga a despesa já lançada como pendente: atualiza, não cria outra", async () => {
  const { marcarComissaoPaga } = await import("./comissoes-acoes");
  despesas.push({
    id: "dx",
    reference_key: "comissao:v2:2026-10",
    status: "Pendente",
    paid_amount: 0,
    deleted_at: null,
  });
  const c = comissoesDoMes(
    alocarRecebimentos(
      [pag("p9", "2026-10-11", 500, "w2")],
      new Map([["w2", os({ id: "w2", vendedora: { ...VENDEDORA, id: "v2" } })]]),
    ),
  )[0]!;
  assert.equal(await marcarComissaoPaga(c, "2026-10", "2026-11-06"), "atualizada");
  assert.equal(despesas.filter((d) => d["reference_key"] === "comissao:v2:2026-10").length, 1);
  assert.equal(despesas.find((d) => d["id"] === "dx")!["status"], "Pago");
});
