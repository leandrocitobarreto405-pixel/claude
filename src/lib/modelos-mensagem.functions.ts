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
    const { dbServico, contextoEmpresa } = await import("@/lib/mkt/contexto.server");
    const { listarParaTela } = await import("@/lib/meta/modelos.server");
    const db = await dbServico();
    // Ao abrir a tela, pede ao Chatwoot para buscar os modelos na Meta (a lista dele atrasa).
    try {
      const ctx = await contextoEmpresa(db, context.empresaId);
      if (ctx.tokenAdmin) {
        const { sincronizarModelos } = await import("@/lib/mkt/chatwoot.server");
        await sincronizarModelos(ctx.conta, ctx.tokenAdmin, ctx.caixa);
      }
    } catch {
      // Sem Chatwoot configurado: a tela mostra o que der.
    }
    return listarParaTela(db, context.empresaId);
  });

export type SituacaoModelosTela = {
  sincronizou: boolean;
  conferiuMeta: boolean;
  divergentes: Array<{ nome: string; chatwoot: string | null; meta: string }>;
  erroMeta: string | null;
};

/** Botão "Atualizar situação dos modelos": Chatwoot busca de novo; o que divergir, vale a Meta. */
export const atualizarSituacaoModelosFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<SituacaoModelosTela> => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { modelosAtualizados } = await import("@/lib/mkt/modelos-situacao.server");
    let r;
    try {
      r = await modelosAtualizados(await dbServico(), context.empresaId, { sincronizar: true });
    } catch (e) {
      throw new Error(
        `Não foi possível atualizar: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      );
    }
    return {
      sincronizou: r.sincronizou,
      conferiuMeta: r.conferiuMeta,
      divergentes: r.divergentes.map((d) => ({ nome: d.nome, chatwoot: d.chatwoot, meta: d.meta })),
      erroMeta: r.erroMeta,
    };
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

/** Guarda o texto para revisar depois. Não envia nada para a Meta. */
export const salvarRascunhoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { form: FormModelo }) => ({ form: limparFormulario(i.form) }))
  .handler(async ({ data, context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { salvarRascunho } = await import("@/lib/meta/modelos.server");
    await salvarRascunho(await dbServico(), context.empresaId, context.userId, data.form, null);
    return { ok: true };
  });

/** Descarta o texto novo (o modelo na Meta continua como está). */
export const descartarRascunhoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { nome: string; idioma: string }) => {
    const nome = String(i.nome ?? "").trim();
    const idioma = String(i.idioma ?? "").trim();
    if (!/^[a-z0-9_]{1,512}$/.test(nome) || !/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma))
      throw new Error("Modelo inválido.");
    return { nome, idioma };
  })
  .handler(async ({ data, context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { descartarRascunho } = await import("@/lib/meta/modelos.server");
    await descartarRascunho(await dbServico(), context.empresaId, data.nome, data.idioma);
    return { ok: true };
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

// ---------------------------------------------------------------- modelo de cada finalidade
export type FinalidadesEmpresa = {
  /** Nome do modelo de cada finalidade (padrão preenchido). */
  modelos: Record<string, string>;
  promocao: string;
  /** Dias de disparo das campanhas (1 = segunda ... 7 = domingo). */
  dias: number[];
};

export const finalidadesFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<FinalidadesEmpresa> => {
    const { modelosDaEmpresa } = await import("@/lib/modelos-mensagem");
    const [{ data: mkt }, { data: agenda }] = await Promise.all([
      context.supabase
        .from("mkt_configuracoes")
        .select("modelos, dias_disparo")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      context.supabase
        .from("agenda_configuracoes")
        .select("promo_template_nome")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
    ]);
    return {
      modelos: modelosDaEmpresa(mkt?.modelos),
      promocao: agenda?.promo_template_nome ?? "promocao_agenda",
      dias: mkt?.dias_disparo ?? [2, 3, 4],
    };
  });

export const salvarFinalidadesFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: FinalidadesEmpresa) => {
    const nome = (v: unknown, rotulo: string) => {
      const n = String(v ?? "").trim();
      if (!/^[a-z0-9_]{1,512}$/.test(n))
        throw new Error(`${rotulo}: só letras minúsculas sem acento, números e _.`);
      return n;
    };
    const modelos: Record<string, string> = {};
    for (const [k, v] of Object.entries(i.modelos ?? {}))
      if (/^[a-z0-9_]{1,40}$/.test(k)) modelos[k] = nome(v, "Nome do modelo");
    const dias = [...new Set((i.dias ?? []).map(Number))]
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      .sort();
    if (!dias.length) throw new Error("Escolha pelo menos um dia de disparo.");
    return { modelos, promocao: nome(i.promocao, "Modelo da promoção"), dias };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { error: e1 } = await db
      .from("mkt_configuracoes")
      .upsert(
        { empresa_id: context.empresaId, modelos: data.modelos, dias_disparo: data.dias },
        { onConflict: "empresa_id" },
      );
    if (e1) throw new Error(`Não foi possível salvar: ${e1.message}`);
    const { error: e2 } = await db
      .from("agenda_configuracoes")
      .upsert(
        { empresa_id: context.empresaId, promo_template_nome: data.promocao },
        { onConflict: "empresa_id" },
      );
    if (e2) throw new Error(`Não foi possível salvar o modelo da promoção: ${e2.message}`);
    return { ok: true };
  });
