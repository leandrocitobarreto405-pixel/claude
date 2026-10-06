/**
 * Situação atualizada dos modelos de mensagem.
 *
 * O Nexa lê os modelos pela lista que o Chatwoot guarda da Meta, e essa lista pode ficar
 * atrasada (ex.: modelo aprovado na Meta que o Chatwoot ainda mostra "PENDING"). Antes de
 * conferir, pedimos ao Chatwoot para buscar de novo (sync_templates); se ainda divergir e a
 * empresa tiver a conexão com a Meta no Nexa, vale o que a Meta diz. O token nunca sai daqui.
 */
import type { ContextoEmpresa, Db } from "./contexto.server";
import { juntarComMeta, precisaConferirNaMeta, type Divergencia, type ModeloMeta } from "./modelos";

export type SituacaoModelos = {
  modelos: ModeloMeta[];
  /** O Chatwoot aceitou o pedido de buscar os modelos de novo. */
  sincronizou: boolean;
  /** Conferiu direto na Meta (conexão do Nexa). */
  conferiuMeta: boolean;
  /** Modelos em que o Chatwoot ainda diverge da Meta (vale a Meta). */
  divergentes: Divergencia[];
  /** Erro ao ler na Meta (sem o token). */
  erroMeta: string | null;
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function modelosAtualizados(
  db: Db,
  empresaId: string,
  opcoes: {
    /** Pede ao Chatwoot para buscar os modelos na Meta antes de ler (e espera um pouco). */
    sincronizar?: boolean;
    /** Modelos que precisam estar aprovados: só confere na Meta se algum não estiver. */
    precisa?: string[];
    idioma?: string;
    ctx?: ContextoEmpresa;
  } = {},
): Promise<SituacaoModelos> {
  const { contextoEmpresa } = await import("./contexto.server");
  const { modelosDaCaixa, sincronizarModelos } = await import("./chatwoot.server");
  const ctx = opcoes.ctx ?? (await contextoEmpresa(db, empresaId));
  if (!ctx.tokenAdmin) throw new Error("token de API do Chatwoot não configurado");
  const tokenAdmin = ctx.tokenAdmin;
  const ler = () => modelosDaCaixa(ctx.conta, tokenAdmin, ctx.caixa);

  let sincronizou = false;
  if (opcoes.sincronizar) {
    sincronizou = await sincronizarModelos(ctx.conta, tokenAdmin, ctx.caixa);
    // A busca do Chatwoot roda em segundo plano: dá um tempo antes de ler.
    if (sincronizou) await esperar(2500);
  }
  let chatwoot = await ler();
  const base: SituacaoModelos = {
    modelos: chatwoot,
    sincronizou,
    conferiuMeta: false,
    divergentes: [],
    erroMeta: null,
  };
  if (opcoes.precisa && !precisaConferirNaMeta(chatwoot, opcoes.precisa, opcoes.idioma ?? "pt_BR"))
    return base;

  const { conexaoDaEmpresa } = await import("@/lib/meta/modelos.server");
  const cx = await conexaoDaEmpresa(db, empresaId);
  if (!cx) return base;
  const { listarModelos, mensagemDoErro, semToken } = await import("@/lib/meta/graph.server");
  let meta: ModeloMeta[];
  try {
    meta = (await listarModelos(cx)) as ModeloMeta[];
  } catch (e) {
    return { ...base, erroMeta: semToken(mensagemDoErro(e), cx.token) };
  }
  let junto = juntarComMeta(chatwoot, meta);
  if (junto.divergentes.length && sincronizou) {
    // O Chatwoot pode só estar demorando: lê mais uma vez antes de dar a divergência.
    await esperar(3000);
    chatwoot = await ler();
    junto = juntarComMeta(chatwoot, meta);
  }
  return { ...base, ...junto, conferiuMeta: true };
}

/** "tc_x (Chatwoot: PENDING, Meta: APPROVED)". */
export function textoDivergencias(d: Divergencia[]): string {
  return d
    .map((x) => `${x.nome} (Chatwoot: ${x.chatwoot ?? "não tem"}, Meta: ${x.meta})`)
    .join("; ");
}
