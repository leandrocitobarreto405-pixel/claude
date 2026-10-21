/**
 * Caixa de entrada › equipe: assumir a conversa (Chatwoot primeiro; se falhar, nada muda e a
 * tela avisa), marcar como lida, "digitando… e lido" na Meta, presença na conversa (duas
 * atendentes), ligação de cada pessoa ao seu usuário do Chatwoot e o interruptor do "digitando".
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import { CHAVE_CONFIG_CAIXA, digitandoLigado } from "@/lib/caixa-encerramento";

const ID = /^[0-9a-f-]{36}$/i;
const validarConversa = (i: { conversaId: string }) => {
  if (!ID.test(String(i?.conversaId ?? ""))) throw new Error("Conversa inválida.");
  return { conversaId: i.conversaId };
};

type Conta = { baseUrl: string; accountId: number };

async function conexaoDaConversa(
  conexaoId: string,
): Promise<{ conta: Conta; token: string; botId: number | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: cx }, { data: sg }] = await Promise.all([
    supabaseAdmin
      .from("chatwoot_conexoes")
      .select("base_url, account_id, ativo, alice_bot_id")
      .eq("id", conexaoId)
      .maybeSingle(),
    supabaseAdmin
      .from("chatwoot_conexao_segredos")
      .select("api_token")
      .eq("conexao_id", conexaoId)
      .maybeSingle(),
  ]);
  if (!cx?.ativo || !sg?.api_token)
    throw new Error("A conexão do Chatwoot desta conversa está sem token de API.");
  return {
    conta: { baseUrl: cx.base_url, accountId: Number(cx.account_id) },
    token: sg.api_token,
    botId: cx.alice_bot_id == null ? null : Number(cx.alice_bot_id),
  };
}

/**
 * Assumir: a conversa sai da Alice (se estava com ela) e passa a ser minha. No Chatwoot, vira
 * "open" e é atribuída ao meu usuário de lá, quando existe; sem usuário no Chatwoot, fica "sem
 * responsável" lá (tira a atribuição de quem estava, para as duas fontes baterem) e minha aqui.
 * Se o Chatwoot falhar, nada é gravado.
 */
export const assumirConversaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator(validarConversa)
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: papel } = await db.rpc("meu_papel" as never);
    if (papel !== "admin" && papel !== "atendente")
      throw new Error("Só o administrador e o atendente assumem conversas.");
    const [{ data: conv }, { data: eu }] = await Promise.all([
      db
        .from("conversas")
        .select("id, status, chatwoot_conversation_id, conexao_id, assumida_por, responsavel_id")
        .eq("id", data.conversaId)
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      db
        .from("usuarios_empresa")
        .select("chatwoot_agent_id")
        .eq("empresa_id", context.empresaId)
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);
    if (!conv) throw new Error("Conversa não encontrada.");
    if (conv.status === "resolved")
      throw new Error("A conversa está encerrada. Responda para reabrir ou espere o cliente.");
    const { conta, token, botId } = await conexaoDaConversa(conv.conexao_id);
    const { atribuir, enviarMensagem, mudarSituacao } =
      await import("@/lib/alice/chatwoot-api.server");
    const cw = Number(conv.chatwoot_conversation_id);
    const agente = eu?.chatwoot_agent_id ?? null;
    const responsavel = conv.responsavel_id == null ? null : Number(conv.responsavel_id);
    const pessoaNoChatwoot = responsavel != null && responsavel !== botId;
    // Chatwoot primeiro: qualquer falha aqui interrompe sem mexer no app.
    if (conv.status === "pending") {
      await enviarMensagem(
        conta,
        token,
        cw,
        "🤖 A equipe assumiu esta conversa pelo Nexa OS. Para devolver, mande a nota #alice.",
        true,
      );
      await mudarSituacao(conta, token, cw, "open");
    }
    if (agente != null) await atribuir(conta, token, cw, agente);
    // Sem usuário no Chatwoot e a conversa estava com outra pessoa lá: fica "sem responsável".
    else if (pessoaNoChatwoot && responsavel !== agente) await atribuir(conta, token, cw, null);
    const agora = new Date().toISOString();
    const { error } = await db
      .from("conversas")
      .update({
        status: "open",
        assumida_por: context.userId,
        assumida_em: agora,
        ...(agente == null && pessoaNoChatwoot
          ? { responsavel_id: null, responsavel_nome: null }
          : {}),
      })
      .eq("id", conv.id)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("O Chatwoot aceitou, mas o app não gravou. Recarregue a tela.");
    return { ok: true, noChatwoot: agente != null };
  });

