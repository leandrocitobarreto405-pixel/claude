/**
 * Temperatura por eventos (chamado pela varredura): primeiro a leitura de contexto das respostas
 * novas depois do orçamento (só empresas com a Alice ligada, até 20 por rodada), depois a regra no
 * banco. "Fechou com outra", "não quer" etc. não viram Quente. Falha da IA: a resposta fica sem
 * leitura e é tentada de novo na próxima rodada (nesse meio-tempo conta como Quente).
 */
/**
 * O que gravar no lead. "aguardando" ("vou pensar", sem data) não está na trava do banco
 * (crm_leads_contexto_classe_check) nem na regra da temperatura: grava só que foi lido e a
 * classe anterior fica como está.
 */
export function classeParaGravar(classe: string): { contexto_classe?: string } {
  return classe === "aguardando" ? {} : { contexto_classe: classe };
}

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
        origem: "classificador_temperatura",
      });
      if (!lido) continue;
      const agora = new Date().toISOString();
      const { error: eGrava } = await db
        .from("crm_leads")
        .update({ ...classeParaGravar(lido.classe), contexto_lido_em: agora })
        .eq("id", p.lead_id)
        .eq("empresa_id", p.empresa_id);
      if (eGrava) {
        // A leitura foi paga: marca como lida mesmo assim, senão o lead volta a cada rodada
        // (11/11: a classe "aguardando" era recusada pelo banco e o lead era relido de 5 em 5 min).
        console.error("temperatura: classe não gravada", eGrava.code ?? eGrava.message);
        await db
          .from("crm_leads")
          .update({ contexto_lido_em: agora })
          .eq("id", p.lead_id)
          .eq("empresa_id", p.empresa_id);
      }
      lidos++;
    }
  }
  const { data: n, error: e2 } = await db.rpc("crm_recalcular_temperaturas" as never);
  if (e2) throw new Error(`temperatura: ${e2.message}`);
  return { lidos, alterados: Number(n ?? 0) };
}
