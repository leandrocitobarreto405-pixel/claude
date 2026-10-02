/**
 * Tela "Modelos de mensagem" (só admin): conexão com a Meta, modelos (com aprovação) e textos que
 * o Nexa envia sem aprovação. O token da Meta entra por aqui uma vez e nunca volta para a tela.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa } from "@/lib/empresa.middleware";
import {
  CHAVES_TEXTOS,
  FORM_VAZIO,
  defDoTexto,
  validarTexto,
  type BotaoForm,
  type CategoriaModelo,
  type FormModelo,
} from "@/lib/modelos-mensagem";
import type { ListaModelos, ResultadoEnvio } from "@/lib/meta/modelos.server";

export type ConexaoMetaTela = {
  configurada: boolean;
  waba: string | null;
  nome: string | null;
  em: string | null;
};

export const conexaoMetaFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<ConexaoMetaTela> => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const [{ data: cx }, { count }] = await Promise.all([
      db
        .from("meta_conexoes")
        .select("waba_id, waba_nome, configurada_em")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      db
        .from("meta_conexao_segredos")
        .select("empresa_id", { count: "exact", head: true })
        .eq("empresa_id", context.empresaId),
    ]);
    return {
      configurada: Boolean(cx && count),
      waba: cx?.waba_id ?? null,
      nome: cx?.waba_nome ?? null,
      em: cx?.configurada_em ?? null,
    };
  });

export const salvarConexaoMetaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { waba: string; token: string }) => {
    const waba = String(i.waba ?? "").replace(/\D/g, "");
    const token = String(i.token ?? "").trim();
    // As mensagens daqui nunca repetem o que foi digitado no token.
    if (waba.length < 5 || waba.length > 25)
      throw new Error("Informe o ID da conta do WhatsApp Business (só números).");
    if (token.length < 20 || token.length > 1000 || /\s/.test(token))
      throw new Error("O token parece incompleto. Copie de novo na Meta e cole aqui.");
    return { waba, token };
  })
  .handler(async ({ data, context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { salvarConexao } = await import("@/lib/meta/modelos.server");
    const r = await salvarConexao(
      await dbServico(),
      context.empresaId,
      context.userId,
      data.waba,
      data.token,
    );
    return { ok: true, nome: r.nome };
  });

export const listarModelosFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<ListaModelos> => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { listarParaTela } = await import("@/lib/meta/modelos.server");
    return listarParaTela(await dbServico(), context.empresaId);
  });

const texto = (v: unknown, max: number) => String(v ?? "").slice(0, max);

function limparFormulario(f: Partial<FormModelo> | undefined): FormModelo {
  const cat = String(f?.categoria ?? "MARKETING").toUpperCase();
  return {
    ...FORM_VAZIO,
    nome: texto(f?.nome, 512).trim(),
    idioma: texto(f?.idioma || "pt_BR", 10).trim(),
    categoria: (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(cat)
      ? cat
      : "MARKETING") as CategoriaModelo,
    cabecalho: texto(f?.cabecalho, 200),
    corpo: texto(f?.corpo, 2000),
    exemplos: (f?.exemplos ?? []).slice(0, 20).map((e) => texto(e, 200)),
    rodape: texto(f?.rodape, 200),
    botoes: (f?.botoes ?? []).slice(0, 12).map((b): BotaoForm => {
      if (b.tipo === "URL")
        return { tipo: "URL", texto: texto(b.texto, 60), url: texto(b.url, 2000) };
      if (b.tipo === "PHONE_NUMBER")
        return { tipo: "PHONE_NUMBER", texto: texto(b.texto, 60), telefone: texto(b.telefone, 30) };
      return { tipo: "QUICK_REPLY", texto: texto(b.texto, 60) };
    }),
  };
}

export const enviarModeloFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { id?: string | null; form: FormModelo }) => ({
    id: i.id && /^\d+$/.test(i.id) ? i.id : null,
    form: limparFormulario(i.form),
  }))
  .handler(async ({ data, context }): Promise<ResultadoEnvio> => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { enviarParaAprovacao } = await import("@/lib/meta/modelos.server");
    return enviarParaAprovacao(await dbServico(), context.empresaId, context.userId, data);
  });

// ---------------------------------------------------------------- textos sem aprovação
export const textosDaEmpresaFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<Record<string, { texto: string; em: string }>> => {
    const { data } = await context.supabase
      .from("mensagens_textos")
      .select("chave, texto, updated_at")
      .eq("empresa_id", context.empresaId);
    return Object.fromEntries(
      (data ?? []).map((t) => [t.chave, { texto: t.texto, em: t.updated_at }]),
    );
  });

/** texto vazio ou null: volta ao padrão. */
export const salvarTextoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { chave: string; texto: string | null }) => {
    if (!CHAVES_TEXTOS.includes(i.chave)) throw new Error("Texto desconhecido.");
    const t = (i.texto ?? "").trim();
    if (t) {
      const p = validarTexto(defDoTexto(i.chave)!, t);
      if (p.length) throw new Error(p.join(" "));
    }
    return { chave: i.chave, texto: t || null };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { error } = data.texto
      ? await db.from("mensagens_textos").upsert({
          empresa_id: context.empresaId,
          chave: data.chave,
          texto: data.texto,
          updated_at: new Date().toISOString(),
        })
      : await db
          .from("mensagens_textos")
          .delete()
          .eq("empresa_id", context.empresaId)
          .eq("chave", data.chave);
    if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    return { ok: true };
  });
