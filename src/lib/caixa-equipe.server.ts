/**
 * Caixa de entrada › equipe, só no servidor: a trava das duas atendentes nos envios.
 */
import type { Banco } from "@/lib/banco";
import { primeiroNome, quemEstaCom } from "@/lib/caixa-equipe";

/**
 * Trava das duas atendentes: se a conversa está com outra pessoa da equipe (no Chatwoot ou
 * assumida pelo app), responder exige assumir antes. Usado pelos envios da caixa.
 */
export async function exigirLivreOuMinha(
  db: Banco,
  empresaId: string,
  userId: string,
  conversa: {
    status: string | null;
    assumida_por?: string | null;
    responsavel_id?: number | string | null;
    responsavel_nome?: string | null;
    conexao_id: string;
  },
): Promise<void> {
  if (conversa.status !== "open") return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: eu }, { data: cx }] = await Promise.all([
    db
      .from("usuarios_empresa")
      .select("chatwoot_agent_id")
      .eq("empresa_id", empresaId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("chatwoot_conexoes")
      .select("alice_bot_id")
      .eq("id", conversa.conexao_id)
      .maybeSingle(),
  ]);
  const posse = quemEstaCom(
    {
      assumidaPor: conversa.assumida_por ?? null,
      responsavelId: conversa.responsavel_id == null ? null : Number(conversa.responsavel_id),
      grupo: "equipe",
    },
    {
      userId,
      chatwootAgentId: eu?.chatwoot_agent_id ?? null,
      botIds: cx?.alice_bot_id == null ? [] : [Number(cx.alice_bot_id)],
    },
  );
  if (posse !== "outra") return;
  let nome = conversa.responsavel_id != null ? conversa.responsavel_nome : null;
  if (!nome && conversa.assumida_por) {
    const { data: p } = await db
      .from("users_profiles")
      .select("full_name")
      .eq("id", conversa.assumida_por)
      .maybeSingle();
    nome = p?.full_name ?? null;
  }
  throw new Error(
    `A conversa está com ${primeiroNome(nome)}. Toque em "Assumir para mim" antes de responder.`,
  );
}
