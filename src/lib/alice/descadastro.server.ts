// Descadastro de marketing do lado do servidor: a Alice confirma uma vez e a ferramenta
// descadastrar_marketing marca o contato. O banco cuida do resto (base de marketing, envios
// pendentes e etiqueta), pelos gatilhos da migração 20261130120000.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { CONFIRMACAO_DESCADASTRO } from "@/lib/descadastro";

type Admin = SupabaseClient<Database>;

/** O que o cliente mandou desde a última mensagem enviada (é o que a Alice vai responder). */
export async function textoDoClienteAgora(
  db: Admin,
  empresaId: string,
  conversaId: string,
): Promise<string> {
  const { data } = await db
    .from("whatsapp_messages")
    .select("direction, text_content, privada")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("privada", false)
    .order("created_at", { ascending: false })
    .limit(10);
  const textos: string[] = [];
  for (const m of data ?? []) {
    if (m.direction !== "Recebida") break;
    if (m.text_content) textos.unshift(m.text_content);
  }
  return textos.join("\n");
}

export async function marcarConfirmado(db: Admin, empresaId: string, contatoId: string) {
  await db
    .from("whatsapp_contacts")
    .update({ marketing_optout_confirmado_em: new Date().toISOString() })
    .eq("id", contatoId)
    .eq("empresa_id", empresaId);
}

/** Ferramenta descadastrar_marketing: o cliente pediu para sair e o gatilho não reconheceu a frase. */
export async function descadastrarPelaAlice(
  db: Admin,
  empresaId: string,
  contatoId: string | null,
): Promise<string> {
  if (!contatoId) return "Não achei o contato desta conversa; avise a equipe na passagem.";
  const { data: c } = await db
    .from("whatsapp_contacts")
    .select("marketing_optout_em")
    .eq("id", contatoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (c?.marketing_optout_em)
    return "Este cliente já estava fora do marketing. Não precisa confirmar de novo.";
  const agora = new Date().toISOString();
  const { error } = await db
    .from("whatsapp_contacts")
    .update({
      marketing_optout_em: agora,
      marketing_optout_origem: "cliente",
      marketing_optout_por: null,
      marketing_optout_confirmado_em: agora,
    })
    .eq("id", contatoId)
    .eq("empresa_id", empresaId);
  if (error) return "Não consegui marcar agora; avise a equipe na passagem.";
  return `Feito: o cliente não recebe mais promoções (atendimento, confirmação e pós-venda continuam). Confirme uma vez, com: "${CONFIRMACAO_DESCADASTRO}"`;
}
