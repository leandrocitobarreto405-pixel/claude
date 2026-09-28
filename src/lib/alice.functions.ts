import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

export const MODELOS_ALICE = [
  { id: "claude-opus-5", nome: "Claude Opus 5 (recomendado)" },
  { id: "claude-sonnet-5", nome: "Claude Sonnet 5 (mais barato)" },
] as const;

export type ConfigAlice = {
  ativo: boolean;
  nome: string;
  instrucoes: string;
  perguntas_frequentes: string;
  desconto_max_percentual: number;
  modelo: string;
  esforco: "low" | "medium" | "high";
  espera_segundos: number;
  limite_respostas_conversa: number;
};

export type SituacaoAlice = {
  config: ConfigAlice;
  iaNoServidor: boolean;
  roboNoChatwoot: boolean;
  caixas: number;
  ultimos7dias: { respostas: number; custoUsd: number; passagens: number; erros: number };
};

const PADRAO: ConfigAlice = {
  ativo: false,
  nome: "Alice",
  instrucoes: "",
  perguntas_frequentes: "",
  desconto_max_percentual: 0,
  modelo: "claude-opus-5",
  esforco: "medium",
  espera_segundos: 8,
  limite_respostas_conversa: 40,
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Caixas de entrada da empresa com a conexão, o robô e os tokens (só no servidor). */
async function caixasDaEmpresa(empresaId: string) {
  const db = await admin();
  const { data: caixas } = await db
    .from("chatwoot_inboxes")
    .select("inbox_id, conexao_id")
    .eq("empresa_id", empresaId)
    .eq("ativo", true);
  const ids = [...new Set((caixas ?? []).map((c) => c.conexao_id))];
  const [{ data: conexoes }, { data: segredos }] = await Promise.all([
    ids.length
      ? db.from("chatwoot_conexoes").select("id, base_url, account_id, alice_bot_id").in("id", ids)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            base_url: string;
            account_id: number;
            alice_bot_id: number | null;
          }>,
        }),
    ids.length
      ? db
          .from("chatwoot_conexao_segredos")
          .select("conexao_id, api_token, alice_bot_token")
          .in("conexao_id", ids)
      : Promise.resolve({
          data: [] as Array<{
            conexao_id: string;
            api_token: string | null;
            alice_bot_token: string | null;
          }>,
        }),
  ]);
  return (caixas ?? []).map((c) => {
    const cx = (conexoes ?? []).find((x) => x.id === c.conexao_id);
    const sg = (segredos ?? []).find((x) => x.conexao_id === c.conexao_id);
    return {
      caixa: Number(c.inbox_id),
      conta: cx ? { baseUrl: cx.base_url, accountId: Number(cx.account_id) } : null,
      roboId: cx?.alice_bot_id ?? null,
      tokenAdmin: sg?.api_token ?? null,
      tokenRobo: sg?.alice_bot_token ?? null,
    };
  });
}

export const situacaoAlice = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<SituacaoAlice> => {
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: cfg }, { data: execs }, caixas] = await Promise.all([
      context.supabase
        .from("ia_configuracoes")
        .select("*")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      context.supabase
        .from("ia_execucoes")
        .select("custo_usd, erro, ferramentas")
        .eq("empresa_id", context.empresaId)
        .gte("created_at", desde),
      caixasDaEmpresa(context.empresaId),
    ]);
    const lista = (execs ?? []) as Array<{
      custo_usd: number;
      erro: string | null;
      ferramentas: unknown;
    }>;
    return {
      config: cfg
        ? {
            ativo: cfg.ativo,
            nome: cfg.nome,
            instrucoes: cfg.instrucoes,
            perguntas_frequentes: cfg.perguntas_frequentes,
            desconto_max_percentual: Number(cfg.desconto_max_percentual),
            modelo: cfg.modelo,
            esforco: cfg.esforco as ConfigAlice["esforco"],
            espera_segundos: cfg.espera_segundos,
            limite_respostas_conversa: cfg.limite_respostas_conversa,
          }
        : PADRAO,
      iaNoServidor: Boolean(process.env["ANTHROPIC_API_KEY"]),
      roboNoChatwoot: caixas.some((c) => c.roboId && c.tokenRobo),
      caixas: caixas.length,
      ultimos7dias: {
        respostas: lista.filter((e) => !e.erro).length,
        custoUsd: Math.round(lista.reduce((s, e) => s + Number(e.custo_usd ?? 0), 0) * 100) / 100,
        passagens: lista.filter(
          (e) =>
            Array.isArray(e.ferramentas) &&
            (e.ferramentas as Array<{ nome?: string }>).some(
              (f) => f.nome === "passar_para_atendente",
            ),
        ).length,
        erros: lista.filter((e) => e.erro).length,
      },
    };
  });

export const salvarAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: Omit<ConfigAlice, "ativo">) => {
    if (!MODELOS_ALICE.some((m) => m.id === input.modelo)) throw new Error("Modelo inválido.");
    if (!["low", "medium", "high"].includes(input.esforco)) throw new Error("Esforço inválido.");
    if (!input.nome?.trim() || input.nome.trim().length > 40)
      throw new Error("Informe o nome (até 40 letras).");
    if (input.instrucoes.length > 20000 || input.perguntas_frequentes.length > 20000)
      throw new Error("Texto muito longo (máximo 20 mil caracteres).");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ia_configuracoes").upsert(
      {
        empresa_id: context.empresaId,
        nome: data.nome.trim(),
        instrucoes: data.instrucoes,
        perguntas_frequentes: data.perguntas_frequentes,
        desconto_max_percentual: Math.min(
          Math.max(Number(data.desconto_max_percentual) || 0, 0),
          100,
        ),
        modelo: data.modelo,
        esforco: data.esforco,
        espera_segundos: Math.min(Math.max(Math.round(Number(data.espera_segundos) || 0), 0), 120),
        limite_respostas_conversa: Math.min(
          Math.max(Math.round(Number(data.limite_respostas_conversa) || 40), 1),
          500,
        ),
      },
      { onConflict: "empresa_id" },
    );
    if (error) throw new Error("Não foi possível salvar a configuração da Alice.");
    return { ok: true };
  });

