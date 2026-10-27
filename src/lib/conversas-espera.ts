/**
 * Cliente esperando "de verdade" (regras puras, sem banco). A conversa só conta como espera se a
 * última mensagem é do cliente E o que ele mandou depois da última resposta da equipe/Alice pede
 * resposta. Mensagem de encerramento ("combinado", "ok", "obrigado", 👍, "até lá"...) depois de uma
 * resposta não é espera (27/10: quase todas as 114 notificações do dia 26 eram isso).
 */

/** Palavras de encerramento/confirmação (sem acento, minúsculas). */
const ENCERRAMENTO = new Set([
  "ok",
  "okay",
  "oks",
  "okk",
  "combinado",
  "combinadissimo",
  "obrigado",
  "obrigada",
  "obrigadao",
  "obrigadinha",
  "obg",
  "brigado",
  "brigada",
  "grato",
  "grata",
  "agradeco",
  "valeu",
  "vlw",
  "beleza",
  "blz",
  "perfeito",
  "certo",
  "certinho",
  "show",
  "top",
  "otimo",
  "otima",
  "fechado",
  "fechou",
  "tabom",
  "entendi",
  "entendido",
  "maravilha",
  "joia",
  "legal",
  "massa",
  "excelente",
  "confirmado",
  "aguardo",
  "aguardando",
  "tchau",
  "bjs",
  "beijos",
  "abraco",
  "abracos",
  "amem",
  "isso",
  "sim",
]);
/** Palavras que podem acompanhar o encerramento sem mudar o sentido. */
const COMPLEMENTO = new Set([
  "muito",
  "muitissimo",
  "mto",
  "mt",
  "entao",
  "ta",
  "tá",
  "bom",
  "boa",
  "bem",
  "tudo",
  "de",
  "nada",
  "eu",
  "que",
  "dia",
  "tarde",
  "noite",
  "pra",
  "para",
  "voce",
  "vc",
  "voces",
  "vcs",
  "amanha",
  "la",
  "mais",
  "a",
  "o",
  "e",
  "ate",
  "logo",
  "hoje",
  "aqui",
  "por",
  "pela",
  "pelo",
  "atencao",
  "ajuda",
  "retorno",
  "sua",
  "seu",
  "ai",
  "nos",
  "vemos",
  "fico",
  "no",
  "na",
  "aguardo",
  "s",
  "deus",
  "abencoe",
  "tenha",
  "otimo",
  "semana",
]);

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|⃣/gu, " ")
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/(\p{L})\1{2,}/gu, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mensagem do cliente que encerra (não pede resposta)? Pergunta ou conteúdo novo: não. */
export function mensagemDeEncerramento(texto: string | null | undefined, tipo = "Texto"): boolean {
  if (tipo !== "Texto") return false; // áudio, foto, documento: pode pedir resposta
  const bruto = String(texto ?? "").trim();
  if (!bruto) return false;
  const t = normalizar(bruto);
  if (t.includes("?")) return false;
  if (!t) return true; // só emoji/pontuação (👍, 🙏, ❤️)
  const palavras = t.split(" ").map((p) => p.replace(/(\p{L})\1+$/u, "$1"));
  if (palavras.length > 10) return false;
  const juntas = t.replace(/\s/g, "");
  if (ENCERRAMENTO.has(juntas)) return true; // "ta bom" → "tabom"
  let temEncerramento = false;
  for (const p of palavras) {
    if (ENCERRAMENTO.has(p)) temEncerramento = true;
    else if (!COMPLEMENTO.has(p)) return false;
  }
  return temEncerramento;
}

export type MsgEspera = {
  direction: string;
  text_content?: string | null;
  message_type?: string | null;
};

/**
 * Mensagens da conversa da MAIS NOVA para a mais antiga. Espera de verdade: a última é do cliente
 * e, entre o que ele mandou depois da última resposta (equipe ou Alice), há algo que pede resposta.
 * Sem nenhuma resposta antes (cliente que acabou de chegar), conta sempre.
 */
export function esperaDeVerdade(msgsDaMaisNova: MsgEspera[]): boolean {
  if (!msgsDaMaisNova.length || msgsDaMaisNova[0]!.direction !== "Recebida") return false;
  const doCliente: MsgEspera[] = [];
  for (const m of msgsDaMaisNova) {
    if (m.direction !== "Recebida") {
      return doCliente.some(
        (c) => !mensagemDeEncerramento(c.text_content, c.message_type ?? "Texto"),
      );
    }
    doCliente.push(m);
  }
  return true;
}
