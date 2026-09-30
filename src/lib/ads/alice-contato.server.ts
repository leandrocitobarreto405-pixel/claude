/**
 * Fase 2 (desligada): a Alice inicia a conversa com quem preencheu o pop-up e não chamou no
 * WhatsApp em N minutos (ads_configuracoes.alice_iniciar_apos_minutos, padrão 3).
 *
 * Conversa iniciada pela empresa exige modelo de mensagem aprovado pela Meta. Por isso:
 *  - só roda para empresas com alice_iniciar_conversa = true, e o banco não deixa ligar sem
 *    alice_template_nome;
 *  - o envio (enviarModeloDeBoasVindas) ainda não está implementado: é o ponto de integração.
 *    Quando o modelo for aprovado, ele cria o contato e a conversa no Chatwoot, envia o modelo com
 *    o nome do cliente e deixa a conversa com a Alice (pendente); daí a Alice segue sozinha.
 *
 * Chamado pela varredura da Alice (Cloud Scheduler a cada 5 min), então o atraso real fica entre
 * N e N+5 minutos.
 */
import { log } from "./captacao.server";

type Clique = {
  id: string;
  empresa_id: string;
  nome: string | null;
  normalized_phone: string;
  servico: string | null;
  created_at: string;
};

type Config = {
  empresa_id: string;
  alice_iniciar_apos_minutos: number;
  alice_template_nome: string | null;
  alice_template_idioma: string;
};

/** Ponto de integração da fase 2. Hoje não envia nada. */
async function enviarModeloDeBoasVindas(
  _cfg: Config,
  _clique: Clique,
): Promise<{ enviado: boolean; motivo: string }> {
  return { enviado: false, motivo: "envio pelo modelo da Meta ainda não implementado (fase 2)" };
}

export async function iniciarContatosPendentes(): Promise<{ empresas: number; iniciados: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: configs, error } = await supabaseAdmin
    .from("ads_configuracoes")
    .select("empresa_id, alice_iniciar_apos_minutos, alice_template_nome, alice_template_idioma")
    .eq("alice_iniciar_conversa", true);
  if (error) {
    log("ERROR", "alice_contato.falha_config", { erro: error.message });
    return { empresas: 0, iniciados: 0 };
  }
  let iniciados = 0;
  for (const cfg of configs ?? []) {
    const ate = new Date(Date.now() - cfg.alice_iniciar_apos_minutos * 60_000).toISOString();
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: cliques } = await supabaseAdmin
      .from("ads_clicks")
      .select("id, empresa_id, nome, normalized_phone, servico, created_at")
      .eq("empresa_id", cfg.empresa_id)
      .is("whatsapp_iniciado_em", null)
      .is("alice_contato_em", null)
      .lte("created_at", ate)
      .gte("created_at", desde)
      .limit(20);
    for (const clique of cliques ?? []) {
      const r = await enviarModeloDeBoasVindas(cfg, clique);
      if (r.enviado) {
        iniciados++;
        await supabaseAdmin
          .from("ads_clicks")
          .update({ alice_contato_em: new Date().toISOString() })
          .eq("id", clique.id);
      }
      // Registra uma vez por clique (a varredura passa de novo a cada 5 min).
      const { count } = await supabaseAdmin
        .from("ads_eventos")
        .select("id", { count: "exact", head: true })
        .eq("ads_click_id", clique.id)
        .eq("tipo", "alice");
      if (!count) {
        await supabaseAdmin.from("ads_eventos").insert({
          empresa_id: clique.empresa_id,
          tipo: "alice",
          resultado: r.enviado ? "iniciado" : "nao_enviado",
          ads_click_id: clique.id,
          detalhe: { motivo: r.motivo },
        });
        log(r.enviado ? "INFO" : "WARNING", "alice_contato.resultado", {
          empresa_id: clique.empresa_id,
          id: clique.id,
          enviado: r.enviado,
          motivo: r.motivo,
        });
      }
    }
  }
  return { empresas: configs?.length ?? 0, iniciados };
}
