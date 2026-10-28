/**
 * Frase {{2}} do retorno combinado fora da janela (regras em retorno-combinado.ts): a IA barata lê a
 * conversa (últimos 60 dias) e o motivo do retorno e escreve uma frase curta com empatia. Falha ou
 * frase fora das regras: "Como estão as coisas por aí?".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { historicoParaClassificar } from "./contexto-toque";
import {
  FRASE_RETORNO_PADRAO,
  INSTRUCAO_FRASE_RETORNO,
  limparFraseRetorno,
} from "./retorno-combinado";

type Db = SupabaseClient;

export async function fraseDoRetorno(
  db: Db,
  o: {
    empresaId: string;
    contatoId: string | null;
    conversaId: string;
    /** Motivo e sugestão anotados quando o retorno foi combinado. */
    motivo?: string | null;
    sugestao?: string | null;
  },
): Promise<string> {
  try {
    const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
    let q = db
      .from("whatsapp_messages")
      .select("direction, text_content, transcricao, message_timestamp")
      .eq("empresa_id", o.empresaId)
      .eq("privada", false)
      .gte("message_timestamp", desde)
      .order("message_timestamp", { ascending: false })
      .limit(60);
    q = o.contatoId ? q.eq("whatsapp_contact_id", o.contatoId) : q.eq("conversa_id", o.conversaId);
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
    const contexto = [
      o.motivo ? `Motivo do retorno combinado: ${o.motivo}` : null,
      o.sugestao ? `Anotação de quando combinou: ${o.sugestao}` : null,
      "Conversa:",
      historicoParaClassificar(msgs),
    ]
      .filter(Boolean)
      .join("\n");
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { chamarIa } = await import("./parada-ia.server");
    const r = await chamarIa(() =>
      new Anthropic().messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 80,
        system: INSTRUCAO_FRASE_RETORNO,
        messages: [{ role: "user", content: contexto }],
      }),
    );
    return limparFraseRetorno(r.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
  } catch (e) {
    console.error("Retorno combinado: frase não gerada", e instanceof Error ? e.message : e);
    return FRASE_RETORNO_PADRAO;
  }
}
