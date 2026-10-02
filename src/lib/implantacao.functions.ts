/**
 * Configuração da empresa (checklist de implantação).
 * - O admin da empresa vê a lista dela, marca "Revisei" / "Não se aplica" e completa os dados.
 * - A Nexa vê o progresso de todas e libera (ou bloqueia de novo) cada empresa.
 * - Qualquer pessoa da empresa pode saber se ela já foi liberada (para as chaves da Alice e dos envios).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import {
  avaliarEtapas,
  marcacaoPermitida,
  resumoEtapas,
  type Etapa,
  type Marcacao,
  type Resumo,
} from "@/lib/implantacao";

export type Implantacao = {
  empresaId: string;
  nome: string;
  liberadaEm: string | null;
  etapas: Etapa[];
  resumo: Resumo;
};

async function montar(empresaId: string, conferirModelos = true): Promise<Implantacao> {
  const { dbServico } = await import("@/lib/mkt/contexto.server");
  const { fatosDaEmpresa } = await import("@/lib/implantacao.server");
  const { fatos, liberadaEm, nome } = await fatosDaEmpresa(await dbServico(), empresaId, {
    conferirModelos,
  });
  const etapas = avaliarEtapas(fatos);
  return { empresaId, nome, liberadaEm, etapas, resumo: resumoEtapas(etapas) };
}

/** A lista da empresa ativa (admin da empresa ou Nexa). */
export const minhaImplantacaoFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }) => montar(context.empresaId));

/** Liberada ou não (qualquer pessoa da empresa). */
export const liberacaoFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<{ liberada: boolean }> => {
    const { data } = await context.supabase
      .from("empresas")
      .select("implantacao_liberada_em")
      .eq("id", context.empresaId)
      .maybeSingle();
    return { liberada: Boolean(data?.implantacao_liberada_em) };
  });

export const marcarEtapaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { etapa: string; situacao: Marcacao | "pendente" }) => {
    const situacao = i.situacao;
    if (!["revisado", "nao_se_aplica", "pendente"].includes(situacao))
      throw new Error("Marcação inválida.");
    if (!marcacaoPermitida(String(i.etapa), situacao))
      throw new Error("Esta etapa não aceita essa marcação.");
    return { etapa: String(i.etapa), situacao };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("implantacao_etapas").upsert(
      {
        empresa_id: context.empresaId,
        etapa: data.etapa,
        situacao: data.situacao,
        marcado_por: context.userId,
        marcado_em: new Date().toISOString(),
      },
      { onConflict: "empresa_id,etapa" },
    );
    if (error) throw new Error(`Não foi possível marcar: ${error.message}`);
    return { ok: true };
  });

/** Dados básicos da empresa (CNPJ e telefone; o nome só a Nexa muda). */
export const salvarDadosEmpresaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { cnpj: string; telefone: string }) => {
    const cnpj = String(i.cnpj ?? "").trim();
    const telefone = String(i.telefone ?? "").trim();
    if (cnpj && cnpj.replace(/\D/g, "").length !== 14)
      throw new Error("CNPJ precisa ter 14 números.");
    const digitos = telefone.replace(/\D/g, "");
    if (telefone && (digitos.length < 10 || digitos.length > 13))
      throw new Error("Telefone com DDD, por exemplo (11) 99999-0000.");
    return { cnpj: cnpj.slice(0, 20), telefone: telefone.slice(0, 20) };
  })
  .handler(async ({ data, context }) => {
    // Campo vazio fica como está.
    const mudancas: { cnpj?: string; telefone?: string } = {};
    if (data.cnpj) mudancas.cnpj = data.cnpj;
    if (data.telefone) mudancas.telefone = data.telefone;
    if (!Object.keys(mudancas).length) throw new Error("Preencha o CNPJ ou o telefone.");
    const { error } = await context.supabase
      .from("empresas")
      .update(mudancas)
      .eq("id", context.empresaId);
    if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    return { ok: true };
  });

// ---------------------------------------------------------------- Nexa
async function exigirNexa(supabase: { rpc: (fn: never) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("sou_admin_nexa" as never);
  if (data !== true) throw new Error("Só a Nexa vê e libera as empresas.");
}

/** Progresso de todas as empresas (só a Nexa). */
export const implantacoesNexaFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Implantacao[]> => {
    await exigirNexa(context.supabase);
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { data } = await (await dbServico()).from("empresas").select("id").order("nome");
    return Promise.all((data ?? []).map((e) => montar(e.id)));
  });

/** Libera a empresa (só com as obrigatórias prontas) ou volta a bloquear. */
export const liberarEmpresaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { empresaId: string; liberar: boolean }) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(i.empresaId))) throw new Error("Empresa inválida.");
    return { empresaId: String(i.empresaId), liberar: i.liberar === true };
  })
  .handler(async ({ data, context }) => {
    await exigirNexa(context.supabase);
    if (data.liberar) {
      const atual = await montar(data.empresaId);
      if (!atual.resumo.podeLiberar)
        throw new Error(
          `Ainda faltam etapas obrigatórias (${atual.resumo.obrigatorias.prontas} de ${atual.resumo.obrigatorias.total} prontas).`,
        );
    }
    const { error } = await context.supabase.rpc("liberar_empresa", {
      _emp: data.empresaId,
      _liberar: data.liberar,
    });
    if (error)
      throw new Error(
        `Não foi possível ${data.liberar ? "liberar" : "bloquear"}: ${error.message}`,
      );
    return { ok: true };
  });
