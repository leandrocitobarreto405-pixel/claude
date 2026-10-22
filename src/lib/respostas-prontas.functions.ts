/**
 * Respostas prontas por empresa, guardadas em app_settings ("respostas_prontas"). Na primeira
 * leitura (nada salvo ainda), importa as respostas prontas do Chatwoot da empresa. Ler: admin e
 * atendente. Criar, editar, apagar e importar de novo: admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import {
  daChatwoot,
  limparAtalho,
  validarRespostas,
  type RespostaPronta,
} from "@/lib/respostas-prontas";

const CHAVE = "respostas_prontas";

type Guardado = { itens: RespostaPronta[]; importado_chatwoot_em: string | null };

/** Respostas prontas do Chatwoot da empresa (a conexão das conversas dela). */
async function doChatwoot(empresaId: string): Promise<RespostaPronta[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conv } = await supabaseAdmin
    .from("conversas")
    .select("conexao_id")
    .eq("empresa_id", empresaId)
    .limit(1)
    .maybeSingle();
  if (!conv) return [];
  const [{ data: cx }, { data: sg }] = await Promise.all([
    supabaseAdmin
      .from("chatwoot_conexoes")
      .select("base_url, account_id, ativo")
      .eq("id", conv.conexao_id)
      .maybeSingle(),
    supabaseAdmin
      .from("chatwoot_conexao_segredos")
      .select("api_token")
      .eq("conexao_id", conv.conexao_id)
      .maybeSingle(),
  ]);
  if (!cx?.ativo || !sg?.api_token) return [];
  const { chamar } = await import("@/lib/alice/chatwoot-api.server");
  const lista = await chamar<Array<{ id: number; short_code?: string; content?: string }>>(
    { baseUrl: cx.base_url, accountId: Number(cx.account_id) },
    sg.api_token,
    "/canned_responses",
  );
  const vistos = new Set<string>();
  const itens: RespostaPronta[] = [];
  for (const r of Array.isArray(lista) ? lista : []) {
    const atalho = limparAtalho(r.short_code ?? "");
    const texto = daChatwoot(r.content ?? "").trim();
    if (!atalho || !texto || vistos.has(atalho)) continue;
    vistos.add(atalho);
    itens.push({ id: `cw-${r.id}`, atalho, texto: texto.slice(0, 4096) });
  }
  return itens;
}

async function lerGuardado(empresaId: string): Promise<Guardado | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("empresa_id", empresaId)
    .eq("key", CHAVE)
    .maybeSingle();
  if (!data?.value || typeof data.value !== "object") return null;
  const v = data.value as Partial<Guardado>;
  return {
    itens: Array.isArray(v.itens) ? v.itens : [],
    importado_chatwoot_em: v.importado_chatwoot_em ?? null,
  };
}

async function gravar(empresaId: string, g: Guardado) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_settings").upsert(
    {
      empresa_id: empresaId,
      key: CHAVE,
      value: g as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "empresa_id,key" },
  );
  if (error) throw new Error("Não foi possível salvar as respostas prontas.");
}

export const listarRespostasFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(
    async ({ context }): Promise<{ itens: RespostaPronta[]; importadoEm: string | null }> => {
      const { data: papel } = await context.supabase.rpc("meu_papel" as never);
      if (papel !== "admin" && papel !== "atendente") return { itens: [], importadoEm: null };
      let g = await lerGuardado(context.empresaId);
      if (!g) {
        // Primeira vez: traz as respostas prontas que a empresa já tinha no Chatwoot.
        const itens = await doChatwoot(context.empresaId).catch((e) => {
          console.warn(
            "Respostas prontas: Chatwoot não respondeu",
            e instanceof Error ? e.message : e,
          );
          return null;
        });
        if (itens === null) return { itens: [], importadoEm: null };
        g = { itens, importado_chatwoot_em: new Date().toISOString() };
        await gravar(context.empresaId, g);
      }
      return {
        itens: [...g.itens].sort((a, b) => a.atalho.localeCompare(b.atalho)),
        importadoEm: g.importado_chatwoot_em,
      };
    },
  );

export const salvarRespostasFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { itens: RespostaPronta[] }) => ({
    itens: validarRespostas(Array.isArray(i?.itens) ? i.itens : []),
  }))
  .handler(async ({ data, context }) => {
    const atual = await lerGuardado(context.empresaId);
    await gravar(context.empresaId, {
      itens: data.itens,
      importado_chatwoot_em: atual?.importado_chatwoot_em ?? null,
    });
    return { ok: true, total: data.itens.length };
  });

/** Importa de novo do Chatwoot só as que faltam (atalho que ainda não existe aqui). */
export const importarRespostasChatwootFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }) => {
    const atual = (await lerGuardado(context.empresaId)) ?? {
      itens: [],
      importado_chatwoot_em: null,
    };
    const doCw = await doChatwoot(context.empresaId);
    const existentes = new Set(atual.itens.map((r) => r.atalho));
    const novas = doCw.filter((r) => !existentes.has(r.atalho));
    await gravar(context.empresaId, {
      itens: [...atual.itens, ...novas],
      importado_chatwoot_em: new Date().toISOString(),
    });
    return { ok: true, novas: novas.length, noChatwoot: doCw.length };
  });
