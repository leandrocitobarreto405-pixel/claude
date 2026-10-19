// criar_orcamento com cupom, de ponta a ponta (banco simulado): o texto que a Alice recebe e o
// orçamento gravado (desconto em reais, cupom, Pix sobre o total com cupom). Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executarFerramenta, type ContextoFerramenta } from "./ferramentas.server";

type Linha = Record<string, unknown>;

function bancoSimulado() {
  const tabelas: Record<string, Linha[]> = {
    tabela_precos_itens: [
      {
        id: "item-sofa3",
        empresa_id: "emp",
        nome: "Sofá comum 3 lugares",
        preco_higienizacao: 260,
        preco_impermeabilizacao: 520,
        categoria: "sofa",
        ativo: true,
        ordem: 1,
      },
    ],
    cupons: [
      {
        empresa_id: "emp",
        codigo: "BLOG50",
        valor: 50,
        servico: "higienizacao",
        canal: "BLOG",
        ativo: true,
      },
      {
        empresa_id: "emp",
        codigo: "SITE50",
        valor: 50,
        servico: "higienizacao",
        canal: "SITE",
        ativo: true,
      },
      {
        empresa_id: "emp",
        codigo: "BLOG82",
        valor: 82,
        servico: "impermeabilizacao",
        canal: "BLOG",
        ativo: true,
      },
      {
        empresa_id: "emp",
        codigo: "SITE82",
        valor: 82,
        servico: "impermeabilizacao",
        canal: "SITE",
        ativo: true,
      },
    ],
    crm_leads: [
      {
        id: "lead-1",
        empresa_id: "emp",
        lead_name: "Cliente Fictício",
        phone: "11900000000",
        customer_id: null,
        sales_origin_id: null,
      },
    ],
    quotes: [],
    quote_items: [],
  };
  let seq = 0;
  class Consulta {
    private filtros: Array<(l: Linha) => boolean> = [];
    private nova: Linha | Linha[] | null = null;
    private mudanca: Linha | null = null;
    private limite = Infinity;
    constructor(private tabela: string) {}
    select() {
      return this;
    }
    eq(c: string, v: unknown) {
      if (c.includes("->>")) return this;
      this.filtros.push((l) => l[c] === undefined || l[c] === v);
      return this;
    }
    neq() {
      return this;
    }
    gte() {
      return this;
    }
    in() {
      return this;
    }
    is() {
      return this;
    }
    order() {
      return this;
    }
    limit(n: number) {
      this.limite = n;
      return this;
    }
    insert(l: Linha | Linha[]) {
      this.nova = l;
      return this;
    }
    update(m: Linha) {
      this.mudanca = m;
      return this;
    }
    upsert(l: Linha) {
      this.nova = l;
      return this;
    }
    delete() {
      this.mudanca = {};
      return this;
    }
    private executar(): Linha[] {
      const t = (tabelas[this.tabela] ??= []);
      if (this.nova) {
        const novas = (Array.isArray(this.nova) ? this.nova : [this.nova]).map((l) => ({
          id: `${this.tabela}-${++seq}`,
          ...l,
        }));
        t.push(...novas);
        return novas;
      }
      const linhas = t.filter((l) => this.filtros.every((f) => f(l)));
      if (this.mudanca) for (const l of linhas) Object.assign(l, this.mudanca);
      return linhas.slice(0, this.limite);
    }
    single() {
      return Promise.resolve({ data: this.executar()[0] ?? null, error: null });
    }
    maybeSingle() {
      return this.single();
    }
    then<A, B>(
      ok?: ((v: { data: Linha[]; error: null }) => A) | null,
      erro?: ((e: unknown) => B) | null,
    ) {
      return Promise.resolve({ data: this.executar(), error: null as null }).then(ok, erro);
    }
  }
  const admin = {
    from: (t: string) => new Consulta(t),
    rpc: async () => ({ data: "emp", error: null }),
  };
  return { admin, tabelas };
}

function contexto() {
  const { admin, tabelas } = bancoSimulado();
  const ctx = {
    admin,
    empresaId: "emp",
    cfg: {
      nome: "Alice",
      parcelas_max: 5,
      desconto_pix_percentual: 5,
      validade_orcamento_dias: 15,
    },
    conversaId: "conv-1",
    leadId: "lead-1",
    contatoId: null,
    agora: new Date("2026-10-19T15:00:00Z"),
    ultimaDoCliente: null,
    etapas: [],
    passagem: null,
    saida: [],
    agendouFollowup: false,
  } as unknown as ContextoFerramenta;
  return { ctx, tabelas };
}

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
