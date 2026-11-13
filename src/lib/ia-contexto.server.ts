/**
 * Contexto da chamada de IA (13/11): empresa e origem da rodada em andamento (conversa da Alice,
 * leitura da Tatiana…), para a chamarIa gravar o custo de toda chamada em ia_chamadas sem passar a
 * empresa por todas as funções do caminho.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type ContextoIa = { empresaId: string; origem: string; referencia?: string | null };

const armazem = new AsyncLocalStorage<ContextoIa>();

export function comContextoIa<T>(c: ContextoIa, fn: () => Promise<T>): Promise<T> {
  return armazem.run(c, fn);
}

export function contextoIa(): ContextoIa | null {
  return armazem.getStore() ?? null;
}
