/**
 * Serviço de data passada que continua "Agendado" depois de 1 dia: um aviso só no app por visita
 * ("Serviço de DD/MM da OS X ainda não foi concluído"). Chamado pela varredura; a regra fica no
 * banco (public.avisos_servicos_nao_concluidos), que não repete o aviso da mesma visita.
 */
export async function avisarServicosNaoConcluidos(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("avisos_servicos_nao_concluidos" as never);
  if (error) throw new Error(`avisos de serviços não concluídos: ${error.message}`);
  return Number(data ?? 0);
}