/** Liga/desliga a Alice: coloca (ou tira) o robô nas caixas de entrada da empresa no Chatwoot. */
export const ligarAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { ativo: boolean }) => ({ ativo: Boolean(input.ativo) }))
  .handler(async ({ data, context }) => {
    const { ligarRoboNaCaixa, mudarSituacao } = await import("@/lib/alice/chatwoot-api.server");
    const db = await admin();
    const caixas = await caixasDaEmpresa(context.empresaId);
    if (data.ativo) {
      if (!process.env["ANTHROPIC_API_KEY"])
        throw new Error("A chave da IA ainda não foi configurada no servidor.");
      if (!caixas.length) throw new Error("A empresa não tem caixa de entrada do Chatwoot ligada.");
      if (caixas.some((c) => !c.conta || !c.roboId || !c.tokenAdmin || !c.tokenRobo))
        throw new Error("A Nexa ainda não criou o robô da Alice no Chatwoot (Nexa → Chatwoot).");
    }
    for (const c of caixas) {
      if (c.conta && c.tokenAdmin && (c.roboId || !data.ativo)) {
        await ligarRoboNaCaixa(c.conta, c.tokenAdmin, c.caixa, data.ativo ? c.roboId : null);
      }
    }
    if (data.ativo) {
      const { data: cfg } = await context.supabase
        .from("ia_configuracoes")
        .select("nome")
        .eq("empresa_id", context.empresaId)
        .maybeSingle();
      const { data: existe } = await db
        .from("salespeople")
        .select("id")
        .eq("empresa_id", context.empresaId)
        .eq("eh_ia", true)
        .maybeSingle();
      if (!existe) {
        await db.from("salespeople").insert({
          empresa_id: context.empresaId,
          name: `${cfg?.nome ?? "Alice"} (IA)`,
          commission_percentage: 0,
          active: true,
          atendente_nexa: true,
          eh_ia: true,
        } as never);
      }
    } else {
      // Conversas que estavam com o robô voltam para a fila da equipe.
      const { data: pendentes } = await db
        .from("conversas")
        .select("id, chatwoot_conversation_id, conexao_id")
        .eq("empresa_id", context.empresaId)
        .eq("status", "pending");
      for (const p of pendentes ?? []) {
        const c = caixas.find((x) => x.conta && x.tokenAdmin);
        if (!c?.conta || !c.tokenAdmin) break;
        await mudarSituacao(
          c.conta,
          c.tokenAdmin,
          Number(p.chatwoot_conversation_id),
          "open",
        ).catch(() => undefined);
        await db.from("conversas").update({ status: "open" }).eq("id", p.id);
      }
    }
    const { error } = await context.supabase
      .from("ia_configuracoes")
      .upsert({ empresa_id: context.empresaId, ativo: data.ativo }, { onConflict: "empresa_id" });
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

/** Nexa: cria o robô "Alice" na conta do Chatwoot (uma vez por conexão). */
export const criarRoboAlice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conexaoId: string; origem: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(input.conexaoId)) throw new Error("Conexão inválida.");
    if (!/^https?:\/\/[^/]+$/.test(input.origem)) throw new Error("Endereço do app inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: souNexa } = await context.supabase.rpc("sou_admin_nexa");
    if (souNexa !== true) throw new Error("Apenas administradores da Nexa.");
    const { criarRobo } = await import("@/lib/alice/chatwoot-api.server");
    const db = await admin();
    const [{ data: conexao }, { data: segredo }] = await Promise.all([
      db
        .from("chatwoot_conexoes")
        .select("base_url, account_id, webhook_token, alice_bot_id")
        .eq("id", data.conexaoId)
        .single(),
      db
        .from("chatwoot_conexao_segredos")
        .select("api_token, alice_bot_token")
        .eq("conexao_id", data.conexaoId)
        .maybeSingle(),
    ]);
    if (!conexao) throw new Error("Conexão não encontrada.");
    if (conexao.alice_bot_id && segredo?.alice_bot_token)
      return { ok: true, roboId: conexao.alice_bot_id };
    if (!segredo?.api_token)
      throw new Error("Cadastre antes o token de API do Chatwoot nesta conexão.");
    const robo = await criarRobo(
      { baseUrl: conexao.base_url, accountId: Number(conexao.account_id) },
      segredo.api_token,
      "Alice",
      `${data.origem}/api/public/hooks/alice-robo/${conexao.webhook_token}`,
    );
    if (!robo.id || !robo.access_token) throw new Error("O Chatwoot não devolveu o token do robô.");
    await db.from("chatwoot_conexoes").update({ alice_bot_id: robo.id }).eq("id", data.conexaoId);
    await db
      .from("chatwoot_conexao_segredos")
      .update({ alice_bot_token: robo.access_token })
      .eq("conexao_id", data.conexaoId);
    return { ok: true, roboId: robo.id };
  });
