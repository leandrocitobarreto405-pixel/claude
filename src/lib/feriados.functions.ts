// Feriados por empresa (02/11/2026): tela de Configurações › Agenda › Feriados e os botões
// "Vamos trabalhar / Não vamos" em Tatiana › Hoje. Quem é da empresa lê; só o admin decide,
// adiciona ou remove (gravação pelo servidor).
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import type { Feriado } from "@/lib/feriados";

type Db = SupabaseClient;

const hojeSP = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

const uuid = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error("Feriado inválido.");
  return s;
};

export type FeriadosTela = { ano: number; feriados: Feriado[]; admin: boolean };

export const feriadosFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((d: { ano?: number }) => {
    const ano = Number(d?.ano ?? new Date().getFullYear());
    if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) throw new Error("Ano inválido.");
    return { ano };
  })
  .handler(async ({ context, data }): Promise<FeriadosTela> => {
    const db = context.supabase as unknown as Db;
    const { data: papel } = await db.rpc("meu_papel");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { feriadosDoAno } = await import("@/lib/feriados.server");
    const feriados = await feriadosDoAno(
      supabaseAdmin as unknown as Db,
      context.empresaId as string,
      data.ano,
    );
    return { ano: data.ano, feriados, admin: papel === "admin" };
  });

export const decidirFeriadoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: { id: string; trabalhamos: boolean }) => ({
    id: uuid(d.id),
    trabalhamos: Boolean(d.trabalhamos),
  }))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decidirFeriado } = await import("@/lib/feriados.server");
    return decidirFeriado(supabaseAdmin as unknown as Db, {
      empresaId: context.empresaId as string,
      id: data.id,
      trabalhamos: data.trabalhamos,
      userId: (context.userId as string) ?? null,
      hoje: hojeSP(),
    });
  });

export const adicionarFeriadoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: { data: string; nome: string }) => {
    const data = String(d.data ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T12:00:00Z`)))
      throw new Error("Data inválida.");
    const nome = String(d.nome ?? "")
      .trim()
      .slice(0, 80);
    if (nome.length < 2) throw new Error("Dê um nome ao feriado.");
    return { data, nome };
  })
  .handler(async ({ context, data }): Promise<Feriado> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { adicionarFeriado } = await import("@/lib/feriados.server");
    return adicionarFeriado(supabaseAdmin as unknown as Db, {
      empresaId: context.empresaId as string,
      data: data.data,
      nome: data.nome,
      userId: (context.userId as string) ?? null,
    });
  });

export const removerFeriadoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((d: { id: string }) => ({ id: uuid(d.id) }))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { removerFeriado } = await import("@/lib/feriados.server");
    await removerFeriado(supabaseAdmin as unknown as Db, context.empresaId as string, data.id);
    return { ok: true };
  });
