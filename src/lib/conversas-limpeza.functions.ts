/**
 * Encerrar conversas no Chatwoot: em lote as paradas com a equipe (só admin, sempre mostrando a
 * lista antes) ou as escolhidas uma a uma. O servidor confere de novo cada uma.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

export const DIAS_PARADA = [3, 7, 15, 30];

export type ConversaParada = {
  id: string;
  nome: string;
  ultimaAtividade: string;
  esperandoDesde: string | null;
};

const limite = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
const diasValidos = (d: unknown) => (DIAS_PARADA.includes(Number(d)) ? Number(d) : 3);

export const conversasParadasFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { dias: number }) => ({ dias: diasValidos(i.dias) }))
  .handler(async ({ data, context }): Promise<ConversaParada[]> => {
    const { data: lista, error } = await context.supabase
      .from("conversas")
      .select(
        "id, ultima_atividade_em, aguardando_desde, contato:whatsapp_contact_id ( profile_name, display_phone )",
      )
      .eq("empresa_id", context.empresaId)
      .eq("status", "open")
      .lt("ultima_atividade_em", limite(data.dias))
      .order("ultima_atividade_em")
      .limit(100);
    if (error) throw new Error("Não foi possível carregar as conversas.");
    return (
      (lista ?? []) as unknown as Array<{
        id: string;
        ultima_atividade_em: string;
        aguardando_desde: string | null;
        contato: { profile_name: string | null; display_phone: string | null } | null;
      }>
    ).map((c) => ({
      id: c.id,
      nome: c.contato?.profile_name || c.contato?.display_phone || "Cliente",
      ultimaAtividade: c.ultima_atividade_em,
      esperandoDesde: c.aguardando_desde,
    }));
  });

export const encerrarConversasFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { ids: string[]; dias: number }) => ({
    ids: (i.ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100),
    dias: diasValidos(i.dias),
  }))
  .handler(async ({ data, context }) => {
    if (!data.ids.length) throw new Error("Escolha pelo menos uma conversa.");
    // Confere de novo: da empresa, com a equipe e parada há mais de X dias (nada mudou no meio).
    const { data: conversas } = await context.supabase
      .from("conversas")
      .select("id, chatwoot_conversation_id, conexao_id")
      .eq("empresa_id", context.empresaId)
      .eq("status", "open")
      .lt("ultima_atividade_em", limite(data.dias))
      .in("id", data.ids);
    return encerrarNoChatwoot(conversas ?? [], context.empresaId, "lote");
  });

type ParaEncerrar = { id: string; chatwoot_conversation_id: number | string; conexao_id: string };

/** Encerra no Chatwoot e marca como resolvida (lotes paralelos de 5). */
async function encerrarNoChatwoot(lista: ParaEncerrar[], empresaId: string, origem: string) {
  if (!lista.length) return { encerradas: 0, falhas: 0 };
  const { dbServico, log } = await import("@/lib/mkt/contexto.server");
  const { mudarSituacao } = await import("@/lib/alice/chatwoot-api.server");
  const db = await dbServico();
  const conexoes = new Map<
    string,
    { conta: { baseUrl: string; accountId: number }; token: string } | null
  >();
  let encerradas = 0;
  let falhas = 0;
  // Conexões primeiro (normalmente uma só), depois o Chatwoot em lotes paralelos de 5: o app atrás
  // do Firebase Hosting tem 60 s por pedido, e 100 conversas em fila podiam passar disso.
  for (const id of new Set(lista.map((c) => c.conexao_id))) {
    const [{ data: cx }, { data: sg }] = await Promise.all([
      db.from("chatwoot_conexoes").select("base_url, account_id").eq("id", id).maybeSingle(),
      db.from("chatwoot_conexao_segredos").select("api_token").eq("conexao_id", id).maybeSingle(),
    ]);
    conexoes.set(
      id,
      cx && sg?.api_token
        ? {
            conta: { baseUrl: cx.base_url, accountId: Number(cx.account_id) },
            token: sg.api_token,
          }
        : null,
    );
  }
  const encerrar = async (c: (typeof lista)[number]) => {
    const cx = conexoes.get(c.conexao_id);
    if (!cx) {
      falhas++;
      return;
    }
    try {
      await mudarSituacao(cx.conta, cx.token, Number(c.chatwoot_conversation_id), "resolved");
      await db
        .from("conversas")
        .update({ status: "resolved", aguardando_desde: null })
        .eq("id", c.id)
        .eq("empresa_id", empresaId);
      encerradas++;
    } catch (e) {
      falhas++;
      log("WARNING", "conversa.encerrar_falhou", {
        conversa: c.id,
        erro: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  };
  for (let i = 0; i < lista.length; i += 5) await Promise.all(lista.slice(i, i + 5).map(encerrar));
  log("INFO", "conversas.encerradas", { empresa: empresaId, origem, encerradas, falhas });
  return { encerradas, falhas };
}

/**
 * Encerrar as conversas escolhidas (uma, na conversa ou na lista, ou várias marcadas em
 * "Precisam de você"). Admin e atendente; o técnico não vê conversas.
 */
export const encerrarEscolhidasFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { ids: string[] }) => ({
    ids: (i.ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100),
  }))
  .handler(async ({ data, context }) => {
    const { data: papel } = await context.supabase.rpc("meu_papel" as never);
    if (papel !== "admin" && papel !== "atendente")
      throw new Error("Só o administrador e o atendente encerram conversas.");
    if (!data.ids.length) throw new Error("Escolha pelo menos uma conversa.");
    const { data: conversas } = await context.supabase
      .from("conversas")
      .select("id, chatwoot_conversation_id, conexao_id")
      .eq("empresa_id", context.empresaId)
      .neq("status", "resolved")
      .in("id", data.ids);
    return encerrarNoChatwoot(conversas ?? [], context.empresaId, "escolhidas");
  });
