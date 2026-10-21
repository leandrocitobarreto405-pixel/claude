import { createServerFn } from "@tanstack/react-start";
import { contarNaoLidas, ehMinha } from "@/lib/caixa-equipe";
import type { Banco } from "@/lib/banco";
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
  /** Encerrada pela rotina de tempo (e não pelo botão da equipe). */
  encerradaPorTempo: boolean;
  /** Assumida por mim (pelo app ou atribuída a mim no Chatwoot). */
  minha: boolean;
  /** Mensagens do cliente que eu ainda não li. */
  naoLidas: number;
  /** Quem está com a conversa: nome no Chatwoot ou quem assumiu pelo app. */
  responsavelNome: string | null;
  assumidaPor: string | null;
};

export type MensagemConversa = {
  id: string;
  doCliente: boolean;
  texto: string;
  em: string;
  /** Mensagem enviada pelo app: "enviada" ou "falhou" (null nas demais / quando o Chatwoot não informa). */
  status: string | null;
  erro: string | null;
  /** Enviada por esta pessoa, pelo app. */
  minha: boolean;
  /** Quem mandou, para a etiqueta da bolha: cliente, Alice, você ou equipe (Chatwoot/colega). */
  remetente: "cliente" | "alice" | "voce" | "equipe";
  /** Id da mensagem no Chatwoot (casa o balão otimista do anexo com a mensagem gravada). */
  chatwootId: number | null;
  /** Tipo da mensagem (Texto, Imagem, Documento, Áudio…). */
  tipo: string | null;
};

export type ConversaCompleta = ConversaResumo & {
  iaDesligadaNoCliente: boolean;
  mensagens: MensagemConversa[];
};

const SELECT_CONVERSA = `id, status, aguardando_desde, ultima_atividade_em, url_chatwoot, crm_lead_id, encerrada_em, responsavel_id, responsavel_nome, assumida_por,
  contato:whatsapp_contact_id ( profile_name, display_phone, normalized_phone, ia_desligada ),
  lead:crm_lead_id ( lead_name, temperature, status:status_id ( name ) )`;

type LinhaConversa = {
  id: string;
  status: string | null;
  aguardando_desde: string | null;
  ultima_atividade_em: string | null;
  url_chatwoot: string | null;
  crm_lead_id: string | null;
  encerrada_em?: string | null;
  responsavel_id?: number | string | null;
  responsavel_nome?: string | null;
  assumida_por?: string | null;
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
  delivery_status?: string | null;
  erro_envio?: string | null;
  enviada_por?: string | null;
  remetente_tipo?: string | null;
  chatwoot_message_id?: number | string | null;
  origem?: string | null;
};

type Eu = { userId: string; chatwootAgentId: number | null };

function resumir(
  c: LinhaConversa,
  ultima: LinhaMensagem | undefined,
  passagem: Passagem | null,
  eu: Eu,
  naoLidas = 0,
  nomes: Map<string, string> = new Map(),
): ConversaResumo {
  const telefone = c.contato?.display_phone || c.contato?.normalized_phone || null;
  const grupo = grupoDaConversa(
    c.status,
    c.aguardando_desde,
    ultima ? ultima.direction === "Recebida" : Boolean(c.aguardando_desde),
  );
  return {
    id: c.id,
    nome: c.contato?.profile_name || c.lead?.lead_name || telefone || "Cliente",
    telefone,
    // Sem a última mensagem carregada (conversa antiga), "aguardando" já diz que o cliente espera.
    grupo,
    esperandoDesde: c.aguardando_desde,
    ultimaEm: ultima?.message_timestamp ?? c.ultima_atividade_em,
    ultimaMensagem: ultima ? textoDaMensagem(ultima.text_content, ultima.message_type) : null,
    ultimaDoCliente: ultima ? ultima.direction === "Recebida" : Boolean(c.aguardando_desde),
    passagem,
    temperatura: c.lead?.temperature ?? null,
    etapa: c.lead?.status?.name ?? null,
    leadId: c.crm_lead_id,
    urlChatwoot: c.url_chatwoot,
    encerradaPorTempo: c.status === "resolved" && Boolean(c.encerrada_em),
    minha: ehMinha(
      {
        assumidaPor: c.assumida_por ?? null,
        responsavelId: c.responsavel_id == null ? null : Number(c.responsavel_id),
        grupo,
      },
      eu,
    ),
    naoLidas,
    responsavelNome: (c.assumida_por && nomes.get(c.assumida_por)) || c.responsavel_nome || null,
    assumidaPor: c.assumida_por ?? null,
  };
}

/** Meu usuário do Chatwoot nesta empresa (para "Minhas"). */
async function quemSouEu(db: Banco, empresaId: string, userId: string): Promise<Eu> {
  const { data } = await db
    .from("usuarios_empresa")
    .select("chatwoot_agent_id")
    .eq("empresa_id", empresaId)
    .eq("user_id", userId)
    .maybeSingle();
  return { userId, chatwootAgentId: data?.chatwoot_agent_id ?? null };
}

