/**
 * Vídeo padrão da Alice (04/11, pedido da Maria): o vídeo é de estofado. Atendimento só de tapete
 * e/ou persiana nunca recebe o vídeo; pedido misto (ex.: sofá + tapete) pode receber.
 */

const sem = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const TAPETE_PERSIANA = /\b(tapetes?|persianas?|passadeiras?)\b/;
const ESTOFADO =
  /\b(sofas?|colchao|colchoes|colchon\w*|cadeiras?|cadeirinhas?|poltronas?|almofadas?|puffs?|pufes?|cabeceiras?|estofad\w*|banquetas?|bancos?|chaises?|recamier\w*|divas?|divan\w*|camas?|berco\w*|box|carrinhos?|bebe conforto|carros?|veiculos?|automotiv\w*|futon\w*)\b/;
const CATEGORIAS_TP = new Set(["tapete", "persiana"]);

/**
 * O pedido é só de tapete e/ou persiana? Usa o que o cliente escreveu, a descrição gravada no lead
 * e as categorias dos itens dos orçamentos do lead. Qualquer estofado (texto ou item) = misto.
 */
export function pedidoSoTapeteOuPersiana(e: {
  textos: Array<string | null | undefined>;
  categorias: Array<string | null | undefined>;
}): boolean {
  const texto = sem(e.textos.filter(Boolean).join(" \n "));
  const cats = e.categorias.filter((c): c is string => Boolean(c));
  if (ESTOFADO.test(texto)) return false;
  if (cats.some((c) => !CATEGORIAS_TP.has(c))) return false;
  return TAPETE_PERSIANA.test(texto) || cats.length > 0;
}

export const TEXTO_SEM_VIDEO_TAPETE =
  "Não mande o vídeo: ele é de estofado e este atendimento é só de tapete/persiana. Siga por texto, sem falar do vídeo.";

/** Índice do aviso do vídeo ("vou te mandar um vídeo…") já posto na resposta, para tirar junto. */
export function avisoDoVideo(saida: ReadonlyArray<{ tipo: string; texto?: string }>): number {
  for (let i = saida.length - 1; i >= 0; i--) {
    const s = saida[i];
    if (s?.tipo === "texto" && s.texto && /v[ií]deo/i.test(s.texto)) return i;
  }
  return -1;
}
