/**
 * Tela "Listas" do Marketing: quantidade de cada opção, quem está nela e o modelo usado.
 * Leitura só (nada é enviado daqui). O banco confere que é admin ou atendente da empresa ativa.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import { filtrosValidos, TODAS_OPCOES, type Filtros, type PessoaLista } from "@/lib/listas";

export type ContagemListas = Record<string, { total: number; podem: number }>;

export const contagemListasFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ContagemListas> => {
    const opcoes = Object.fromEntries(
      TODAS_OPCOES.map((o) => [o.chave, { [o.familia]: o.filtro }]),
    );
    const { data, error } = await context.supabase.rpc(
      "mkt_listas_contagem" as never,
      {
        _opcoes: opcoes,
      } as never,
    );
    if (error) throw new Error(`Não foi possível contar as listas: ${error.message}`);
    return (data ?? {}) as unknown as ContagemListas;
  });

export type PessoaPublico = PessoaLista & {
  contato_id: string;
  orcamento_em: string | null;
  orcamento_a_vista: number | null;
  orcamento_km: number | null;
  conversa_em: string | null;
  cliente_em: string | null;
  perdido_preco_em: string | null;
  agendado_para: string | null;
  endereco: string | null;
  cep: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** Quem está nos filtros (juntos, sem repetir pessoa). */
export async function lerPublico(
  db: {
    rpc: (
      fn: never,
      args: never,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  filtros: Filtros,
  promocao: boolean,
): Promise<PessoaPublico[]> {
  if (!Object.keys(filtros).length) return [];
  const { data, error } = await db.rpc(
    "mkt_lista_publico" as never,
    { _filtros: filtros, _promocao: promocao } as never,
  );
  if (error) throw new Error(`Não foi possível ler a lista: ${error.message}`);
  return ((data ?? []) as PessoaPublico[]).map((p) => ({
    ...p,
    orcamento_valor: p.orcamento_valor === null ? null : Number(p.orcamento_valor),
    orcamento_a_vista: p.orcamento_a_vista === null ? null : Number(p.orcamento_a_vista),
    orcamento_km: p.orcamento_km === null ? null : Number(p.orcamento_km),
  }));
}

export const pessoasDaListaFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { filtros: Filtros }) => ({ filtros: filtrosValidos(i.filtros) }))
  .handler(async ({ data, context }) => lerPublico(context.supabase as never, data.filtros, false));

export type ModelosDasListas = {
  /** Nome do modelo de cada finalidade usada pelas listas. */
  nomes: Record<string, string>;
  /** Situação na Meta de cada modelo (só para o admin; vazio se não deu para consultar). */
  situacao: Record<string, { rotulo: string; tom: "neutro" | "sucesso" | "atencao" | "problema" }>;
};

export const modelosDasListasFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<ModelosDasListas> => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { listarParaTela } = await import("@/lib/meta/modelos.server");
    const lista = await listarParaTela(await dbServico(), context.empresaId);
    const situacao: ModelosDasListas["situacao"] = {};
    for (const m of lista.modelos) situacao[m.nome] = m.situacao;
    for (const f of lista.faltando) situacao[f.nome] = { rotulo: "Não existe", tom: "problema" };
    if (lista.fonte === "nenhuma") for (const k of Object.keys(situacao)) delete situacao[k];
    return { nomes: lista.nomes, situacao };
  });
