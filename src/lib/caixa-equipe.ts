/**
 * Regras puras da equipe na caixa de entrada (sem banco): quem está com a conversa ("Minhas"),
 * não lidas, o ritmo do "digitando…" e a presença de colegas na mesma conversa.
 */

export type Eu = {
  userId: string;
  chatwootAgentId: number | null;
  /** Ids da Alice (agent_bot) no Chatwoot: atribuição ao robô não conta como pessoa. */
  botIds?: Iterable<number>;
  /** Usuário do app de cada agente do Chatwoot (quem tem ligação em Equipe e acessos). */
  usuarioDoAgente?: Map<number, string>;
};

export type Posse = "eu" | "outra" | "ninguem";

/**
 * Quem está com a conversa, pelas duas fontes (que têm que bater):
 *  - a atribuição do Chatwoot (responsavel_id), quando há uma pessoa lá;
 *  - senão, quem assumiu pelo app (assumida_por).
 * Assumir pelo app sem usuário no Chatwoot tira a atribuição de lá, então a do Chatwoot, quando
 * existe, é sempre a mais recente. Encerradas e com a Alice: ninguém.
 */
export function quemEstaCom(
  c: { assumidaPor: string | null; responsavelId: number | null; grupo: string },
  eu: Eu,
): Posse {
  if (c.grupo === "finalizadas" || c.grupo === "alice") return "ninguem";
  const bots = new Set(eu.botIds ?? []);
  if (c.responsavelId != null && !bots.has(c.responsavelId))
    return eu.chatwootAgentId != null && c.responsavelId === eu.chatwootAgentId ? "eu" : "outra";
  if (c.assumidaPor) return c.assumidaPor === eu.userId ? "eu" : "outra";
  return "ninguem";
}

/**
 * Desde quando quem está com a conversa está com ela: a hora em que assumiu pelo app, quando a
 * atribuição do Chatwoot é dessa mesma pessoa (ou não há atribuição). Atribuída só no Chatwoot,
 * não se sabe a hora.
 */
export function desdeQuando(
  c: { assumidaPor: string | null; assumidaEm: string | null; responsavelId: number | null },
  eu: Eu,
): string | null {
  if (!c.assumidaPor || !c.assumidaEm) return null;
  const bots = new Set(eu.botIds ?? []);
  if (c.responsavelId == null || bots.has(c.responsavelId)) return c.assumidaEm;
  return eu.usuarioDoAgente?.get(c.responsavelId) === c.assumidaPor ? c.assumidaEm : null;
}

/** A conversa é minha: assumi pelo app ou está atribuída ao meu usuário do Chatwoot. */
export function ehMinha(
  c: { assumidaPor: string | null; responsavelId: number | null; grupo: string },
  eu: Eu,
): boolean {
  return quemEstaCom(c, eu) === "eu";
}

/** Mensagens do cliente depois da última leitura desta pessoa (sem leitura: todas). */
export function contarNaoLidas(
  mensagens: Array<{ direction: string; message_timestamp: string }>,
  lidaEm: string | null | undefined,
): number {
  const limite = lidaEm ? new Date(lidaEm).getTime() : 0;
  let n = 0;
  for (const m of mensagens)
    if (m.direction === "Recebida" && new Date(m.message_timestamp).getTime() > limite) n++;
  return n;
}

/** Intervalo mínimo entre dois avisos de "digitando…" para a mesma conversa. */
export const INTERVALO_DIGITANDO_MS = 20_000;

/** Decide se vale mandar outro aviso de "digitando…" agora. */
export function podeAvisarDigitando(ultimoEnvioMs: number | null, agoraMs: number): boolean {
  return ultimoEnvioMs == null || agoraMs - ultimoEnvioMs >= INTERVALO_DIGITANDO_MS;
}

/**
 * Presença: quem está com a conversa aberta na tela agora. Cada pessoa avisa "aqui" ao abrir e
 * a cada 25 s, e "saiu" ao fechar; sem aviso novo em 70 s, some (celular travado, aba fechada).
 */
export const INTERVALO_PRESENCA_MS = 25_000;
export const PRESENCA_EXPIRA_MS = 70_000;

export type Presenca = { userId: string; nome: string; vistoMs: number };

export type AvisoPresenca = {
  conversaId: string;
  userId: string;
  nome: string;
  estado: "aqui" | "saiu";
};

/** Aplica um aviso à lista de presentes de uma conversa (uma entrada por pessoa). */
export function aplicarPresenca(
  lista: Presenca[],
  aviso: AvisoPresenca,
  agoraMs: number,
): Presenca[] {
  const semEla = lista.filter((p) => p.userId !== aviso.userId);
  if (aviso.estado === "saiu") return semEla;
  return [...semEla, { userId: aviso.userId, nome: aviso.nome, vistoMs: agoraMs }];
}

/** Colegas (sem mim) vistos há menos de 70 s. */
export function colegasPresentes(lista: Presenca[], meuId: string, agoraMs: number): Presenca[] {
  return lista.filter((p) => p.userId !== meuId && agoraMs - p.vistoMs < PRESENCA_EXPIRA_MS);
}

/** Primeiro nome, para faixas e botões. */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? "").trim().split(/\s+/)[0] || "Colega";
}
