// Painel Nexa no servidor: toda função do painel exige nexa_admin. Roda cada função com um banco
// falso: admin de empresa (sou_admin_nexa = false) recebe erro antes de qualquer leitura ou
// gravação; nexa_admin passa da conferência. O TanStack é simulado (middlewares em ordem).
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Mw = { deps: Mw[]; server: (o: { next: Next; context: Ctx; data?: unknown }) => unknown };
type Ctx = Record<string, unknown>;
type Next = (o?: { context?: Ctx }) => unknown;

function criarMiddleware() {
  const m: Mw = { deps: [], server: ({ next }) => next() };
  const b = {
    middleware(deps: Mw[]) {
      m.deps = deps;
      return b;
    },
    server(fn: Mw["server"]) {
      m.server = fn;
      return m;
    },
  };
  return b;
}

async function rodarCadeia(mws: Mw[], ctx: Ctx, fim: (ctx: Ctx) => unknown): Promise<unknown> {
  const [primeiro, ...resto] = mws;
  if (!primeiro) return fim(ctx);
  return rodarCadeia(primeiro.deps, ctx, (c1) =>
    primeiro.server({
      context: c1,
      next: (o) => rodarCadeia(resto, { ...c1, ...(o?.context ?? {}) }, fim),
    }),
  );
}

type FnFalsa = ((o: { data?: unknown; ctx: Ctx }) => Promise<unknown>) & { middlewares: Mw[] };

function criarServerFn() {
  let mws: Mw[] = [];
  let validar: ((i: unknown) => unknown) | null = null;
  const b = {
    middleware(m: Mw[]) {
      mws = m;
      return b;
    },
    inputValidator(v: (i: unknown) => unknown) {
      validar = v;
      return b;
    },
    handler(h: (o: { data: unknown; context: Ctx }) => unknown) {
      const fn = (async ({ data, ctx }: { data?: unknown; ctx: Ctx }) => {
        let valido: unknown = data;
        try {
          valido = validar ? validar(data) : data;
        } catch {
          // Entrada inválida: a conferência de acesso continua valendo.
        }
        return rodarCadeia(mws, ctx, (c) => h({ data: valido, context: c }));
      }) as FnFalsa;
      fn.middlewares = mws;
      return fn;
    },
  };
  return b;
}

let souNexa = false;
const chamadas: string[] = [];
const bancoFalso = {
  rpc: async (fn: string) => {
    chamadas.push(`rpc:${fn}`);
    return fn === "sou_admin_nexa" ? { data: souNexa, error: null } : { data: null, error: null };
  },
  from: (t: string) => {
    chamadas.push(`from:${t}`);
    throw new Error(`leu ${t}`);
  },
};
const authFalso: Mw = {
  deps: [],
  server: ({ next }) => next({ context: { supabase: bancoFalso, userId: "u1" } }),
};

mock.module("@tanstack/react-start", {
  namedExports: { createServerFn: criarServerFn, createMiddleware: criarMiddleware },
});
mock.module("@tanstack/react-start/server", {
  namedExports: { getRequest: () => new Request("https://app.test/") },
});
mock.module("@/integrations/supabase/auth-middleware", {
  namedExports: { requireSupabaseAuth: authFalso },
});

/** Todas as funções do servidor do Painel Nexa (a lista que o relatório mostra). */
const FUNCOES_DO_PAINEL: Array<[arquivo: string, funcao: string]> = [
  ["./faturas.functions", "situacaoAsaasFn"],
  ["./faturas.functions", "gerarFaturaFn"],
  ["./numeracao-os.functions", "numeracaoOsNexaFn"],
  ["./numeracao-os.functions", "definirProximoNumeroOsFn"],
  ["./termos.functions", "termosConfigFn"],
  ["./termos.functions", "salvarTermosConfigFn"],
  ["./implantacao.functions", "implantacoesNexaFn"],
  ["./implantacao.functions", "liberarEmpresaFn"],
  ["./alice.functions", "criarRoboAlice"],
];

const ENTRADA = {
  empresaId: "4c891253-79f6-4622-885e-da663037fd8e",
  mes: "2026-11",
  vencimento: "2026-11-10",
  versao: "2026-10",
  url: "https://nexa.test/termos",
  liberar: true,
  numero: 100,
  conexaoId: "4c891253-79f6-4622-885e-da663037fd8e",
  origem: "https://app.test",
};

test("admin de empresa recebe erro em todas as funções do Painel Nexa, sem ler nada", async () => {
  const { ERRO_SO_NEXA } = await import("./nexa-admin");
  souNexa = false;
  for (const [arquivo, nome] of FUNCOES_DO_PAINEL) {
    const mod = (await import(arquivo)) as Record<string, FnFalsa>;
    const fn = mod[nome];
    assert.ok(fn, `${nome} existe`);
    chamadas.length = 0;
    await assert.rejects(fn({ data: ENTRADA, ctx: {} }), { message: ERRO_SO_NEXA }, nome);
    assert.deepEqual(chamadas, ["rpc:sou_admin_nexa"], `${nome}: só a conferência rodou`);
  }
});

test("nexa_admin passa da conferência (a função segue para o trabalho dela)", async () => {
  const { ERRO_SO_NEXA } = await import("./nexa-admin");
  souNexa = true;
  for (const [arquivo, nome] of FUNCOES_DO_PAINEL) {
    const mod = (await import(arquivo)) as Record<string, FnFalsa>;
    const r = await mod[nome]!({ data: ENTRADA, ctx: {} }).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    assert.notEqual(r, ERRO_SO_NEXA, `${nome} não barra a Nexa`);
  }
});

test("nenhuma outra função confere nexa_admin por conta própria (regra única)", () => {
  const raiz = join(import.meta.dirname, "..");
  const arquivos: string[] = [];
  const andar = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) andar(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) arquivos.push(p);
    }
  };
  andar(raiz);
  const comConferencia = arquivos
    .filter((p) => readFileSync(p, "utf8").includes('"sou_admin_nexa"'))
    .map((p) => p.slice(raiz.length + 1))
    .sort();
  // tenant.ts só decide o que a tela mostra; quem barra é nexa-admin.ts (servidor) e o banco.
  assert.deepEqual(comConferencia, ["lib/nexa-admin.ts", "lib/tenant.ts"]);
});
