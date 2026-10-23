// Cliente HTTP do Asaas (só no servidor). A chave vem de ASAAS_API_KEY (Secret Manager → Cloud
// Run) e nunca vai para log, erro ou tela: os erros dizem só o código HTTP.
import { timingSafeEqual } from "node:crypto";
import { ambienteAsaas, baseUrlAsaas } from "@/lib/asaas";

export function asaasConfigurado(): boolean {
  return Boolean(process.env["ASAAS_API_KEY"]);
}

export function ambienteAtual() {
  return ambienteAsaas(process.env["ASAAS_AMBIENTE"]);
}

async function chamar<T>(
  metodo: "GET" | "POST" | "DELETE",
  caminho: string,
  corpo?: object,
): Promise<T> {
  const chave = process.env["ASAAS_API_KEY"];
  if (!chave) throw new Error("Asaas ainda não configurado (falta a chave no Secret Manager).");
  const res = await fetch(`${baseUrlAsaas(ambienteAtual())}${caminho}`, {
    method: metodo,
    headers: {
      access_token: chave,
      "Content-Type": "application/json",
      "User-Agent": "NexaOS",
    },
    body: corpo ? JSON.stringify(corpo) : null,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) throw new Error("Asaas fora do ar ou sem resposta. Tente de novo.");
  const dados = (await res.json().catch(() => ({}))) as {
    errors?: { description?: string }[];
  } & T;
  if (!res.ok) {
    // A descrição do Asaas explica o problema (ex.: CNPJ inválido) e não tem a chave.
    const motivo = dados.errors?.[0]?.description;
    throw new Error(`Asaas recusou (HTTP ${res.status})${motivo ? `: ${motivo}` : ""}.`);
  }
  return dados;
}

/** Cliente da Nexa no Asaas (a empresa). Sem notificações do próprio Asaas (envio desligado). */
export async function criarClienteAsaas(c: {
  nome: string;
  cnpj: string | null;
  empresaId: string;
}): Promise<string> {
  const r = await chamar<{ id: string }>("POST", "/customers", {
    name: c.nome,
    cpfCnpj: c.cnpj?.replace(/\D/g, "") || undefined,
    externalReference: c.empresaId,
    notificationDisabled: true,
  });
  return r.id;
}

/** Cobrança avulsa; quem paga escolhe Pix, boleto ou cartão no link. */
export async function criarCobrancaAsaas(c: {
  clienteId: string;
  valor: number;
  vencimento: string;
  descricao: string;
  faturaId: string;
}): Promise<{ id: string; invoiceUrl: string | null; bankSlipUrl: string | null }> {
  const r = await chamar<{ id: string; invoiceUrl?: string; bankSlipUrl?: string }>(
    "POST",
    "/payments",
    {
      customer: c.clienteId,
      billingType: "UNDEFINED",
      value: c.valor,
      dueDate: c.vencimento,
      description: c.descricao,
      externalReference: c.faturaId,
    },
  );
  return { id: r.id, invoiceUrl: r.invoiceUrl ?? null, bankSlipUrl: r.bankSlipUrl ?? null };
}

export async function apagarCobrancaAsaas(id: string): Promise<void> {
  await chamar("DELETE", `/payments/${encodeURIComponent(id)}`);
}

/** O cabeçalho asaas-access-token confere com ASAAS_WEBHOOK_TOKEN? (comparação em tempo fixo) */
export function avisoAutorizado(recebido: string | null): boolean {
  const esperado = process.env["ASAAS_WEBHOOK_TOKEN"];
  if (!esperado || !recebido) return false;
  const a = Buffer.from(esperado);
  const b = Buffer.from(recebido);
  return a.length === b.length && timingSafeEqual(a, b);
}
