/**
 * Tatiana em tempo real (05/11), regras puras:
 * - concorrência: o cliente citou outra empresa ou um preço menor na conversa;
 * - retorno prometido: o cliente disse que responderia num dia e, até o meio da tarde, não
 *   respondeu.
 */
const CONCORRENCIA =
  /outra empresa|concorr[eê]n|mais barat|or[cç]amento (melhor|menor|mais barato)|outro or[cç]amento|outros or[cç]amentos|fechei com|fechamos com|vou fechar com|achei (por|mais barato)|(ela|eles|outra) cobra(m|ram|ria)? /i;

export function fraseDeConcorrencia(texto: string | null | undefined): boolean {
  return Boolean(texto && CONCORRENCIA.test(texto));
}

/** Valor citado pelo cliente ("R$ 460", "460,00"), se houver. */
export function valorCitado(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = texto.match(/R\$\s?\d[\d.]*(,\d{2})?/i) ?? texto.match(/\b\d{3,4}(,\d{2})?\b/);
  if (!m) return null;
  return m[0].startsWith("R") ? m[0].replace(/R\$\s?/i, "R$ ") : `R$ ${m[0]}`;
}

/** Hora do dia (SP) em que o retorno prometido sem resposta vira P1. */
export const HORA_RETORNO_VENCIDO = "15:00";

/** O retorno prometido para hoje está vencido? (depois das 15h e sem resposta desde a promessa) */
export function retornoVencido(o: {
  prometidoEm: string | null;
  hoje: string;
  hora: string;
  respondeuDepois: boolean;
  jaCobrado: boolean;
}): boolean {
  if (!o.prometidoEm || o.jaCobrado || o.respondeuDepois) return false;
  if (o.prometidoEm > o.hoje) return false;
  if (o.prometidoEm === o.hoje) return o.hora >= HORA_RETORNO_VENCIDO;
  return true; // venceu num dia anterior e ninguém cobrou
}

export function mensagemRetornoVencido(nome: string | null): string {
  const oi = nome ? `Oi, ${nome}!` : "Oi!";
  return `${oi} Tudo bem? Conseguiu avaliar a proposta que te passei?`;
}
