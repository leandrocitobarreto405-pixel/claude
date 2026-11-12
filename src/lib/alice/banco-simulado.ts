/**
 * Banco simulado para testar as ferramentas da Alice de ponta a ponta (sem rede e sem banco):
 * tabela de preços, cupons e um lead fictícios. Só para testes.
 */
import type { ContextoFerramenta } from "./ferramentas.server";

type Linha = Record<string, unknown>;

export function bancoSimulado() {
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

export function contexto(cfgExtra: Record<string, unknown> = {}) {
  const { admin, tabelas } = bancoSimulado();
  const ctx = {
    admin,
    empresaId: "emp",
    cfg: {
      nome: "Alice",
      parcelas_max: 5,
      desconto_pix_percentual: 5,
      validade_orcamento_dias: 15,
      ...cfgExtra,
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
