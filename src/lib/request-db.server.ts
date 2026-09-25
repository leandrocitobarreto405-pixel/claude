import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Contexto da requisição para módulos de servidor: cliente do banco do próprio usuário
 * (sujeito ao RLS e já com a empresa ativa) e o id da empresa validado pelo banco.
 */
export type ContextoEmpresa = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  empresaId: string;
  userId: string;
};

const armazenamento = new AsyncLocalStorage<ContextoEmpresa>();

export function executarNaEmpresa<T>(ctx: ContextoEmpresa, fn: () => T): T {
  return armazenamento.run(ctx, fn);
}

export function contextoEmpresa(): ContextoEmpresa {
  const ctx = armazenamento.getStore();
  if (!ctx) {
    throw new Error("Operação sem empresa definida. Use o middleware requireEmpresa.");
  }
  return ctx;
}

/** Cliente do banco da requisição atual (RLS da empresa ativa). */
export function bancoDaEmpresa() {
  return contextoEmpresa().db;
}
