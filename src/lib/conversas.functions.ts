import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import {
  grupoDaConversa,
  textoDaMensagem,
  ultimaPassagem,
  type GrupoConversa,
  type Passagem,
} from "@/lib/conversas";

// Leitura das conversas do WhatsApp (só leitura, dados da empresa ativa pelo RLS).
// Responder fica no WhatsApp/Chatwoot por enquanto; as ações de Assumir/Devolver usam as
// funções que já existem em alice.functions.

export type ConversaResumo = {
  id: string;
  nome: string;
  telefone: string | null;
  grupo: GrupoConversa;
  /** Desde quando o cliente espera resposta da equipe. */
  esperandoDesde: string | null;
  ultimaEm: string | null;
  ultimaMensagem: string | null;
  /** A última mensagem foi do cliente. */
  ultimaDoCliente: boolean;
  /** Por que a Alice passou para a equipe (só nas que precisam de você). */
  passagem: Passagem | null;
  temperatura: string | null;
  etapa: string | null;
  leadId: string | null;
  urlChatwoot: string | null;
};

export type MensagemConversa = {
  id: string;
  doCliente: boolean;
  texto: string;
  em: string;
};

export type ConversaCompleta = ConversaResumo & {
  iaDesligadaNoCliente: boolean;
  mensagens: MensagemConversa[];
};

const SELECT_CONVERSA = `id, status, aguardando_desde, ultima_atividade_em, url_chatwoot, crm_lead_id,
  contato:whatsapp_contact_id ( profile_name, display_phone, normalized_phone, ia_desligada ),
  lead:crm_lead_id ( lead_name, temperature, status:status_id ( name ) )`;

type LinhaConversa = {
  id: string;
  status: string | null;
  aguardando_desde: string | null;
  ultima_atividade_em: string | null;
  url_chatwoot: string | null;
  crm_lead_id: string | null;
  contato: {
    profile_name: string | null;
    display_phone: string | null;
    normalized_phone: string | null;
    ia_desligada: boolean | null;
  } | null;
  lead: {
    lead_name: string | null;
    temperature: string | null;
    status: { name: string } | null;
  } | null;
};

type LinhaMensagem = {
  id: string;
  conversa_id: string;
  text_content: string | null;
  message_type: string | null;
  direction: string;
  message_timestamp: string;
};

function resumir(
  c: LinhaConversa,
  ultima: LinhaMensagem | undefined,
  passagem: Passagem | null,
): ConversaResumo {
  const telefone = c.contato?.display_phone || c.contato?.normalized_phone || null;
  return {
    id: c.id,
    nome: c.contato?.profile_name || c.lead?.lead_name || telefone || "Cliente",
    telefone,
    grupo: grupoDaConversa(c.status, c.aguardando_desde),
    esperandoDesde: c.aguardando_desde,
    ultimaEm: ultima?.message_timestamp ?? c.ultima_atividade_em,
    ultimaMensagem: ultima ? textoDaMensagem(ultima.text_content, ultima.message_type) : null,
    ultimaDoCliente: ultima?.direction === "Recebida",
    passagem,
    temperatura: c.lead?.temperature ?? null,
    etapa: c.lead?.status?.name ?? null,
    leadId: c.crm_lead_id,
    urlChatwoot: c.url_chatwoot,
  };
}

/** Conversas dos últimos 7 dias, já separadas por aba. */
export const listarConversas = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ConversaResumo[]> => {
    const db = context.supabase;
    const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await db
      .from("conversas")
      .select(SELECT_CONVERSA)
      .eq("empresa_id", context.empresaId)
      .gte("ultima_atividade_em", desde)
      .order("ultima_atividade_em", { ascending: false })
      .limit(150);
    if (error) throw new Error("Não foi possível carregar as conversas.");
    const conversas = (data ?? []) as unknown as LinhaConversa[];
    const ids = conversas.map((c) => c.id);
    const precisam = conversas
      .filter((c) => grupoDaConversa(c.status, c.aguardando_desde) === "precisam")
      .map((c) => c.id);

    const [msgs, execs] = await Promise.all([
      ids.length
        ? db
            .from("whatsapp_messages")
            .select("id, conversa_id, text_content, message_type, direction, message_timestamp")
            .in("conversa_id", ids)
            .eq("privada", false)
            .gte("message_timestamp", desde)
            .order("message_timestamp", { ascending: false })
            .limit(1500)
        : Promise.resolve({ data: [] }),
      precisam.length
        ? db
            .from("ia_execucoes")
            .select("conversa_id, ferramentas, created_at")
            .in("conversa_id", precisam)
            .order("created_at", { ascending: false })
            .limit(300)
        : Promise.resolve({ data: [] }),
    ]);
    const ultimaPorConversa = new Map<string, LinhaMensagem>();
    for (const m of (msgs.data ?? []) as LinhaMensagem[]) {
      if (!ultimaPorConversa.has(m.conversa_id)) ultimaPorConversa.set(m.conversa_id, m);
    }
    const execsPorConversa = new Map<string, { ferramentas: unknown }[]>();
    for (const e of (execs.data ?? []) as Array<{ conversa_id: string; ferramentas: unknown }>) {
      execsPorConversa.set(e.conversa_id, [...(execsPorConversa.get(e.conversa_id) ?? []), e]);
    }
    return conversas.map((c) =>
      resumir(
        c,
        ultimaPorConversa.get(c.id),
        precisam.includes(c.id) ? ultimaPassagem(execsPorConversa.get(c.id) ?? []) : null,
      ),
    );
  });

/** Uma conversa com as últimas mensagens (mais antigas primeiro). */
export const lerConversa = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { conversaId: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(input.conversaId)) throw new Error("Conversa inválida.");
    return input;
  })
  .handler(async ({ data, context }): Promise<ConversaCompleta> => {
    const db = context.supabase;
    const { data: linha, error } = await db
      .from("conversas")
      .select(SELECT_CONVERSA)
      .eq("id", data.conversaId)
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a conversa.");
    if (!linha) throw new Error("Conversa não encontrada.");
    const c = linha as unknown as LinhaConversa;
    const [msgs, execs] = await Promise.all([
      db
        .from("whatsapp_messages")
        .select("id, conversa_id, text_content, message_type, direction, message_timestamp")
        .eq("conversa_id", c.id)
        .eq("privada", false)
        .order("message_timestamp", { ascending: false })
        .limit(150),
      db
        .from("ia_execucoes")
        .select("ferramentas, created_at")
        .eq("conversa_id", c.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const lista = ((msgs.data ?? []) as LinhaMensagem[]).slice().reverse();
    const resumo = resumir(c, lista[lista.length - 1], ultimaPassagem(execs.data ?? []));
    return {
      ...resumo,
      iaDesligadaNoCliente: Boolean(c.contato?.ia_desligada),
      mensagens: lista.map((m) => ({
        id: m.id,
        doCliente: m.direction === "Recebida",
        texto: textoDaMensagem(m.text_content, m.message_type),
        em: m.message_timestamp,
      })),
    };
  });
