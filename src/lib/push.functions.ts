/**
 * Notificações no celular: ativar neste celular, escolher o que receber e enviar um teste. Cada
 * pessoa só mexe nas próprias inscrições e preferências; o papel decide o que pode receber.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import {
  MINUTOS_ESPERA,
  PREFERENCIAS_PADRAO,
  tiposDoPapel,
  type PreferenciasPush,
  type TipoPush,
} from "@/lib/push/notificacoes";
import type { Papel } from "@/lib/tenant";

const PAPEIS: Papel[] = ["admin", "atendente", "tecnico"];

async function papelDe(db: { rpc: (n: never) => PromiseLike<{ data: unknown }> }) {
  const { data } = await db.rpc("meu_papel" as never);
  return PAPEIS.includes(data as Papel) ? (data as Papel) : null;
}

export type SituacaoPush = {
  chavePublica: string;
  papel: Papel | null;
  tipos: TipoPush[];
  preferencias: PreferenciasPush;
  /** Endereços dos celulares desta pessoa (para saber se este celular já está ativo). */
  celulares: Array<{ endpoint: string; aparelho: string | null; ultimoEnvio: string | null }>;
};

export const situacaoPushFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<SituacaoPush> => {
    const db = context.supabase;
    const [papel, { data: pref }, { data: celulares }] = await Promise.all([
      papelDe(db as never),
      db
        .from("push_preferencias")
        .select("*")
        .eq("empresa_id", context.empresaId)
        .eq("user_id", context.userId)
        .maybeSingle(),
      db
        .from("push_inscricoes")
        .select("endpoint, aparelho, ultimo_envio_em")
        .eq("empresa_id", context.empresaId)
        .eq("user_id", context.userId),
    ]);
    const { chavesDoServidor } = await import("@/lib/push/webpush.server");
    return {
      chavePublica: chavesDoServidor().publica,
      papel,
      tipos: tiposDoPapel(papel),
      preferencias: pref
        ? {
            cliente_esperando: pref.cliente_esperando,
            espera_minutos: pref.espera_minutos,
            servico_concluido: pref.servico_concluido,
            campanha_aprovacao: pref.campanha_aprovacao,
            agendamento_promocao: pref.agendamento_promocao,
            resumo_dia: pref.resumo_dia,
          }
        : PREFERENCIAS_PADRAO,
      celulares: (celulares ?? []).map((c) => ({
        endpoint: c.endpoint,
        aparelho: c.aparelho,
        ultimoEnvio: c.ultimo_envio_em,
      })),
    };
  });

export const inscreverPushFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { endpoint: string; p256dh: string; auth: string; aparelho?: string }) => ({
    endpoint: String(i.endpoint ?? "").slice(0, 1000),
    p256dh: String(i.p256dh ?? ""),
    auth: String(i.auth ?? ""),
    aparelho: String(i.aparelho ?? "").slice(0, 200) || null,
  }))
  .handler(async ({ data, context }) => {
    const { endpointPermitido } = await import("@/lib/push/webpush.server");
    if (!endpointPermitido(data.endpoint))
      throw new Error("Este navegador não oferece notificações compatíveis.");
    if (!/^[\w-]{80,100}$/.test(data.p256dh) || !/^[\w-]{16,40}$/.test(data.auth))
      throw new Error("Inscrição inválida. Tente ativar de novo.");
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    // O mesmo celular passa a ser desta pessoa nesta empresa (troca de login no aparelho).
    const { error } = await db.from("push_inscricoes").upsert(
      {
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        aparelho: data.aparelho,
        empresa_id: context.empresaId,
        user_id: context.userId,
        falhas: 0,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error("Não foi possível ativar as notificações.");
    return { ok: true };
  });

export const removerPushFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { endpoint: string }) => ({ endpoint: String(i.endpoint ?? "") }))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("push_inscricoes")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const salvarPreferenciasPushFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((p: PreferenciasPush) => ({
    cliente_esperando: Boolean(p.cliente_esperando),
    espera_minutos: MINUTOS_ESPERA.includes(Number(p.espera_minutos))
      ? Number(p.espera_minutos)
      : PREFERENCIAS_PADRAO.espera_minutos,
    servico_concluido: Boolean(p.servico_concluido),
    campanha_aprovacao: Boolean(p.campanha_aprovacao),
    agendamento_promocao: Boolean(p.agendamento_promocao),
    resumo_dia: Boolean(p.resumo_dia),
  }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("push_preferencias").upsert({
      ...data,
      empresa_id: context.empresaId,
      user_id: context.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Não foi possível salvar as preferências.");
    return { ok: true };
  });

export const testarPushFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .handler(async ({ context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const { data: celulares } = await db
      .from("push_inscricoes")
      .select("id, endpoint, p256dh, auth")
      .eq("empresa_id", context.empresaId)
      .eq("user_id", context.userId);
    if (!celulares?.length) return { enviados: 0, falhas: 0, semCelular: true };
    const { enviarParaPessoa } = await import("@/lib/push/notificacoes.server");
    const r = await enviarParaPessoa(db, celulares, {
      titulo: "Teste da Nexa",
      corpo: "Notificações funcionando neste celular. Toque para abrir os Avisos.",
      url: "/avisos",
    });
    await db.from("push_envios").insert({
      empresa_id: context.empresaId,
      user_id: context.userId,
      tipo: "teste",
      ref: new Date().toISOString(),
      titulo: "Teste da Nexa",
      enviados: r.enviados,
    });
    return { ...r, semCelular: false };
  });
