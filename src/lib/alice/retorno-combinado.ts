/**
 * Retorno combinado fora da janela de 24 h (28/10): modelo fu_retorno_combinado
 * ("Oi, {{1}}! Alice aqui, da Turbine Clean 💙 {{2}} Posso continuar seu atendimento?"), ou a
 * variante _sn sem nome confiável. {{2}} é uma frase curta escrita na hora, com empatia e ligada ao
 * que o cliente contou. Funções puras: a instrução da frase, a limpeza e qual modelo usar.
 */

export const MODELO_RETORNO = "fu_retorno_combinado";
export const MODELO_RETORNO_SN = "fu_retorno_combinado_sn";
export const FRASE_RETORNO_PADRAO = "Como estão as coisas por aí?";
export const MAX_FRASE_RETORNO = 120;

export const INSTRUCAO_FRASE_RETORNO = `Você é a Alice, atendente de uma empresa de higienização e impermeabilização de estofados. Foi combinado voltar a falar com o cliente agora. Escreva UMA frase curta, com empatia, ligada ao que o cliente contou (ex.: "Conseguiu conversar com o seu marido sobre a impermeabilização da poltrona?", "Deu tudo certo com a mudança?"). Regras: até ${MAX_FRASE_RETORNO} caracteres, uma linha só, sem preço, sem valor, sem link, sem emoji, sem o nome do cliente, sem cumprimentar (o "Oi" já vem antes) e terminando com "?". Responda só a frase.`;

const PRECO_OU_LINK = /(R\$|\d+[.,]\d{2}\b|https?:|www\.|\.com\b)/i;

/**
 * Deixa a frase pronta para a variável do modelo: uma linha (sem quebra, tabulação nem 4 espaços
 * seguidos), até 120 caracteres, sem preço nem link, terminando com "?". Fora disso, a padrão.
 */
export function limparFraseRetorno(texto: string | null | undefined): string {
  let f = (texto ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“'«]+|["”'»]+$/g, "")
    .trim();
  if (!f || PRECO_OU_LINK.test(f)) return FRASE_RETORNO_PADRAO;
  if (!f.endsWith("?")) f = `${f.replace(/[.!…]+$/, "")}?`;
  if (f.length > MAX_FRASE_RETORNO) return FRASE_RETORNO_PADRAO;
  return f;
}

/** Modelo e variáveis: com nome, {{1}} = nome e {{2}} = frase; sem nome (_sn), {{1}} = frase. */
export function modeloDoRetorno(
  nome: string | null,
  frase: string,
): { modelo: string; valores: string[] } {
  return nome
    ? { modelo: MODELO_RETORNO, valores: [nome, frase] }
    : { modelo: MODELO_RETORNO_SN, valores: [frase] };
}
