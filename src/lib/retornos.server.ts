/** Retornos da equipe vencidos há mais de 3 dias viram "Vencida" (chamado pela varredura). */
export async function expirarRetornos(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("crm_expirar_retornos" as never);
  if (error) throw new Error(`expirar retornos: ${error.message}`);
  return Number(data ?? 0);
}
