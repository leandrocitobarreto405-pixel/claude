/**
 * Planilha diária "Nexa OS — Listas" no Drive da conta Google da empresa: aba Resumo (cada opção
 * com quantas pessoas e quantas podem receber agora) e uma aba por lista. Criada na primeira vez
 * (botão "Atualizar agora" ou rotina das 9h) e reescrita a cada atualização.
 */
import type { Db } from "@/lib/mkt/contexto.server";
import {
  FAMILIAS,
  linhasDaLista,
  pessoasDaFamilia,
  resumoDasListas,
  type Filtros,
  type PessoaLista,
} from "@/lib/listas";
import {
  ErroGoogle,
  abasDaPlanilha,
  criarAbas,
  criarPlanilha,
  gravarAba,
  tokenDaEmpresa,
} from "@/lib/google-planilhas.server";

export const TITULO_PLANILHA = "Nexa OS — Listas";
export const ABAS = ["Resumo", ...FAMILIAS.map((f) => f.nome)];

export const urlDaPlanilha = (id: string) =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

async function pessoasDaEmpresa(db: Db, empresaId: string): Promise<PessoaLista[]> {
  const todas: Filtros = Object.fromEntries(FAMILIAS.map((f) => [f.familia, {}]));
  const { data, error } = await db.rpc(
    "mkt_publico_servico" as never,
    { _emp: empresaId, _filtros: todas } as never,
  );
  if (error) throw new Error(`Não foi possível ler as listas: ${error.message}`);
  return ((data ?? []) as PessoaLista[]).map((p) => ({
    ...p,
    orcamento_valor: p.orcamento_valor === null ? null : Number(p.orcamento_valor),
  }));
}

export type ResultadoPlanilha = { id: string; url: string; criada: boolean; pessoas: number };

/** Cria (se ainda não existe) e reescreve a planilha das listas da empresa. */
export async function atualizarPlanilhaListas(
  db: Db,
  empresaId: string,
): Promise<ResultadoPlanilha> {
  const [{ data: cfg }, pessoas, token] = await Promise.all([
    db
      .from("mkt_configuracoes")
      .select("planilha_listas_id")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    pessoasDaEmpresa(db, empresaId),
    tokenDaEmpresa(empresaId),
  ]);
  let id = (cfg as { planilha_listas_id?: string | null } | null)?.planilha_listas_id ?? null;
  let criada = false;
  if (id) {
    // A planilha pode ter sido apagada ou o acesso perdido: nesse caso cria outra.
    const existentes = await abasDaPlanilha(token, id).catch((e: unknown) => {
      if (e instanceof ErroGoogle && /\b(404|403)\b/.test(e.message)) return null;
      throw e;
    });
    if (existentes === null) id = null;
    else
      await criarAbas(
        token,
        id,
        ABAS.filter((a) => !existentes.includes(a)),
      );
  }
  if (!id) {
    id = await criarPlanilha(token, TITULO_PLANILHA, ABAS);
    criada = true;
  }
  const agora = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
  await gravarAba(token, id, "Resumo", resumoDasListas(pessoas, agora));
  for (const def of FAMILIAS) {
    await gravarAba(token, id, def.nome, linhasDaLista(pessoasDaFamilia(pessoas, def.familia)));
  }
  const { error } = await db
    .from("mkt_configuracoes")
    .update({
      planilha_listas_id: id,
      planilha_listas_atualizada_em: new Date().toISOString(),
    } as never)
    .eq("empresa_id", empresaId);
  if (error)
    throw new Error(`Planilha atualizada, mas não deu para guardar o endereço: ${error.message}`);
  return { id, url: urlDaPlanilha(id), criada, pessoas: pessoas.length };
}
