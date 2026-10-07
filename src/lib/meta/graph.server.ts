/**
 * API de gestão de modelos do WhatsApp (Graph API da Meta). Só servidor.
 *
 * O token vai apenas no cabeçalho Authorization (nunca na URL) e é apagado de qualquer texto de
 * erro antes de sair daqui: não aparece em log, mensagem de erro nem tela.
 */
import type { ComponenteMeta, ModeloDaMeta } from "@/lib/modelos-mensagem";

const VERSAO = "v23.0";
const base = () =>
  (process.env["META_GRAPH_URL"] ?? "https://graph.facebook.com").replace(/\/$/, "");

export type ConexaoMeta = { waba: string; token: string };

/** Erro da Meta já sem o token, com o código para decidir o que mostrar. */
export class ErroMeta extends Error {
  constructor(
    mensagem: string,
    readonly codigo: number | null = null,
    readonly status: number | null = null,
  ) {
    super(mensagem);
    this.name = "ErroMeta";
  }
}

/** Tira o token (e qualquer coisa com cara de token da Meta) de um texto. */
export function semToken(texto: string, token?: string | null): string {
  let t = String(texto ?? "");
  if (token && token.length >= 8) t = t.split(token).join("***");
  return t.replace(/EAA[A-Za-z0-9_-]{10,}/g, "***").replace(/Bearer\s+\S+/gi, "Bearer ***");
}

type RespostaErro = {
  error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
};

async function chamar<T>(
  cx: ConexaoMeta,
  metodo: "GET" | "POST" | "DELETE",
  caminho: string,
  corpo?: unknown,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${base()}/${VERSAO}/${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${cx.token}`,
        ...(corpo ? { "Content-Type": "application/json" } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : null,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ErroMeta(
      `Não foi possível falar com a Meta: ${semToken(e instanceof Error ? e.message : String(e), cx.token)}`,
    );
  }
  const json = (await r.json().catch(() => null)) as (T & RespostaErro) | null;
  if (!r.ok || json?.error) {
    const e = json?.error;
    const texto = e?.error_user_msg || e?.message || `erro ${r.status}`;
    throw new ErroMeta(semToken(texto, cx.token), e?.code ?? null, r.status);
  }
  return json as T;
}

/** Explica em português os erros mais comuns (token, permissão, limite). */
export function mensagemDoErro(e: unknown): string {
  if (!(e instanceof ErroMeta)) return "Erro inesperado ao falar com a Meta.";
  if (e.codigo === 190)
    return "A Meta recusou o token (inválido ou expirado). Gere um novo e troque.";
  if (e.codigo === 10 || e.codigo === 200 || e.status === 403)
    return `O token não tem permissão para esta conta do WhatsApp (whatsapp_business_management). Detalhe da Meta: ${e.message}`;
  if (e.codigo === 100 && /nonexist|does not exist|Unsupported get/i.test(e.message))
    return `A Meta não encontrou a conta do WhatsApp Business com esse ID. Detalhe: ${e.message}`;
  if (e.codigo === 4 || e.codigo === 80008 || e.status === 429)
    return `A Meta limitou as chamadas por enquanto. Tente de novo em alguns minutos. Detalhe: ${e.message}`;
  return `A Meta respondeu: ${e.message}`;
}

/** Confere token + conta e devolve o nome da conta do WhatsApp Business. */
export async function conferirConexao(cx: ConexaoMeta): Promise<{ nome: string | null }> {
  const r = await chamar<{ id?: string; name?: string }>(
    cx,
    "GET",
    `${encodeURIComponent(cx.waba)}?fields=id,name`,
  );
  return { nome: r.name ?? null };
}

const CAMPOS = "id,name,language,status,category,quality_score,components";

/** Todos os modelos da conta (segue a paginação). Pede o motivo da recusa quando a Meta aceita. */
export async function listarModelos(cx: ConexaoMeta): Promise<ModeloDaMeta[]> {
  const lista: ModeloDaMeta[] = [];
  let comMotivo = true;
  let depois: string | null = null;
  for (let pagina = 0; pagina < 30; pagina++) {
    const campos = comMotivo ? `${CAMPOS},rejected_reason` : CAMPOS;
    const q = `fields=${campos}&limit=100${depois ? `&after=${encodeURIComponent(depois)}` : ""}`;
    let r: { data?: ModeloDaMeta[]; paging?: { cursors?: { after?: string }; next?: string } };
    try {
      r = await chamar(cx, "GET", `${encodeURIComponent(cx.waba)}/message_templates?${q}`);
    } catch (e) {
      // Versão da API sem o campo do motivo: tenta de novo sem ele.
      if (
        comMotivo &&
        e instanceof ErroMeta &&
        e.codigo === 100 &&
        /rejected_reason/.test(e.message)
      ) {
        comMotivo = false;
        pagina--;
        continue;
      }
      throw e;
    }
    lista.push(...(r.data ?? []));
    depois = r.paging?.next ? (r.paging.cursors?.after ?? null) : null;
    if (!depois) break;
  }
  return lista;
}

export type NovoModelo = {
  name: string;
  language: string;
  category: string;
  components: ComponenteMeta[];
};

/** Cria e envia para análise. Devolve o id e a situação que a Meta informou. */
export async function criarModelo(cx: ConexaoMeta, m: NovoModelo) {
  return chamar<{ id: string; status?: string; category?: string }>(
    cx,
    "POST",
    `${encodeURIComponent(cx.waba)}/message_templates`,
    m,
  );
}

/** Edita (troca todos os blocos) e envia para análise de novo. */
export async function editarModelo(
  cx: ConexaoMeta,
  id: string,
  m: { components: ComponenteMeta[]; category?: string },
) {
  if (!/^\d+$/.test(id)) throw new ErroMeta("Modelo inválido.");
  return chamar<{ success?: boolean }>(cx, "POST", id, m);
}

/** Um modelo pelo id (para conferir a situação antes de editar). */
export async function lerModelo(cx: ConexaoMeta, id: string): Promise<ModeloDaMeta> {
  if (!/^\d+$/.test(id)) throw new ErroMeta("Modelo inválido.");
  return chamar<ModeloDaMeta>(cx, "GET", `${id}?fields=${CAMPOS}`);
}

export type NumeroDaConta = {
  id: string;
  display_phone_number?: string;
  quality_rating?: string;
  whatsapp_business_manager_messaging_limit?: string;
};

/** Números da conta com a qualidade (GREEN/YELLOW/RED) e o limite de mensagens por dia. */
export async function numerosDaConta(cx: ConexaoMeta): Promise<NumeroDaConta[]> {
  const r = await chamar<{ data?: NumeroDaConta[] }>(
    cx,
    "GET",
    `${encodeURIComponent(cx.waba)}/phone_numbers?fields=display_phone_number,quality_rating`,
  );
  return r.data ?? [];
}
