/**
 * Encerramento automático de conversas paradas (roda na varredura do agendador, a cada poucos
 * minutos). Só nas empresas com a chave ligada em Configurações; por rodada, até 100 conversas
 * por empresa. Encerra no Chatwoot ("resolved") e marca no app; se o cliente escrever de novo,
 * o Chatwoot reabre e o webhook atualiza o app.
 */
import {
  CHAVE_CONFIG_CAIXA,
  configEncerramento,
  limiteParada,
  situacoesAlcancadas,
} from "@/lib/caixa-encerramento";

export type ResumoEncerramento = { empresas: number; encerradas: number; falhas: number };

export async function rodarEncerramentoAutomatico(): Promise<ResumoEncerramento> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { encerrarNoChatwoot } = await import("@/lib/conversas-limpeza.functions");
  const total: ResumoEncerramento = { empresas: 0, encerradas: 0, falhas: 0 };
  const { data: cfgs } = await supabaseAdmin
    .from("app_settings")
    .select("empresa_id, value")
    .eq("key", CHAVE_CONFIG_CAIXA);
  for (const linha of cfgs ?? []) {
    const cfg = configEncerramento(linha.value);
    if (!cfg.ligado || !linha.empresa_id) continue;
    total.empresas++;
    const { data: conversas, error } = await supabaseAdmin
      .from("conversas")
      .select("id, chatwoot_conversation_id, conexao_id")
      .eq("empresa_id", linha.empresa_id)
      .in("status", situacoesAlcancadas(cfg))
      .lt("ultima_atividade_em", limiteParada(cfg))
      .order("ultima_atividade_em")
      .limit(100);
    if (error || !conversas?.length) continue;
    const r = await encerrarNoChatwoot(
      conversas as Array<{ id: string; chatwoot_conversation_id: number; conexao_id: string }>,
      linha.empresa_id,
      "automatico",
    );
    total.encerradas += r.encerradas;
    total.falhas += r.falhas;
  }
  return total;
}