/** Até agora eu li esta conversa (não lidas zeram). */
export const marcarLidaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator(validarConversa)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("conversas_leituras").upsert(
      {
        empresa_id: context.empresaId,
        conversa_id: data.conversaId,
        user_id: context.userId,
        lida_em: new Date().toISOString(),
      },
      { onConflict: "conversa_id,user_id" },
    );
    if (error) throw new Error("Não foi possível marcar como lida.");
    return { ok: true };
  });

/**
 * Presença: avisa a equipe (canal da empresa no Realtime) que estou com esta conversa aberta
 * ("aqui", renovado a cada 25 s) ou que saí. Nada vai ao cliente nem ao banco.
 */
export const presencaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { conversaId: string; estado: "aqui" | "saiu" }) => ({
    ...validarConversa(i),
    estado: i?.estado === "saiu" ? ("saiu" as const) : ("aqui" as const),
  }))
  .handler(async ({ data, context }) => {
    const { data: perfil } = await context.supabase
      .from("users_profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();
    const { avisarCanalDaEmpresa } = await import("@/lib/tempo-real.server");
    const ok = await avisarCanalDaEmpresa(context.empresaId, "presenca", {
      conversaId: data.conversaId,
      userId: context.userId,
      nome: perfil?.full_name || "Colega",
      estado: data.estado,
    });
    return { ok };
  });

/**
 * "Digitando…" para o cliente e a última mensagem dele marcada como lida, direto na Meta com o
 * token do número da empresa. Silencioso: sem conexão Meta, desligado ou erro, só não faz nada.
 */
export const avisarDigitandoFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator(validarConversa)
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; motivo?: string; detalhe?: string }> => {
      const db = context.supabase;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: cfg }, { data: meta }, { data: segredo }, { data: ultima }] =
        await Promise.all([
          db
            .from("app_settings")
            .select("value")
            .eq("empresa_id", context.empresaId)
            .eq("key", CHAVE_CONFIG_CAIXA)
            .maybeSingle(),
          supabaseAdmin
            .from("meta_conexoes")
            .select("waba_id")
            .eq("empresa_id", context.empresaId)
            .maybeSingle(),
          supabaseAdmin
            .from("meta_conexao_segredos")
            .select("token")
            .eq("empresa_id", context.empresaId)
            .maybeSingle(),
          db
            .from("whatsapp_messages")
            .select("whatsapp_message_id")
            .eq("conversa_id", data.conversaId)
            .eq("direction", "Recebida")
            .not("whatsapp_message_id", "is", null)
            .order("message_timestamp", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      if (!digitandoLigado(cfg?.value)) return { ok: false, motivo: "desligado" };
      if (!meta?.waba_id || !segredo?.token) return { ok: false, motivo: "sem_meta" };
      if (!ultima?.whatsapp_message_id) return { ok: false, motivo: "sem_mensagem" };
      const cx = { waba: meta.waba_id, token: segredo.token };
      try {
        const { indicarDigitando, numerosDaConta } = await import("@/lib/meta/graph.server");
        const valor = (cfg?.value && typeof cfg.value === "object" ? cfg.value : {}) as Record<
          string,
          unknown
        >;
        let numeroId = typeof valor["meta_numero_id"] === "string" ? valor["meta_numero_id"] : null;
        if (!numeroId) {
          // Primeiro uso: descobre o número da conta e guarda junto com a configuração da caixa.
          const numeros = await numerosDaConta(cx);
          numeroId = numeros[0]?.id ?? null;
          if (!numeroId) return { ok: false, motivo: "sem_numero" };
          await supabaseAdmin.from("app_settings").upsert(
            {
              empresa_id: context.empresaId,
              key: CHAVE_CONFIG_CAIXA,
              value: { ...valor, meta_numero_id: numeroId } as never,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "empresa_id,key" },
          );
        }
        await indicarDigitando(cx, numeroId, ultima.whatsapp_message_id);
        return { ok: true };
      } catch (e) {
        const { semToken } = await import("@/lib/meta/graph.server");
        const detalhe = semToken(e instanceof Error ? e.message : String(e)).slice(0, 200);
        console.warn("Caixa: digitando na Meta falhou:", detalhe);
        return { ok: false, motivo: "meta", detalhe };
      }
    },
  );

export const lerDigitandoFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<{ ligado: boolean; temMeta: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: cfg }, { data: meta }] = await Promise.all([
      context.supabase
        .from("app_settings")
        .select("value")
        .eq("empresa_id", context.empresaId)
        .eq("key", CHAVE_CONFIG_CAIXA)
        .maybeSingle(),
      supabaseAdmin
        .from("meta_conexoes")
        .select("waba_id")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
    ]);
    return { ligado: digitandoLigado(cfg?.value), temMeta: Boolean(meta?.waba_id) };
  });

