/**
 * Devolver a conversa para a Alice (28/10, todas as empresas): pelo botão, pela nota #alice ou
 * quando a parada da IA termina. Se a última mensagem (fora as notas internas) é do cliente e
 * ninguém respondeu depois, a Alice responde na hora, lendo a conversa toda; se é nossa, ela
 * espera a próxima do cliente. Quem esperou mais de 10 minutos recebe um pedido de desculpa
 * natural pela demora, sem falar de erro técnico. A Alice responde 24 h: o horário configurado
 * dela só vale para os toques que ela mesma inicia. Funções puras.
 */

export const ESPERA_PEDE_DESCULPA_MIN = 10;

/** A última mensagem que o cliente vê é dele (ninguém respondeu depois)? */
export function clienteEsperando(ultima: { direction: string } | null | undefined): boolean {
  return ultima?.direction === "Recebida";
}

export function notaDevolucao(nome: string, respondeAgora: boolean, origem = ""): string {
  const de = origem ? ` ${origem}` : "";
  return respondeAgora
    ? `🤖 Conversa devolvida para a ${nome}${de}. Ela vai responder agora.`
    : `🤖 Conversa devolvida para a ${nome}${de}. Ela responde a próxima mensagem do cliente.`;
}

export function notaRetomada(nome: string): string {
  return `🤖 A ${nome} voltou a responder e retomou esta conversa, que ficou sem resposta durante a pausa. Ela vai responder agora.`;
}

/** "12 min", "2 h", "3 h 10 min". */
function espera(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

/**
 * Instrução só desta resposta quando o cliente esperou: pedir desculpa pela demora, de forma
 * natural. null se a espera foi curta (resposta normal).
 */
export function instrucaoDemora(ultimaDoCliente: string | null, agora: Date): string | null {
  if (!ultimaDoCliente) return null;
  const min = Math.floor((agora.getTime() - Date.parse(ultimaDoCliente)) / 60_000);
  if (!(min >= ESPERA_PEDE_DESCULPA_MIN)) return null;
  return `O cliente está esperando resposta há ${espera(min)}. Leia a conversa toda e responda a última mensagem dele. Comece com um pedido de desculpa curto e natural pela demora (ex.: "Oi! Desculpa a demora 🙏"), sem falar de erro, sistema, problema técnico ou pausa, e siga o atendimento normalmente.`;
}