/** Conversas dos últimos 7 dias, já separadas por aba. */
export const listarConversas = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ConversaResumo[]> => {
    const db = context.supabase;
    const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    // Últimos 7 dias; mais toda conversa com o cliente esperando resposta, por mais antiga que
    // seja (21/10: 27 clientes esperando há mais de 7 dias ficavam fora da lista).
    const [recentes, esperando] = await Promise.all([
      db
        .from("conversas")
        .select(SELECT_CONVERSA)
        .eq("empresa_id", context.empresaId)
        .gte("ultima_atividade_em", desde)
        .order("ultima_atividade_em", { ascending: false })
        .limit(150),
      db
        .from("conversas")
        .select(SELECT_CONVERSA)
        .eq("empresa_id", context.empresaId)
        .eq("status", "open")
        .not("aguardando_desde", "is", null)
        .lt("ultima_atividade_em", desde)
        .order("ultima_atividade_em", { ascending: false })
        .limit(100),
    ]);
    if (recentes.error || esperando.error)
      throw new Error("Não foi possível carregar as conversas.");
    const conversas = [
      ...((recentes.data ?? []) as unknown as LinhaConversa[]),
      ...((esperando.data ?? []) as unknown as LinhaConversa[]),
    ];
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
    const msgsPorConversa = new Map<string, LinhaMensagem[]>();
    for (const m of (msgs.data ?? []) as LinhaMensagem[]) {
      if (!ultimaPorConversa.has(m.conversa_id)) ultimaPorConversa.set(m.conversa_id, m);
      msgsPorConversa.set(m.conversa_id, [...(msgsPorConversa.get(m.conversa_id) ?? []), m]);
    }
    // Minhas e não lidas: meu usuário do Chatwoot, minhas leituras e os nomes de quem assumiu.
    const assumidas = [
      ...new Set(conversas.map((c) => c.assumida_por).filter(Boolean)),
    ] as string[];
    const [eu, leituras, perfis] = await Promise.all([
      quemSouEu(db, context.empresaId, context.userId),
      ids.length
        ? db.from("conversas_leituras").select("conversa_id, lida_em").in("conversa_id", ids)
        : Promise.resolve({ data: [] }),
      assumidas.length
        ? db.from("users_profiles").select("id, full_name").in("id", assumidas)
        : Promise.resolve({ data: [] }),
    ]);
    const lidaEm = new Map<string, string>();
    for (const l of (leituras.data ?? []) as Array<{ conversa_id: string; lida_em: string }>)
      lidaEm.set(l.conversa_id, l.lida_em);
    const nomes = new Map<string, string>();
    for (const p of (perfis.data ?? []) as Array<{ id: string; full_name: string | null }>)
      if (p.full_name) nomes.set(p.id, p.full_name);
    const execsPorConversa = new Map<string, { ferramentas: unknown }[]>();
    for (const e of (execs.data ?? []) as Array<{ conversa_id: string; ferramentas: unknown }>) {
      execsPorConversa.set(e.conversa_id, [...(execsPorConversa.get(e.conversa_id) ?? []), e]);
    }
    return conversas.map((c) =>
      resumir(
        c,
        ultimaPorConversa.get(c.id),
        precisam.includes(c.id) ? ultimaPassagem(execsPorConversa.get(c.id) ?? []) : null,
        eu,
        contarNaoLidas(msgsPorConversa.get(c.id) ?? [], lidaEm.get(c.id)),
        nomes,
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
        .select(
          "id, conversa_id, text_content, message_type, direction, message_timestamp, delivery_status, erro_envio, enviada_por, remetente_tipo, origem, chatwoot_message_id",
        )
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
    const resumo = resumir(
      c,
      lista[lista.length - 1],
      ultimaPassagem(execs.data ?? []),
      await quemSouEu(db, context.empresaId, context.userId),
    );
    return {
      ...resumo,
      iaDesligadaNoCliente: Boolean(c.contato?.ia_desligada),
      mensagens: lista.map((m) => ({
        id: m.id,
        doCliente: m.direction === "Recebida",
        texto: textoDaMensagem(m.text_content, m.message_type),
        em: m.message_timestamp,
        status: m.delivery_status ?? null,
        erro: m.erro_envio ?? null,
        minha: Boolean(m.enviada_por && m.enviada_por === context.userId),
        remetente:
          m.direction === "Recebida"
            ? "cliente"
            : m.remetente_tipo === "agent_bot"
              ? "alice"
              : m.enviada_por && m.enviada_por === context.userId
                ? "voce"
                : "equipe",
        chatwootId: m.chatwoot_message_id == null ? null : Number(m.chatwoot_message_id),
        tipo: m.message_type ?? null,
      })),
    };
  });
