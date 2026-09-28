/**
 * Chamadas à API do Chatwoot usadas pela Alice. O token do robô (agent bot) envia as mensagens
 * como "Alice"; o token de API da conta (administrador) cria o robô e o liga às caixas de entrada.
 */

export type Conta = { baseUrl: string; accountId: number };

async function chamar<T>(
  conta: Conta,
  token: string,
  caminho: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${conta.baseUrl.replace(/\/+$/, "")}/api/v1/accounts/${conta.accountId}${caminho}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { api_access_token: token, "Content-Type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(
      `Chatwoot ${init.method ?? "GET"} ${caminho} falhou (${res.status}): ${texto.slice(0, 300)}`,
    );
  }
  if (res.status === 204) return {} as T;
  const texto = await res.text();
  return (texto ? JSON.parse(texto) : {}) as T;
}

export function enviarMensagem(
  conta: Conta,
  token: string,
  conversa: number,
  conteudo: string,
  privada = false,
) {
  return chamar<{ id: number }>(conta, token, `/conversations/${conversa}/messages`, {
    method: "POST",
    body: { content: conteudo, message_type: "outgoing", private: privada },
  });
}

/** "open" = atendimento humano; "pending" = com o robô. */
export function mudarSituacao(
  conta: Conta,
  token: string,
  conversa: number,
  situacao: "open" | "pending",
) {
  return chamar(conta, token, `/conversations/${conversa}/toggle_status`, {
    method: "POST",
    body: { status: situacao },
  });
}

export function criarRobo(conta: Conta, tokenAdmin: string, nome: string, urlRetorno: string) {
  return chamar<{ id: number; access_token?: string }>(conta, tokenAdmin, "/agent_bots", {
    method: "POST",
    body: {
      name: nome,
      description: "Vendedora de IA do Nexa OS",
      outgoing_url: urlRetorno,
      bot_type: 0,
    },
  });
}

/** Liga (ou desliga, com null) o robô numa caixa de entrada. */
export function ligarRoboNaCaixa(
  conta: Conta,
  tokenAdmin: string,
  caixa: number,
  robo: number | null,
) {
  return chamar(conta, tokenAdmin, `/inboxes/${caixa}/set_agent_bot`, {
    method: "POST",
    body: { agent_bot: robo },
  });
}
