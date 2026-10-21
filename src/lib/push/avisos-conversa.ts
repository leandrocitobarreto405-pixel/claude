/**
 * Avisos no celular disparados pelo webhook (item 5), na hora em que a mensagem do cliente é
 * gravada. Regras puras, sem banco:
 *  - conversa sem ninguém da equipe (esperando em "Precisam"): "Conversa nova para a equipe"
 *    para admin e atendente, uma vez por espera (a rotina "Cliente esperando" continua depois);
 *  - conversa com alguém (assumida pelo app ou atribuída no Chatwoot): "Cliente respondeu a sua
 *    conversa", só para essa pessoa, uma vez por espera;
 *  - quem está com a conversa aberta na tela agora não recebe; conversa com a Alice (pending),
 *    encerrada, mensagem da empresa ou nota privada: nada. Nada vai ao cliente.
 */
import type { Papel } from "@/lib/tenant";
import type { Notificacao } from "./notificacoes";

/** Quem está na tela conta como "vendo" se avisou presença há menos de 70 s. */
export const VENDO_HA_MS = 70_000;

export type MensagemChegada = {
  conversaId: string;
  mensagemId: string;
  direction: string;
  privada: boolean;
  texto: string;
  clienteNome: string;
  status: string | null;
  /** Começo da espera atual (waiting_since do Chatwoot); sem ele, a mensagem identifica a espera. */
  aguardandoDesde: string | null;
  /** Alguém da equipe está com a conversa (assumida pelo app ou atribuída no Chatwoot). */
  comAlguem: boolean;
  /** Usuário do app dessa pessoa (null quando é alguém do Chatwoot sem usuário no app). */
  responsavelUserId: string | null;
};

export type PessoaPush = { userId: string; papel: Papel; clienteEsperando: boolean };

export type AvisoConversa = { userId: string; ref: string; n: Notificacao };

function resumo(texto: string, max = 90): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Decide quem recebe o quê por uma mensagem recém-gravada. `vendoEm` é a última presença de
 * cada pessoa nesta conversa (lida_em renovado a cada 25 s enquanto a tela está aberta).
 */
export function avisosDaMensagem(
  m: MensagemChegada,
  pessoas: PessoaPush[],
  vendoEm: Map<string, string>,
  agora = new Date(),
): AvisoConversa[] {
  if (m.direction !== "Recebida" || m.privada) return [];
  if (m.status !== "open") return [];
  const espera = m.aguardandoDesde ?? m.mensagemId;
  const t = agora.getTime();
  const vendo = (userId: string) => {
    const em = vendoEm.get(userId);
    return em != null && t - Date.parse(em) < VENDO_HA_MS;
  };
  const corpo = `${m.clienteNome}: ${resumo(m.texto)}`;
  const url = `/conversas/${m.conversaId}`;
  const tag = `conversa-${m.conversaId}`;
  if (m.comAlguem) {
    const p = pessoas.find((x) => x.userId === m.responsavelUserId);
    if (!p || !p.clienteEsperando || vendo(p.userId)) return [];
    return [
      {
        userId: p.userId,
        ref: `resp:${m.conversaId}:${espera}`,
        n: { titulo: "Cliente respondeu a sua conversa", corpo, url, tag },
      },
    ];
  }
  return pessoas
    .filter((p) => (p.papel === "admin" || p.papel === "atendente") && p.clienteEsperando)
    .filter((p) => !vendo(p.userId))
    .map((p) => ({
      userId: p.userId,
      ref: `nova:${m.conversaId}:${espera}`,
      n: { titulo: "Conversa nova para a equipe", corpo, url, tag },
    }));
}
