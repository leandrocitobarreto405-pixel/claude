/**
 * OS criada sem partir de um lead: a varredura liga ao lead aberto do CRM com o mesmo
 * telefone (DDD + 8 dígitos), só quando há exatamente um. Nenhum ou vários: não liga e
 * fica registrado em ads_eventos. Espera 10 min depois da OS para não atropelar o app.
 */
export async function ligarOsSemLead() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: empresas, error } = await supabaseAdmin.from("empresas").select("id");
  if (error) throw new Error(`leitura das empresas: ${error.message}`);
  const total = { ligadas: 0, sem_lead: 0, varios_leads: 0 };
  for (const e of empresas ?? []) {
    const { data, error: erro } = await supabaseAdmin.rpc(
      "crm_ligar_os_sem_lead" as never,
      { _emp: e.id } as never,
    );
    if (erro) {
      console.error("CRM: falha ao ligar OS sem lead", erro.message);
      continue;
    }
    const r = (data ?? {}) as Partial<typeof total>;
    total.ligadas += r.ligadas ?? 0;
    total.sem_lead += r.sem_lead ?? 0;
    total.varios_leads += r.varios_leads ?? 0;
  }
  return total;
}
