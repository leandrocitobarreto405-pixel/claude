/**
 * Encerramento automático de conversas (regras puras, sem banco): conversa sem mensagem há N
 * horas vai para Encerradas no Nexa e "resolved" no Chatwoot. Se o cliente escrever depois, o
 * Chatwoot reabre e o webhook atualiza o app. Começa DESLIGADO em toda empresa.
 */
export type ConfigEncerramento = {
  ligado: boolean;
  /** Horas sem mensagem (de 1 a 720). */
  horas: number;
  /** Também encerra as conversas que estão com a Alice (status "pending"). */
  incluirAlice: boolean;
};

export const PADRAO_ENCERRAMENTO: ConfigEncerramento = {
  ligado: false,
  horas: 24,
  incluirAlice: false,
};

export const CHAVE_CONFIG_CAIXA = "caixa_entrada";

/** Lê o que está salvo em app_settings "caixa_entrada" (parcial ou vazio) com os padrões. */
export function configEncerramento(salvo: unknown): ConfigEncerramento {
  const s = (salvo && typeof salvo === "object" ? salvo : {}) as Record<string, unknown>;
  const horas = Number(s["encerramento_horas"]);
  return {
    ligado: s["encerramento_automatico"] === true,
    horas: Number.isFinite(horas) && horas >= 1 && horas <= 720 ? Math.round(horas) : 24,
    incluirAlice: s["encerramento_inclui_alice"] === true,
  };
}

/** O que gravar em app_settings (junto com o que já houver na chave). */
export function paraSalvar(c: ConfigEncerramento): Record<string, unknown> {
  return {
    encerramento_automatico: c.ligado,
    encerramento_horas: c.horas,
    encerramento_inclui_alice: c.incluirAlice,
  };
}

/** Situações que o encerramento alcança. */
export function situacoesAlcancadas(c: ConfigEncerramento): string[] {
  return c.incluirAlice ? ["open", "pending"] : ["open"];
}

/** Instante-limite: conversas com última atividade antes disto estão paradas. */
export function limiteParada(c: ConfigEncerramento, agora = new Date()): string {
  return new Date(agora.getTime() - c.horas * 3_600_000).toISOString();
}
