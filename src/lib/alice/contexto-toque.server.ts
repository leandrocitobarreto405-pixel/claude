/**
 * Antes de cada toque automático (A, B, R e qualquer follow-up da Alice) e do envio automático ao
 * lead do site: a IA barata lê o
 * histórico do cliente (últimos 60 dias, todas as conversas do contato). Bloqueia o toque quando o
 * cliente já disse que fechou com outra empresa, achou mais barato, já fez, não quer mais ou pediu
 * para parar. Falha da IA: o toque segue (registra no log).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INSTRUCAO_CLASSIFICADOR,
  historicoParaClassificar,
  lerClassificacao,
  type ClasseContexto,
} from "./contexto-toque";

type Db = SupabaseClient;

export async function contextoDoCliente(
  db: Db,
  o: { empresaId: string; contatoId: string | null; conversaId: string | null },
): Promise<{ classe: ClasseContexto; trecho: string } | null> {
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
  let q = db
    .from("whatsapp_messages")
    .select("direction, text_content, transcricao, message_timestamp")
    .eq("empresa_id", o.empresaId)
    .eq("privada", false)
    .gte("message_timestamp", desde)
    .order("message_timestamp", { ascending: false })
    .limit(80);
  if (o.contatoId) q = q.eq("whatsapp_contact_id", o.contatoId);
  else if (o.conversaId) q = q.eq("conversa_id", o.conversaId);
  else return null;
  const { data } = await q;
  const msgs = (
    (data ?? []) as Array<{
      direction: string;
      text_content: string | null;
      transcricao: string | null;
      message_timestamp: string;
    }>
  )
    .reverse()
    .map((m) => ({
      direcao: m.direction,
      texto: m.text_content || m.transcricao,
      quando: m.message_timestamp,
    }));
  if (!msgs.some((m) => m.direcao === "Recebida" && (m.texto ?? "").trim())) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { chamarIa } = await import("./parada-ia.server");
    const r = await chamarIa(() =>
      new Anthropic().messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 120,
        system: INSTRUCAO_CLASSIFICADOR,
        messages: [{ role: "user", content: historicoParaClassificar(msgs) }],
      }),
    );
    const texto = r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return lerClassificacao(texto);
  } catch (e) {
    console.error("Contexto do toque: classificação falhou", e instanceof Error ? e.message : e);
    return null;
  }
}
