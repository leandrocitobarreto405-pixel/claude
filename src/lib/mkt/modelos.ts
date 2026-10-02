/**
 * Modelos de mensagem do WhatsApp (aprovados na Meta) usados nas campanhas e gatilhos.
 *
 * Convenção das variáveis do corpo:
 *  - modelo com nome (sem "_sn"): {{1}} = primeiro nome, {{2}} = condição da campanha;
 *  - variante "_sn" (sem nome confiável): {{1}} = condição.
 * Variáveis nomeadas também valem: {{nome}} / {{primeiro_nome}} e {{condicao}} / {{oferta}}.
 * Modelo que pede algo que não temos (cabeçalho com mídia ou variável, variável a mais, condição
 * numa campanha "sem condição") não serve: a campanha é bloqueada antes de ir para aprovação.
 */

export type ComponenteModelo = {
  type: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string }>;
};

export type ModeloMeta = {
  name: string;
  language: string;
  status: string;
  category?: string | undefined;
  components?: ComponenteModelo[] | undefined;
};

export type DadosMensagem = {
  primeiroNome: string | null;
  condicao: string | null;
  /** Variáveis seguintes ({{3}}, {{4}}...), ex.: o desconto extra do Pix na promoção. */
  extras?: string[] | undefined;
};

export type Preenchimento =
  | { ok: true; parametros: Record<string, string>; texto: string; botoes: string[] }
  | { ok: false; erro: string };

/** Texto da condição: o texto da campanha ou, sem texto, "X% de desconto". */
export function textoCondicao(texto: string | null, pct: number | null): string | null {
  const t = (texto ?? "").trim();
  if (t) return t;
  if (pct && pct > 0) return `${String(pct).replace(".", ",")}% de desconto`;
  return null;
}

/** Idioma "pt_BR" casa com "pt_BR"; se a empresa não configurou, aceita qualquer pt. */
function mesmoIdioma(modelo: string, pedido: string) {
  return modelo.toLowerCase() === pedido.toLowerCase();
}

export function acharModelo(modelos: ModeloMeta[], nome: string, idioma: string) {
  const doNome = modelos.filter((m) => m.name === nome);
  return doNome.find((m) => mesmoIdioma(m.language, idioma)) ?? null;
}

export function situacaoModelo(
  modelos: ModeloMeta[],
  nome: string,
  idioma: string,
): { ok: true; modelo: ModeloMeta } | { ok: false; erro: string } {
  const m = acharModelo(modelos, nome, idioma);
  if (!m) {
    const outro = modelos.find((x) => x.name === nome);
    return {
      ok: false,
      erro: outro
        ? `modelo ${nome} existe só em ${outro.language}, não em ${idioma}`
        : `modelo ${nome} não existe na conta do WhatsApp`,
    };
  }
  if (String(m.status).toUpperCase() !== "APPROVED")
    return { ok: false, erro: `modelo ${nome} não está aprovado na Meta (situação: ${m.status})` };
  return { ok: true, modelo: m };
}

const VARIAVEL = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Variáveis do texto, na ordem em que aparecem, sem repetir. */
export function variaveis(texto: string): string[] {
  const vistas: string[] = [];
  for (const m of texto.matchAll(VARIAVEL)) {
    const v = m[1];
    if (v && !vistas.includes(v)) vistas.push(v);
  }
  return vistas;
}

const NOMES_NOME = ["nome", "primeiro_nome", "first_name", "name"];
const NOMES_CONDICAO = ["condicao", "oferta", "desconto"];

export function preencher(modelo: ModeloMeta, dados: DadosMensagem): Preenchimento {
  const comps = modelo.components ?? [];
  const cabecalho = comps.find((c) => c.type?.toUpperCase() === "HEADER");
  if (cabecalho) {
    const formato = (cabecalho.format ?? "TEXT").toUpperCase();
    if (formato !== "TEXT")
      return {
        ok: false,
        erro: `modelo ${modelo.name} tem ${formato} no cabeçalho (não suportado)`,
      };
    if (variaveis(cabecalho.text ?? "").length)
      return { ok: false, erro: `modelo ${modelo.name} tem variável no cabeçalho (não suportado)` };
  }
  const corpo = comps.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";
  const semNome = modelo.name.endsWith("_sn");
  const ordem = [
    ...(semNome ? [dados.condicao] : [dados.primeiroNome, dados.condicao]),
    ...(dados.extras ?? []),
  ];
  const parametros: Record<string, string> = {};
  for (const v of variaveis(corpo)) {
    let valor: string | null | undefined;
    if (/^\d+$/.test(v)) valor = ordem[Number(v) - 1];
    else if (NOMES_NOME.includes(v.toLowerCase())) valor = semNome ? undefined : dados.primeiroNome;
    else if (NOMES_CONDICAO.includes(v.toLowerCase())) valor = dados.condicao;
    if (valor === undefined)
      return { ok: false, erro: `modelo ${modelo.name}: não sei preencher a variável {{${v}}}` };
    if (valor === null || !valor.trim()) {
      const qual =
        NOMES_NOME.includes(v.toLowerCase()) || (!semNome && v === "1") ? "nome" : "condição";
      return {
        ok: false,
        erro:
          qual === "nome"
            ? `modelo ${modelo.name} pede o nome e o contato não tem nome confiável (use a variante _sn)`
            : `modelo ${modelo.name} pede a condição e a campanha está sem condição`,
      };
    }
    parametros[v] = valor.trim();
  }
  const texto = corpo.replace(VARIAVEL, (_, v: string) => parametros[v] ?? "");
  const rodape = comps.find((c) => c.type?.toUpperCase() === "FOOTER")?.text;
  const botoes = (comps.find((c) => c.type?.toUpperCase() === "BUTTONS")?.buttons ?? [])
    .map((b) => b.text ?? "")
    .filter(Boolean);
  return {
    ok: true,
    parametros,
    texto: [cabecalho?.text, texto, rodape].filter(Boolean).join("\n\n"),
    botoes,
  };
}

/** Corpo do template_params do Chatwoot (processed_params no formato novo). */
export function templateParams(modelo: ModeloMeta, parametros: Record<string, string>) {
  return {
    name: modelo.name,
    category: modelo.category ?? "MARKETING",
    language: modelo.language,
    processed_params: Object.keys(parametros).length ? { body: parametros } : {},
  };
}
