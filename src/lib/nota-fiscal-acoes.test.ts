// "Não emitir", "Voltar para pendente" e "Pedir nota", com um banco falso em memória. Dados fictícios.
import { mock, test } from "node:test";
import assert from "node:assert/strict";

type Linha = Record<string, unknown>;
const notas: Linha[] = [];
const historico: Array<{ eventType: string; description: string; userId?: string | null }> = [];

class Consulta {
  private filtros: Array<[string, unknown]> = [];
  private acao: { tipo: "select" } | { tipo: "update"; valores: Linha } = { tipo: "select" };
  constructor(private tabela: string) {}
  select() {
    return this;
  }
  update(valores: Linha) {
    this.acao = { tipo: "update", valores };
    return this;
  }
  insert(linha: Linha) {
    notas.push({ id: `n${notas.length + 1}`, ...linha });
    return Promise.resolve({ error: null });
  }
  eq(campo: string, valor: unknown) {
    this.filtros.push([campo, valor]);
    return this;
  }
  limit() {
    return this;
  }
  private linhas() {
    const base =
      this.tabela === "invoice_tasks" ? notas : [{ id: "u1", full_name: "Ana Fictícia" }];
    return base.filter((l) => this.filtros.every(([c, v]) => l[c] === v));
  }
  maybeSingle() {
    return Promise.resolve({ data: this.linhas()[0] ?? null, error: null });
  }
  then<A>(ok: (v: { error: null }) => A) {
    if (this.acao.tipo === "update")
      for (const l of this.linhas()) Object.assign(l, this.acao.valores);
    return Promise.resolve({ error: null as null }).then(ok);
  }
}

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: (t: string) => new Consulta(t),
      auth: { getUser: async () => ({ data: { user: { id: "u1", email: "ana@exemplo.com" } } }) },
    },
  },
});
mock.module("@/lib/os", {
  namedExports: {
    logOsHistory: async (h: { eventType: string; description: string; userId?: string | null }) => {
      historico.push(h);
    },
  },
});

const nf = await import("./nota-fiscal");

function tarefa(status: string, extra: Partial<Linha> = {}) {
  const linha: Linha = {
    id: `t${notas.length + 1}`,
    empresa_id: "e1",
    status,
    invoice_amount: 100,
    invoice_number: null,
    issue_date: null,
    service_date: "2026-03-10",
    document_number: null,
    solicitada_em: null,
    arquivo_path: null,
    arquivo_nome: null,
    notes: null,
    work_order: { id: "w1", os_number: "0001", total_gross_value: 100 },
    ...extra,
  };
  notas.push(linha);
  return linha as unknown as Parameters<typeof nf.marcarNaoEmitir>[0];
}

test("situações a emitir: só Pendente e Solicitada", () => {
  assert.ok(nf.aEmitir("Pendente"));
  assert.ok(nf.aEmitir("Solicitada"));
  for (const s of ["Não emitir", "Emitida", "Cancelada", "Não necessária"])
    assert.ok(!nf.aEmitir(s));
});

test("motivo: obrigatório e curto", () => {
  assert.throws(() => nf.validarMotivo("  "), /motivo/);
  assert.throws(() => nf.validarMotivo("x".repeat(201)), /longo/);
  assert.equal(nf.validarMotivo("  cliente   desistiu "), "cliente desistiu");
});

test("registro: motivo, quem e quando (horário de Brasília)", () => {
  assert.equal(
    nf.registroNaoEmitir("cliente desistiu", "Ana Fictícia", new Date("2026-03-10T17:30:00Z")),
    "cliente desistiu — marcado por Ana Fictícia em 10/03/2026 14:30",
  );
});

test("Não emitir: muda a situação, guarda o registro e o histórico; não apaga", async () => {
  const t = tarefa("Solicitada");
  await nf.marcarNaoEmitir(t, "cliente desistiu da nota");
  const linha = notas.find((n) => n["id"] === t.id)!;
  assert.equal(linha["status"], "Não emitir");
  assert.match(String(linha["notes"]), /^cliente desistiu da nota — marcado por Ana Fictícia em /);
  assert.equal(historico.at(-1)!.eventType, "Nota fiscal: não emitir");
  assert.match(historico.at(-1)!.description, /antes: Solicitada/);
  assert.equal(historico.at(-1)!.userId, "u1");
  assert.ok(notas.includes(linha), "a nota continua no banco");
});

test("Não emitir: recusado para nota emitida e sem motivo", async () => {
  await assert.rejects(nf.marcarNaoEmitir(tarefa("Emitida"), "qualquer"), /pendente ou solicitada/);
  await assert.rejects(nf.marcarNaoEmitir(tarefa("Pendente"), ""), /motivo/);
});

test("Voltar para pendente: situação Pendente e o registro anterior vai para o histórico", async () => {
  const t = tarefa("Não emitir", {
    notes: "duplicada — marcado por Ana Fictícia em 10/03/2026 14:30",
  });
  await nf.voltarParaPendente(t);
  const linha = notas.find((n) => n["id"] === t.id)!;
  assert.equal(linha["status"], "Pendente");
  assert.equal(historico.at(-1)!.eventType, "Nota fiscal: voltou para pendente");
  assert.match(historico.at(-1)!.description, /duplicada — marcado por Ana Fictícia/);
});

test("Pedir nota: data da conclusão; sem conclusão, a primeira agendada (cancelada não conta)", () => {
  assert.equal(
    nf.dataServicoDaOs([
      { status: "Concluído", completion_date: "2026-03-12", scheduled_date: "2026-03-11" },
      { status: "Agendado", completion_date: null, scheduled_date: "2026-03-20" },
    ]),
    "2026-03-12",
  );
  assert.equal(
    nf.dataServicoDaOs([
      { status: "Cancelado", completion_date: null, scheduled_date: "2026-03-01" },
      { status: "Agendado", completion_date: null, scheduled_date: "2026-03-20" },
      { status: "Confirmado", completion_date: null, scheduled_date: "2026-03-15" },
    ]),
    "2026-03-15",
  );
});

test("Pedir nota: cria Pendente (mesmo sem CPF/CNPJ) e não duplica", async () => {
  const pedido = nf.novoPedidoDeNota({
    workOrderId: "w-nova",
    customerId: "c1",
    documento: null,
    valor: 250,
    dataServico: "2026-03-15",
    hoje: "2026-03-01",
  });
  assert.equal(pedido.status, "Pendente");
  assert.equal(pedido.document_number, null);
  await nf.pedirNota(pedido);
  assert.equal(notas.filter((n) => n["work_order_id"] === "w-nova").length, 1);
  await assert.rejects(nf.pedirNota(pedido), /já tem nota/);
  assert.equal(notas.filter((n) => n["work_order_id"] === "w-nova").length, 1);
});
