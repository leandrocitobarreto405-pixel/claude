/**
 * Chamadas ao Chatwoot usadas pelo marketing.
 *
 * Tokens: contatos (buscar, criar, etiquetas) só com o token de API da conta (administrador);
 * conversa, mensagem, etiqueta da conversa e prioridade com o token do robô da Alice, para que o
 * disparo não conte como "humano assumiu" (mensagem de usuário) na conversa.
 */
import { chamar, type Conta } from "@/lib/alice/chatwoot-api.server";
import type { ModeloMeta } from "./modelos";

export type ContatoChatwoot = { id: number; sourceId: string | null };

/** Chave do telefone: DDD + últimos 8 dígitos (o WhatsApp manda alguns celulares sem o 9). */
export function chaveTelefone(fone: string) {
  const d = fone.replace(/\D/g, "");
  const n = d.length <= 11 ? `55${d}` : d;
  return `${n.slice(2, 4)}${n.slice(-8)}`;
}

type CaixaChatwoot = { id: number; channel_type?: string; message_templates?: ModeloMeta[] };

export async function modelosDaCaixa(conta: Conta, tokenAdmin: string, caixa: number) {
  const r = await chamar<CaixaChatwoot>(conta, tokenAdmin, `/inboxes/${caixa}`);
  return r.message_templates ?? [];
}

type ContatoApi = {
  id: number;
  phone_number?: string | null;
  contact_inboxes?: Array<{ source_id: string; inbox?: { id: number } }>;
};

function sourceDaCaixa(c: ContatoApi, caixa: number) {
  return c.contact_inboxes?.find((ci) => ci.inbox?.id === caixa)?.source_id ?? null;
}

/**
 * Acha o contato pelo telefone (com ou sem o 9º dígito) ou cria com o primeiro nome. Garante o
 * vínculo com a caixa do WhatsApp (source_id = telefone sem o +).
 */
export async function garantirContato(
  conta: Conta,
  tokenAdmin: string,
  caixa: number,
  fone: string,
  primeiroNome: string | null,
  idConhecido: number | null,
): Promise<ContatoChatwoot> {
  const chave = chaveTelefone(fone);
  let contato: ContatoApi | null = null;
  if (idConhecido) {
    contato = await chamar<{ payload: ContatoApi }>(conta, tokenAdmin, `/contacts/${idConhecido}`)
      .then((r) => r.payload ?? null)
      .catch(() => null);
  }
  if (!contato) {
    const busca = await chamar<{ payload?: ContatoApi[] }>(
      conta,
      tokenAdmin,
      `/contacts/search?q=${encodeURIComponent(fone.slice(-8))}&include_contact_inboxes=true`,
    );
    contato =
      (busca.payload ?? []).find(
        (c) => c.phone_number && chaveTelefone(c.phone_number) === chave,
      ) ?? null;
  }
  if (!contato) {
    const criado = await chamar<{
      payload?: { contact?: ContatoApi; contact_inbox?: { source_id: string } };
    }>(conta, tokenAdmin, "/contacts", {
      method: "POST",
      body: {
        inbox_id: caixa,
        // Primeiro nome só (é o que aparece para a equipe e no {{contact.name}}).
        ...(primeiroNome ? { name: primeiroNome } : {}),
        phone_number: `+${fone}`,
      },
    });
    const c = criado.payload?.contact;
    if (!c?.id) throw new Error("Chatwoot não devolveu o contato criado");
    return { id: c.id, sourceId: criado.payload?.contact_inbox?.source_id ?? null };
  }
  let sourceId = sourceDaCaixa(contato, caixa);
  if (!sourceId) {
    const ci = await chamar<{ source_id?: string }>(
      conta,
      tokenAdmin,
      `/contacts/${contato.id}/contact_inboxes`,
      { method: "POST", body: { inbox_id: caixa, source_id: fone } },
    );
    sourceId = ci.source_id ?? fone;
  }
  return { id: contato.id, sourceId };
}

/** Conversa mais recente do contato nesta caixa (para não abrir outra a cada mensagem). */
export async function conversaExistente(
  conta: Conta,
  tokenAdmin: string,
  contato: number,
  caixa: number,
): Promise<number | null> {
  const r = await chamar<{
    payload?: Array<{ id: number; inbox_id: number; last_activity_at?: number }>;
  }>(conta, tokenAdmin, `/contacts/${contato}/conversations`);
  const daCaixa = (r.payload ?? [])
    .filter((c) => c.inbox_id === caixa)
    .sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0));
  return daCaixa[0]?.id ?? null;
}

export async function criarConversa(
  conta: Conta,
  tokenRobo: string,
  caixa: number,
  contato: ContatoChatwoot,
  fone: string,
  situacao: "pending" | "open",
) {
  const r = await chamar<{ id: number }>(conta, tokenRobo, "/conversations", {
    method: "POST",
    body: {
      inbox_id: caixa,
      contact_id: contato.id,
      source_id: contato.sourceId ?? fone,
      status: situacao,
    },
  });
  if (!r.id) throw new Error("Chatwoot não devolveu a conversa criada");
  return r.id;
}

export function enviarModelo(
  conta: Conta,
  tokenRobo: string,
  conversa: number,
  texto: string,
  templateParams: Record<string, unknown>,
) {
  return chamar<{ id: number }>(conta, tokenRobo, `/conversations/${conversa}/messages`, {
    method: "POST",
    body: {
      content: texto,
      message_type: "outgoing",
      private: false,
      template_params: templateParams,
    },
  });
}

/** Etiquetas da conversa: a API troca a lista inteira, então lê, junta e grava. */
export async function etiquetarConversa(
  conta: Conta,
  token: string,
  conversa: number,
  adicionar: string[],
  remover: (e: string) => boolean = () => false,
) {
  const atual = await chamar<{ payload?: string[] }>(
    conta,
    token,
    `/conversations/${conversa}/labels`,
  );
  const lista = [...new Set([...(atual.payload ?? []).filter((e) => !remover(e)), ...adicionar])];
  await chamar(conta, token, `/conversations/${conversa}/labels`, {
    method: "POST",
    body: { labels: lista },
  });
}

export async function etiquetarContato(
  conta: Conta,
  tokenAdmin: string,
  contato: number,
  adicionar: string[],
  remover: (e: string) => boolean = () => false,
) {
  const atual = await chamar<{ payload?: string[] }>(
    conta,
    tokenAdmin,
    `/contacts/${contato}/labels`,
  );
  const lista = [...new Set([...(atual.payload ?? []).filter((e) => !remover(e)), ...adicionar])];
  await chamar(conta, tokenAdmin, `/contacts/${contato}/labels`, {
    method: "POST",
    body: { labels: lista },
  });
}

export function prioridadeUrgente(conta: Conta, token: string, conversa: number) {
  return chamar(conta, token, `/conversations/${conversa}/toggle_priority`, {
    method: "POST",
    body: { priority: "urgent" },
  });
}
