/**
 * Temperatura por eventos (chamado pela varredura): primeiro a leitura de contexto das respostas
 * novas depois do orçamento (só empresas com a Alice ligada, até 20 por rodada), depois a regra no
 * banco. "Fechou com outra", "não quer" etc. não viram Quente. Falha da IA: a resposta fica sem
 * leitura e é tentada de novo na próxima rodada (nesse meio-tempo conta como Quente).
 */
export async function rodarTemperaturas(): Promise<{ lidos: number; alterados: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin;
  const { data: pendentes, error } = await db.rpc(
    "crm_temperatura_para_ler_contexto" as never,
    { _limite: 20 } as never,
  );
  if (error) throw new Error(`temperatura: ${error.message}`);
  let lidos = 0;
  const lista = (pendentes ?? []) as unknown as Array<{
    lead_id: string;
    empresa_id: string;
    whatsapp_contact_id: string;
  }>;
  if (lista.length) {
    const { contextoDoCliente } = await import("@/lib/alice/contexto-toque.server");
    for (const p of lista) {
      const lido = await contextoDoCliente(db as never, {
        empresaId: p.empresa_id,
        contatoId: p.whatsapp_contact_id,
        conversaId: null,
      });
      if (!lido) continue;
      await db
        .from("crm_leads")
        .update({ contexto_classe: lido.classe, contexto_lido_em: new Date().toISOString() })
        .eq("id", p.lead_id)
        .eq("empresa_id", p.empresa_id);
      lidos++;
    }
  }
  const { data: n, error: e2 } = await db.rpc("crm_recalcular_temperaturas" as never);
  if (e2) throw new Error(`temperatura: ${e2.message}`);
  return { lidos, alterados: Number(n ?? 0) };
}
