import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

export type SituacaoGoogle = {
  /** O servidor tem o cliente OAuth da Nexa configurado. */
  disponivel: boolean;
  conectado: boolean;
  email: string | null;
  situacao: "conectada" | "erro" | null;
  erro: string | null;
  conectadoEm: string | null;
  permissoesFaltando: string[];
};

const NOMES_ESCOPOS: Record<string, string> = {
  "https://www.googleapis.com/auth/drive": "Google Drive",
  "https://www.googleapis.com/auth/calendar.events": "Google Agenda",
};

export const situacaoGoogle = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<SituacaoGoogle> => {
    const { credenciaisGoogle, ESCOPOS_OBRIGATORIOS } = await import("@/lib/google-auth.server");
    const { data } = await context.supabase
      .from("google_conexoes")
      .select("email, escopos, situacao, erro, conectado_em")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    const escopos = data?.escopos ?? [];
    return {
      disponivel: credenciaisGoogle() !== null,
      conectado: Boolean(data),
      email: data?.email ?? null,
      situacao: (data?.situacao as SituacaoGoogle["situacao"]) ?? null,
      erro: data?.erro ?? null,
      conectadoEm: data?.conectado_em ?? null,
      permissoesFaltando: data
        ? ESCOPOS_OBRIGATORIOS.filter((e) => !escopos.includes(e)).map((e) => NOMES_ESCOPOS[e] ?? e)
        : [],
    };
  });

/** Endereço da tela de autorização do Google para a empresa ativa. */
export const iniciarConexaoGoogle = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { origem: string }) => {
    if (typeof input?.origem !== "string" || input.origem.length > 200) {
      throw new Error("Endereço do app inválido.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { urlAutorizacao } = await import("@/lib/google-auth.server");
    return {
      url: urlAutorizacao({
        empresaId: context.empresaId,
        userId: context.userId,
        origem: data.origem,
      }),
    };
  });

export const desconectarGoogle = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }) => {
    const { revogarToken, esquecerTokenGoogle } = await import("@/lib/google-auth.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("google_conexao_segredos")
      .select("refresh_token")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (data?.refresh_token) await revogarToken(data.refresh_token);
    const { error } = await supabaseAdmin
      .from("google_conexoes")
      .delete()
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível desconectar a conta Google.");
    esquecerTokenGoogle(context.empresaId);
    return { ok: true };
  });

/** Testa se a conta Google da empresa cria, grava e lê planilhas no Drive (e apaga o teste). */
export const testarPlanilhasGoogle = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }) => {
    const { testarPlanilhas } = await import("@/lib/google-planilhas.server");
    return testarPlanilhas(context.empresaId);
  });
