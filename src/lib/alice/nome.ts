/**
 * Nome do cliente (todas as empresas): a Alice só chama o cliente pelo nome do perfil do WhatsApp
 * quando ele parece nome de pessoa; senão pergunta, junto da primeira resposta. O nome confirmado
 * fica no contato e na conversa, separado do nome do perfil, com a origem. Funções puras.
 */

export type OrigemNome = "perfil" | "cliente" | "cadastro" | "equipe";

export const ROTULO_ORIGEM: Record<OrigemNome, string> = {
  perfil: "nome do perfil aceito",
  cliente: "informado pelo cliente",
  cadastro: "do cadastro de cliente (OS)",
  equipe: "corrigido pela equipe",
};

/** Quantas vezes a Alice pergunta o nome, no máximo (a primeira e mais uma, adiante). */
export const MAX_PERGUNTAS_NOME = 2;

function maiuscula(palavra: string): string {
  if (!palavra) return "";
  // Partículas ficam minúsculas ("Ana de Souza"); o resto, primeira letra maiúscula.
  if (/^(da|de|do|das|dos|e)$/i.test(palavra)) return palavra.toLowerCase();
  return palavra.charAt(0).toLocaleUpperCase("pt-BR") + palavra.slice(1).toLocaleLowerCase("pt-BR");
}

/** "  bEATRIZ   souza " → "Beatriz Souza". Tira emojis, números e pontuação das pontas. */
export function limparNome(texto: string | null | undefined): string {
  const palavras = (texto ?? "")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .map((p) => p.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
  return palavras
    .map((p, i) => (i === 0 ? maiuscula(p).replace(/^./, (c) => c.toUpperCase()) : maiuscula(p)))
    .join(" ");
}

/** Só o primeiro nome, com a primeira letra maiúscula ("ana paula" → "Ana"). */
export function primeiroNomeLimpo(texto: string | null | undefined): string | null {
  return limparNome(texto).split(" ")[0] || null;
}

const PALAVRAS_DE_EMPRESA =
  /\b(ltda|me|eireli|loja|store|shop|oficial|comercio|comércio|distribuidora|imoveis|imóveis|delivery|estetica|estética|studio|stúdio|salao|salão|moveis|móveis|restaurante|pizzaria|clinica|clínica|consultoria|servicos|serviços|vendas|atacado|varejo|empresa|igreja|ministerio|ministério)\b/i;

export type AvaliacaoPerfil = "nao_parece" | "avaliar";

/**
 * Pré-avaliação do nome do perfil (só os casos óbvios). "nao_parece": a Alice não usa e pergunta.
 * "avaliar": a Alice decide (palavras comuns como "Cacau", "Princesa", "Bênção" ficam com ela; na
 * dúvida, pergunta).
 */
export function avaliarPerfil(perfil: string | null | undefined): AvaliacaoPerfil {
  const p = (perfil ?? "").trim();
  if (!p) return "nao_parece";
  if (/\p{Extended_Pictographic}/u.test(p)) return "nao_parece";
  if (/\d|@|https?:|www\./i.test(p)) return "nao_parece";
  const palavras = p.split(/\s+/).filter(Boolean);
  if (palavras.length > 4) return "nao_parece";
  if (PALAVRAS_DE_EMPRESA.test(p)) return "nao_parece";
  // Só iniciais ("J.P.", "AB", "M"): nada para chamar.
  if (palavras.every((w) => w.replace(/[^\p{L}]/gu, "").length <= 2)) return "nao_parece";
  return "avaliar";
}

export type SituacaoNome = {
  /** Nome confirmado (contato ou conversa), já limpo. */
  confirmado: string | null;
  origem: OrigemNome | null;
  /** Nome do perfil do WhatsApp, só como referência. */
  perfil: string | null;
  /** Quantas vezes a Alice já perguntou nesta conversa. */
  perguntas: number;
};

/** A linha que a Alice recebe sobre o nome do cliente (instruções do momento). */
export function linhaDoNome(s: SituacaoNome): string {
  const primeiro = primeiroNomeLimpo(s.confirmado);
  if (primeiro) {
    return `nome do cliente CONFIRMADO: ${primeiro} (${ROTULO_ORIGEM[s.origem ?? "cliente"]}); chame por "${primeiro}" e não pergunte o nome`;
  }
  const perfil = (s.perfil ?? "").trim();
  const pre = perfil
    ? avaliarPerfil(perfil) === "nao_parece"
      ? ` (nome do perfil do WhatsApp: "${perfil}", NÃO parece nome de pessoa: não use)`
      : ` (nome do perfil do WhatsApp: "${perfil}", ainda não avaliado: veja a regra do nome)`
    : " (sem nome no perfil do WhatsApp)";
  if (s.perguntas <= 0) return `nome do cliente ainda não confirmado${pre}`;
  if (s.perguntas < MAX_PERGUNTAS_NOME)
    return `nome do cliente ainda não confirmado${pre}; você já perguntou 1 vez: pergunte só mais uma, de forma natural, antes do orçamento ou da OS`;
  return `nome do cliente não informado${pre}; você já perguntou ${s.perguntas} vezes: NÃO pergunte mais e siga sem nome`;
}