export const salvarDigitandoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { ligado: boolean }) => ({ ligado: i?.ligado === true }))
  .handler(async ({ data, context }) => {
    const { data: atual } = await context.supabase
      .from("app_settings")
      .select("value")
      .eq("empresa_id", context.empresaId)
      .eq("key", CHAVE_CONFIG_CAIXA)
      .maybeSingle();
    const value = {
      ...((atual?.value && typeof atual.value === "object" ? atual.value : {}) as Record<
        string,
        unknown
      >),
      digitando_meta: data.ligado,
    };
    const { error } = await context.supabase.from("app_settings").upsert(
      {
        empresa_id: context.empresaId,
        key: CHAVE_CONFIG_CAIXA,
        value: value as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,key" },
    );
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

export type AgenteChatwoot = { id: number; nome: string; email: string | null };

/** Usuários do Chatwoot da empresa (para ligar cada pessoa ao seu usuário de lá). */
export const agentesChatwootFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<AgenteChatwoot[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conv } = await supabaseAdmin
      .from("conversas")
      .select("conexao_id")
      .eq("empresa_id", context.empresaId)
      .limit(1)
      .maybeSingle();
    if (!conv) return [];
    const { conta, token } = await conexaoDaConversa(conv.conexao_id);
    const { chamar } = await import("@/lib/alice/chatwoot-api.server");
    const lista = await chamar<Array<{ id: number; name: string; email?: string }>>(
      conta,
      token,
      "/agents",
    ).catch(() => []);
    return lista.map((a) => ({ id: Number(a.id), nome: a.name, email: a.email ?? null }));
  });

export const ligarAgenteChatwootFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { vinculoId: string; agenteId: number | null }) => {
    if (!ID.test(String(i?.vinculoId ?? ""))) throw new Error("Pessoa inválida.");
    const agenteId = i.agenteId == null ? null : Number(i.agenteId);
    if (agenteId != null && !Number.isInteger(agenteId)) throw new Error("Usuário inválido.");
    return { vinculoId: i.vinculoId, agenteId };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("usuarios_empresa")
      .update({ chatwoot_agent_id: data.agenteId })
      .eq("id", data.vinculoId)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível salvar a ligação com o Chatwoot.");
    return { ok: true };
  });
