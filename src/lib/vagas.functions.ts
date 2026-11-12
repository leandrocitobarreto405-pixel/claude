/**
 * Alarme de vaga na agenda (11/11): a faixa vermelha de todas as telas e a lista de quem chamar.
 * Só admin e atendente veem; técnico e contadora não.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import { textoDaFaixa, type CandidatoDaVaga, type Vaga } from "@/lib/vagas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const CHAVE_FAIXA_VAGAS = ["vagas", "faixa"] as const;
export const CHAVE_VAGAS = ["vagas", "lista"] as const;

async function podeVer(db: Db): Promise<boolean> {
  const { data: papel } = await db.rpc("meu_papel");
  return papel === "admin" || papel === "atendente";
}

export type FaixaVagas = { texto: string; total: number } | null;

/** Texto da faixa (null = sem vaga, sem horário base ou papel que não vê). */
export const faixaVagasFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<FaixaVagas> => {
    if (!(await podeVer(context.supabase as unknown as Db))) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { lerVagas } = await import("@/lib/vagas.server");
    const { vagas, hoje } = await lerVagas(supabaseAdmin, context.empresaId as string);
    const texto = textoDaFaixa(vagas, hoje);
    return texto ? { texto, total: vagas.length } : null;
  });

export type VagasEQuemChamar = {
  configurado: boolean;
  hoje: string;
  vagas: Vaga[];
  candidatos: CandidatoDaVaga[];
};

/** Vagas abertas e a lista de quem chamar, na ordem. */
export const vagasAbertasFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<VagasEQuemChamar> => {
    if (!(await podeVer(context.supabase as unknown as Db)))
      throw new Error("Só a equipe de atendimento vê as vagas.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { lerVagas, candidatosDasVagas } = await import("@/lib/vagas.server");
    const emp = context.empresaId as string;
    const { configurado, vagas, hoje } = await lerVagas(supabaseAdmin, emp);
    const candidatos = vagas.length
      ? await candidatosDasVagas(supabaseAdmin, emp, hoje, vagas.at(-1)!.data)
      : [];
    return { configurado, hoje, vagas, candidatos };
  });
