/**
 * Cupons da empresa: ler (todos da empresa, para a tela e para o orçamento manual) e salvar
 * (admin). Grava com o acesso de quem está logado: a regra da empresa (RLS) e a trava de
 * somente leitura do banco valem aqui também.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import { validarCupom, type CupomTela } from "@/lib/cupons";
import type { Servico } from "@/lib/alice/orcamento-alice";
import { requireRecurso } from "@/lib/recurso.middleware";

/** cupons: recurso do plano (Essencial não tem). */
const comRecurso = requireRecurso("cupons");

export type CuponsDaEmpresa = {
  cupons: CupomTela[];
  origens: { id: string; nome: string }[];
};

export const listarCuponsFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa, comRecurso])
  .handler(async ({ context }): Promise<CuponsDaEmpresa> => {
    const [{ data: cupons, error }, { data: origens }] = await Promise.all([
      context.supabase
        .from("cupons")
        .select("id, codigo, valor, percentual, servico, origem_id, valido_ate, ativo")
        .eq("empresa_id", context.empresaId)
        .order("ativo", { ascending: false })
        .order("codigo"),
      context.supabase
        .from("config_options")
        .select("id, name")
        .eq("empresa_id", context.empresaId)
        .eq("kind", "sales_origin")
        .order("display_order"),
    ]);
    if (error) throw new Error("Não foi possível carregar os cupons.");
    return {
      cupons: (cupons ?? []).map((c) => ({
        id: c.id,
        codigo: c.codigo,
        tipo: c.percentual !== null ? "percentual" : "valor",
        quantia: Number(c.percentual ?? c.valor ?? 0),
        servico: c.servico as Servico,
        origemId: c.origem_id,
        validoAte: c.valido_ate,
        ativo: c.ativo,
      })),
      origens: (origens ?? []).map((o) => ({ id: o.id, nome: o.name })),
    };
  });

export const salvarCupomFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comRecurso])
  .inputValidator((c: CupomTela) => ({ id: c?.id ?? null, linha: validarCupom(c) }))
  .handler(async ({ data, context }) => {
    const linha = { ...data.linha, updated_at: new Date().toISOString() };
    const { error } = data.id
      ? await context.supabase
          .from("cupons")
          .update(linha)
          .eq("id", data.id)
          .eq("empresa_id", context.empresaId)
      : await context.supabase.from("cupons").insert({ ...linha, empresa_id: context.empresaId });
    if (error) {
      if (error.code === "23505") throw new Error(`Já existe um cupom ${linha.codigo}.`);
      if (error.code === "22023") throw new Error("Origem do cupom inválida.");
      throw new Error("Não foi possível salvar o cupom.");
    }
    return { ok: true };
  });
