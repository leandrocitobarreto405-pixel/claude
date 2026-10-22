/**
 * Respostas prontas da barra de resposta ("/" + atalho). Funções puras: validar, filtrar,
 * preencher as variáveis e converter as do Chatwoot.
 */

export type RespostaPronta = { id: string; atalho: string; texto: string };

export type ValoresResposta = {
  /** Primeiro nome do cliente (null quando não há um nome confiável). */
  nome: string | null;
  empresa: string | null;
  /** Primeiro nome de quem está respondendo. */
  atendente: string | null;
};

export const MAX_RESPOSTAS = 200;
export const MAX_TEXTO_RESPOSTA = 4096;

const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Bom Dia!" → "bom-dia" (atalho sem espaços nem barra). */
export function limparAtalho(atalho: string): string {
  return sem(atalho.trim().replace(/^\/+/, ""))
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

/** Valida e arruma a lista inteira (atalho único, texto obrigatório). */
export function validarRespostas(lista: RespostaPronta[]): RespostaPronta[] {
  if (lista.length > MAX_RESPOSTAS)
    throw new Error(`No máximo ${MAX_RESPOSTAS} respostas prontas.`);
  const vistos = new Set<string>();
  return lista.map((r) => {
    const atalho = limparAtalho(r.atalho);
    const texto = (r.texto ?? "").trim();
    if (!atalho) throw new Error("Toda resposta precisa de um atalho.");
    if (!texto) throw new Error(`A resposta "/${atalho}" está sem texto.`);
    if (texto.length > MAX_TEXTO_RESPOSTA)
      throw new Error(`A resposta "/${atalho}" passou de ${MAX_TEXTO_RESPOSTA} caracteres.`);
    if (vistos.has(atalho)) throw new Error(`O atalho "/${atalho}" está repetido.`);
    vistos.add(atalho);
    return { id: r.id || atalho, atalho, texto };
  });
}

/** Filtra pelo que foi digitado depois da barra: atalho primeiro, depois o texto. */
export function filtrarRespostas(lista: RespostaPronta[], termo: string): RespostaPronta[] {
  const t = sem(termo.trim());
  if (!t) return lista;
  const pelo = lista.filter((r) => r.atalho.startsWith(t) || sem(r.atalho).includes(t));
  const peloTexto = lista.filter((r) => !pelo.includes(r) && sem(r.texto).includes(t));
  return [...pelo, ...peloTexto];
}

/**
 * Coloca os valores nas variáveis {nome}, {empresa} e {atendente}. Sem o valor, a variável sai
 * junto com a vírgula ou o espaço antes dela ("Oi, {nome}!" → "Oi!").
 */
export function preencherResposta(texto: string, v: ValoresResposta): string {
  let t = texto;
  for (const [chave, valor] of Object.entries(v) as Array<[keyof ValoresResposta, string | null]>) {
    const re = new RegExp(`\\{${chave}\\}`, "gi");
    if (valor) t = t.replace(re, valor);
    else t = t.replace(new RegExp(`[ \\t]*,?[ \\t]*\\{${chave}\\}`, "gi"), "");
  }
  return t.replace(/[ \t]+([!?.,])/g, "$1").trim();
}

/** Variáveis do Chatwoot ({{contact.name}}, {{agent.name}}…) viram as do Nexa. */
export function daChatwoot(texto: string): string {
  return texto
    .replace(/\{\{\s*contact\.(first_name|name)\s*\}\}/gi, "{nome}")
    .replace(/\{\{\s*agent\.(first_name|name)\s*\}\}/gi, "{atendente}")
    .replace(/\{\{\s*(account|inbox)\.name\s*\}\}/gi, "{empresa}");
}
