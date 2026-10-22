/**
 * Interruptor "Recebe marketing" nos dados do contato (equipe). Desligar marca o contato como
 * fora do marketing pela equipe; ligar de novo volta a receber. O banco leva a mudança para a
 * base de marketing e cancela os envios pendentes (migração 20261130120000).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";

const ID = /^[0-9a-f-]{36}$/i;

export const alterarMarketingFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { conversaId: string; recebe: boolean }) => {
    if (!ID.test(String(i?.conversaId ?? ""))) throw new Error("Conversa inválida.");
    return { conversaId: i.conversaId, recebe: i.recebe === true };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: papel } = await db.rpc("meu_papel" as never);
    if (papel !== "admin" && papel !== "atendente")
      throw new Error("Só o administrador e o atendente mudam o marketing do contato.");
    const { data: conv } = await db
      .from("conversas")
      .select("whatsapp_contact_id")
      .eq("id", data.conversaId)
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!conv?.whatsapp_contact_id) throw new Error("Conversa sem contato do WhatsApp.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const agora = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("whatsapp_contacts")
      .update(
        data.recebe
          ? {
              marketing_optout_em: null,
              marketing_optout_origem: null,
              marketing_optout_por: null,
              marketing_optout_confirmado_em: null,
            }
          : {
              marketing_optout_em: agora,
              marketing_optout_origem: "equipe",
              marketing_optout_por: context.userId,
              // A equipe desligou: a Alice não manda confirmação nenhuma.
              marketing_optout_confirmado_em: agora,
            },
      )
      .eq("id", conv.whatsapp_contact_id)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível mudar o marketing do contato.");
    return { recebe: data.recebe, desde: data.recebe ? null : agora };
  });
