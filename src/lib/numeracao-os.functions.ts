/**
 * Painel Nexa › Empresas: "próximo número de OS" por empresa. A próxima OS recebe o maior entre
 * (maior número já usado + 1) e esse campo; o campo só aumenta e nunca fica abaixo do maior já
 * usado (o gatilho do banco garante). Só a Nexa lê e altera.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const CHAVE_NUMERACAO_OS = ["nexa_numeracao_os"] as const;

export type NumeracaoOs = {
  empresaId: string;
  /** Campo do painel (null = nunca definido). */
  proximoDefinido: number | null;
  /** Maior número numérico já usado em OS (null = nenhuma OS). */
  maiorUsado: number | null;
  /** O número que a próxima OS vai receber. */
  proximo: string;
};

/** Regra pura (mesma do banco), para a tela mostrar o resultado antes de salvar. */
export function proximoNumero(maiorUsado: number | null, definido: number | null): string {
  const n = Math.max((maiorUsado ?? 0) + 1, definido ?? 1, 1);
  return String(n).padStart(4, "0");
}

async function exigirNexa(supabase: { rpc: (fn: never) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("sou_admin_nexa" as never);
  if (data !== true) throw new Error("Só a Nexa altera a numeração das empresas.");
}

export const numeracaoOsNexaFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NumeracaoOs[]> => {
    await exigirNexa(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: empresas } = await supabaseAdmin
      .from("empresas")
      .select("id, proximo_numero_os")
      .order("nome");
    const { data: os } = await supabaseAdmin.from("work_orders").select("empresa_id, os_number");
    const maior = new Map<string, number>();
    for (const o of os ?? []) {
      const n = Number(String(o.os_number).replace(/\D/g, ""));
      if (!Number.isFinite(n) || n <= 0) continue;
      if (n > (maior.get(o.empresa_id) ?? 0)) maior.set(o.empresa_id, n);
    }
    return (empresas ?? []).map((e) => {
      const maiorUsado = maior.get(e.id) ?? null;
      return {
        empresaId: e.id,
        proximoDefinido: e.proximo_numero_os,
        maiorUsado,
        proximo: proximoNumero(maiorUsado, e.proximo_numero_os),
      };
    });
  });

export const definirProximoNumeroOsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { empresaId: string; proximo: number }) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(i.empresaId))) throw new Error("Empresa inválida.");
    const proximo = Math.trunc(Number(i.proximo));
    if (!Number.isFinite(proximo) || proximo < 1 || proximo > 999999)
      throw new Error("Informe um número de 1 a 999999.");
    return { empresaId: String(i.empresaId), proximo };
  })
  .handler(async ({ data, context }) => {
    await exigirNexa(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("empresas")
      .update({ proximo_numero_os: data.proximo })
      .eq("id", data.empresaId);
    if (error) {
      // Mensagens do gatilho ("só pode aumentar", "maior que o maior já usado") vão como estão.
      const msg = error.message.replace(/^.*?:\s*/, "");
      throw new Error(msg || "Não foi possível alterar o próximo número de OS.");
    }
    return { ok: true };
  });
