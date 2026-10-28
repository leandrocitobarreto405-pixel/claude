/**
 * Devolução para a Alice no servidor (regras em devolucao.ts): resposta na hora quando o cliente
 * está esperando e retomada das conversas que ficaram paradas durante a pausa da IA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { clienteEsperando, notaRetomada } from "./devolucao";

type Db = SupabaseClient<Database>;

/** A última mensagem que o cliente vê (sem as notas internas) é dele? */
export async function clienteEsperandoNaConversa(db: Db, conversaId: string): Promise<boolean> {
  const { data } = await db
    .from("whatsapp_messages")
    .select("direction")
    .eq("conversa_id", conversaId)
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  return clienteEsperando(data);
}

/** Cria a resposta da Alice agora (até 1 minuto, pela fila). Já existir uma pendente está ok. */
export async function responderAgora(db: Db, empresaId: string, conversaId: string) {
  const { error } = await db
    .from("ia_tarefas")
    .insert({ empresa_id: empresaId, conversa_id: conversaId, tipo: "responder" });
  if (error && error.code !== "23505") throw error;
  const { enfileirarPendentes } = await import("./fila.server");
  await enfileirarPendentes(db as never);
}

/**
 * Fim da pausa da IA: as conversas que foram para a equipe durante a pausa e continuam sem
 * resposta (a última mensagem é do cliente) voltam para a Alice, que responde na hora. Conversa
 * já respondida pela equipe, cliente com a IA desligada ou empresa com a Alice desligada ficam
 * como estão. Devolve quantas foram retomadas.
 */
export async function retomarConversasDaPausa(
  db: Db,
  paradas: Array<{ empresa_id: string; conversas: string[] | null }>,
): Promise<number> {
  const { enviarMensagem, mudarSituacao } = await import("./chatwoot-api.server");
  let retomadas = 0;
  for (const p of paradas) {
    const ids = [...new Set(p.conversas ?? [])];
    if (!ids.length) continue;
    const { data: cfg } = await db
      .from("ia_configuracoes")
      .select("ativo, nome")
      .eq("empresa_id", p.empresa_id)
      .maybeSingle();
    if (!cfg?.ativo) continue;
    const { data: conversas } = await db
      .from("conversas")
      .select("id, status, chatwoot_conversation_id, conexao_id, whatsapp_contact_id")
      .eq("empresa_id", p.empresa_id)
      .in("id", ids);
    for (const c of conversas ?? []) {
      try {
        if (c.status === "resolved" || !(await clienteEsperandoNaConversa(db, c.id))) continue;
        if (c.whatsapp_contact_id) {
          const { data: contato } = await db
            .from("whatsapp_contacts")
            .select("ia_desligada")
            .eq("id", c.whatsapp_contact_id)
            .maybeSingle();
          if (contato?.ia_desligada) continue;
        }
        const [{ data: cx }, { data: sg }] = await Promise.all([
          db
            .from("chatwoot_conexoes")
            .select("base_url, account_id")
            .eq("id", c.conexao_id)
            .single(),
          db
            .from("chatwoot_conexao_segredos")
            .select("api_token")
            .eq("conexao_id", c.conexao_id)
            .maybeSingle(),
        ]);
        if (!cx || !sg?.api_token) continue;
        const conta = { baseUrl: cx.base_url, accountId: Number(cx.account_id) };
        const cw = Number(c.chatwoot_conversation_id);
        await enviarMensagem(conta, sg.api_token, cw, notaRetomada(cfg.nome ?? "Alice"), true);
        await mudarSituacao(conta, sg.api_token, cw, "pending");
        await db
          .from("conversas")
          .update({
            status: "pending",
            devolvida_para_alice_em: new Date().toISOString(),
            assumida_por: null,
            assumida_em: null,
          })
          .eq("id", c.id);
        await responderAgora(db, p.empresa_id, c.id);
        retomadas++;
      } catch (e) {
        console.error(
          "Alice: falha ao retomar conversa da pausa",
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
  return retomadas;
}
