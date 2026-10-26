/**
 * Painel Nexa: só o administrador da Nexa (nexa_admin, conferido pelo banco em
 * `sou_admin_nexa`). Regra única para todas as funções do servidor do painel; admin de
 * empresa recebe erro. Sem dependência do TanStack, para o teste de unidade.
 */
export const ERRO_SO_NEXA = "Só a equipe da Nexa acessa o Painel Nexa.";

type ComRpc = {
  rpc: (fn: never) => PromiseLike<{ data: unknown; error?: unknown }>;
};

export async function exigirNexaAdmin(supabase: ComRpc): Promise<void> {
  const { data, error } = await supabase.rpc("sou_admin_nexa" as never);
  if (error || data !== true) throw new Error(ERRO_SO_NEXA);
}
