/**
 * Configurações › Mensagens › Encerramento automático: ler, salvar e prever quantas conversas
 * seriam encerradas agora com a regra escolhida (antes de ligar).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import {
  CHAVE_CONFIG_CAIXA,
  configEncerramento,
  limiteParada,
  paraSalvar,
  situacoesAlcancadas,
  type ConfigEncerramento,
} from "@/lib/caixa-encerramento";

export const CHAVE_ENCERRAMENTO = ["config-encerramento"] as const;

function validar(i: ConfigEncerramento): ConfigEncerramento {
  const horas = Math.round(Number(i?.horas));
  if (!Number.isFinite(horas) || horas < 1 || horas > 720)
    throw new Error("Horas sem mensagem: use de 1 a 720 (30 dias).");
  return { ligado: i.ligado === true, horas, incluirAlice: i.incluirAlice === true };
}

export const lerEncerramentoFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ConfigEncerramento> => {
    const { data } = await context.supabase
      .from("app_settings")
      .select("value")
      .eq("empresa_id", context.empresaId)
      .eq("key", CHAVE_CONFIG_CAIXA)
      .maybeSingle();
    return configEncerramento(data?.value);
  });

/** Quantas conversas a regra pegaria agora (equipe e, se marcado, Alice). */
export const previaEncerramentoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(validar)
  .handler(async ({ data, context }) => {
    const limite = limiteParada(data);
    const contar = async (status: string) => {
      const { count } = await context.supabase
        .from("conversas")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", context.empresaId)
        .eq("status", status)
        .lt("ultima_atividade_em", limite);
      return count ?? 0;
    };
    const equipe = await contar("open");
    const alice = await contar("pending");
    return { equipe, alice, total: equipe + (data.incluirAlice ? alice : 0) };
  });

export const salvarEncerramentoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(validar)
  .handler(async ({ data, context }) => {
    const { data: atual } = await context.supabase
      .from("app_settings")
      .select("value")
      .eq("empresa_id", context.empresaId)
      .eq("key", CHAVE_CONFIG_CAIXA)
      .maybeSingle();
    const value = {
      ...((atual?.value && typeof atual.value === "object" ? atual.value : {}) as Record<
        string,
        unknown
      >),
      ...paraSalvar(data),
    };
    const { error } = await context.supabase.from("app_settings").upsert(
      {
        empresa_id: context.empresaId,
        key: CHAVE_CONFIG_CAIXA,
        value: value as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,key" },
    );
    if (error) throw new Error("Não foi possível salvar o encerramento automático.");
    return { ok: true };
  });
