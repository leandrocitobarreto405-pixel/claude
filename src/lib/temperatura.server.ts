/**
 * Varredura do retorno combinado (12/11). A temperatura (Quente/Morno/Frio) foi desligada a pedido
 * do dono: a leitura de contexto por IA das respostas depois do orçamento não roda mais e as telas
 * mostram a classificação da Tatiana. A rotina do banco continua sendo chamada porque é ela que
 * grava o retorno combinado do lead (selo das telas e leitura da Tatiana); a coluna de temperatura
 * que ela preenche não aparece mais em lugar nenhum.
 */
export async function rodarTemperaturas(): Promise<{ lidos: number; alterados: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: n, error } = await supabaseAdmin.rpc("crm_recalcular_temperaturas" as never);
  if (error) throw new Error(`retorno combinado: ${error.message}`);
  return { lidos: 0, alterados: Number(n ?? 0) };
}
