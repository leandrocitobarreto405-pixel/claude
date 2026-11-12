/** Mensagem pronta dos toques da equipe (trilha A 3 e 4, 05/11), escrita no Sonnet. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODELO_FICHA, custoUsd } from "@/lib/comercial/ficha";
import {
  instrucoesToqueEquipe,
  mensagemReserva,
  mensagemValida,
  type EntradaToqueEquipe,
} from "./toque-equipe";

type Db = SupabaseClient;

/** Fim da conversa em texto (cliente, Alice e equipe), sem notas internas. */
async function fimDaConversa(db: Db, empresaId: string, conversaId: string): Promise<string> {
  const { data } = await db
    .from("whatsapp_messages")
    .select("direction, remetente_tipo, text_content, transcricao, message_type")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(40);
  return (
    (data ?? []) as Array<{
      direction: string;
      remetente_tipo: string | null;
      text_content: string | null;
      transcricao: string | null;
      message_type: string | null;
    }>
  )
    .reverse()
    .map((m) => {
      const quem =
        m.direction === "Recebida"
          ? "Cliente"
          : m.remetente_tipo === "agent_bot"
            ? "Alice"
            : "Equipe";
      const texto = m.text_content || m.transcricao || `[${m.message_type ?? "mídia"}]`;
      return `${quem}: ${texto.replace(/\s+/g, " ").slice(0, 600)}`;
    })
    .join("\n");
}

export async function mensagemDoToqueEquipe(
  db: Db,
  o: EntradaToqueEquipe & { empresaId: string; conversaId: string },
): Promise<{ mensagem: string; custo: number; reserva: boolean }> {
  const entrada: EntradaToqueEquipe = {
    etapa: o.etapa,
    nomeCliente: o.nomeCliente,
    atendente: o.atendente,
    empresa: o.empresa,
  };
  try {
    const conversa = await fimDaConversa(db, o.empresaId, o.conversaId);
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { chamarIa } = await import("./parada-ia.server");
    const resp = await chamarIa(() =>
      new Anthropic({ timeout: 60_000, maxRetries: 1 }).messages.create({
        model: MODELO_FICHA,
        max_tokens: 1_500,
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["mensagem"],
              properties: { mensagem: { type: "string" } },
            },
          },
        },
        system: instrucoesToqueEquipe(entrada),
        messages: [{ role: "user", content: `Conversa (fim):\n${conversa.slice(-12_000)}` }],
      }),
    );
    const custo = custoUsd(resp.usage);
    // O custo desta mensagem não entra em ia_execucoes: grava em ia_chamadas (11/11).
    const { registrarChamadaIa } = await import("@/lib/ia-chamadas.server");
    await registrarChamadaIa(db, {
      empresaId: o.empresaId,
      origem: "toque_equipe",
      modelo: MODELO_FICHA,
      uso: resp.usage,
      referencia: o.conversaId,
    });
    if (resp.stop_reason !== "end_turn")
      return { mensagem: mensagemReserva(entrada), custo, reserva: true };
    const texto = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const m = ((JSON.parse(texto) as { mensagem?: string }).mensagem ?? "").trim();
    return mensagemValida(m, entrada)
      ? { mensagem: m, custo, reserva: false }
      : { mensagem: mensagemReserva(entrada), custo, reserva: true };
  } catch (e) {
    console.error("toque da equipe: mensagem", e instanceof Error ? e.message : String(e));
    return { mensagem: mensagemReserva(entrada), custo: 0, reserva: true };
  }
}
