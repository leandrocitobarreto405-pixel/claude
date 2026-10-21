/**
 * Caixa de entrada no app: responder uma conversa pelo Nexa OS, pelo Chatwoot (o cano continua o
 * mesmo; nada vai direto à Meta). A caixa é sempre a da conversa (conexao_id), nunca a "empresa
 * ativa". O token do Chatwoot só vive aqui, no servidor.
 *
 * Dentro da janela de 24 h: texto livre. Fora dela: só modelo aprovado (template_params).
 * A mensagem enviada é gravada na hora em whatsapp_messages (com quem enviou) e, quando o webhook
 * do próprio envio voltar, cai na mesma linha (chave empresa + chatwoot_message_id).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import {
  janelaDeResposta,
  modelosParaResponder,
  podeResponder,
  primeiroNomeDoContato,
  situacaoParaResponder,
  validarTexto,
  type Janela,
  type ModeloParaResponder,
} from "@/lib/caixa";
import type { Banco } from "@/lib/banco";
import type { Papel } from "@/lib/tenant";

const ID = /^[0-9a-f-]{36}$/i;
const validarConversa = (i: { conversaId: string }) => {
  if (!ID.test(String(i?.conversaId ?? ""))) throw new Error("Conversa inválida.");
  return { conversaId: i.conversaId };
};

type Contexto = { supabase: Banco; empresaId: string; userId: string };

async function papelDe(ctx: Contexto): Promise<Papel | null> {
  const { data } = await ctx.supabase.rpc("meu_papel" as never);
  return (data as Papel | null) ?? null;
}

type Envio = {
  conversa: {
    id: string;
    chatwoot_conversation_id: number;
    conexao_id: string;
    inbox_id: number | null;
    status: string | null;
    whatsapp_contact_id: string | null;
    crm_lead_id: string | null;
  };
  conta: { baseUrl: string; accountId: number };
  token: string;
  primeiroNome: string | null;
  ultimaDoCliente: string | null;
};

/** Conversa (pelo RLS da pessoa) + conexão e token (só o servidor lê os segredos). */
async function dadosDoEnvio(ctx: Contexto, conversaId: string): Promise<Envio> {
  if (!podeResponder(await papelDe(ctx)))
    throw new Error("Só admin e atendente respondem pelo app.");
  const { data: conv } = await ctx.supabase
    .from("conversas")
    .select(
      "id, chatwoot_conversation_id, conexao_id, inbox_id, status, whatsapp_contact_id, crm_lead_id, contato:whatsapp_contact_id ( profile_name )",
    )
    .eq("id", conversaId)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (!conv) throw new Error("Conversa não encontrada.");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const [{ data: cx }, { data: sg }, { data: ultima }] = await Promise.all([
    db
      .from("chatwoot_conexoes")
      .select("base_url, account_id, ativo")
      .eq("id", conv.conexao_id)
      .maybeSingle(),
    db
      .from("chatwoot_conexao_segredos")
      .select("api_token")
      .eq("conexao_id", conv.conexao_id)
      .maybeSingle(),
    ctx.supabase
      .from("whatsapp_messages")
      .select("message_timestamp")
      .eq("conversa_id", conv.id)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!cx?.ativo || !sg?.api_token)
    throw new Error("A conexão do Chatwoot desta conversa está sem token de API.");
  const contato = conv.contato as { profile_name: string | null } | null;
  return {
    conversa: conv,
    conta: { baseUrl: cx.base_url, accountId: Number(cx.account_id) },
    token: sg.api_token,
    primeiroNome: primeiroNomeDoContato(contato?.profile_name),
    ultimaDoCliente: ultima?.message_timestamp ?? null,
  };
}

/** Grava a mensagem enviada e atualiza a conversa (o cliente não está mais esperando). */
async function registrarEnvio(
  ctx: Contexto,
  e: Envio,
  chatwootMessageId: number,
  texto: string,
  tipo: string,
  reabre: boolean,
) {
  const agora = new Date().toISOString();
  if (e.conversa.whatsapp_contact_id) {
    const { error } = await ctx.supabase.from("whatsapp_messages").insert({
      empresa_id: ctx.empresaId,
      whatsapp_contact_id: e.conversa.whatsapp_contact_id,
      crm_lead_id: e.conversa.crm_lead_id,
      conversa_id: e.conversa.id,
      chatwoot_message_id: chatwootMessageId,
      direction: "Enviada",
      message_type: tipo,
      text_content: texto,
      message_timestamp: agora,
      remetente_tipo: "user",
      privada: false,
      origem: "nexa",
      enviada_por: ctx.userId,
      delivery_status: "enviada",
    });
    // 23505: o webhook do próprio envio chegou antes e já gravou a linha.
    if (error && error.code !== "23505")
      console.error("Caixa: mensagem não gravada", error.message);
    if (error?.code === "23505")
      await ctx.supabase
        .from("whatsapp_messages")
        .update({ enviada_por: ctx.userId, origem: "nexa", delivery_status: "enviada" })
        .eq("empresa_id", ctx.empresaId)
        .eq("chatwoot_message_id", chatwootMessageId);
  }
  await ctx.supabase
    .from("conversas")
    .update({
      aguardando_desde: null,
      ultima_atividade_em: agora,
      ...(reabre ? { status: "open" } : {}),
    })
    .eq("id", e.conversa.id);
}

export type EstadoResposta = {
  janela: Janela;
  situacao: ReturnType<typeof situacaoParaResponder>;
  podeResponder: boolean;
};

/** O que a barra de resposta mostra: janela aberta (texto) ou fechada (modelos), e se pode. */
export const estadoRespostaFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator(validarConversa)
  .handler(async ({ data, context }): Promise<EstadoResposta> => {
    const ctx = context as unknown as Contexto;
    const papel = await papelDe(ctx);
    const { data: conv } = await ctx.supabase
      .from("conversas")
      .select("id, status")
      .eq("id", data.conversaId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();
    if (!conv) throw new Error("Conversa não encontrada.");
    const { data: ultima } = await ctx.supabase
      .from("whatsapp_messages")
      .select("message_timestamp")
      .eq("conversa_id", conv.id)
      .eq("direction", "Recebida")
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      janela: janelaDeResposta(ultima?.message_timestamp ?? null),
      situacao: situacaoParaResponder(conv.status),
      podeResponder: podeResponder(papel),
    };
  });

/** Texto livre, só dentro da janela de 24 h. */
export const enviarTextoFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { conversaId: string; texto: string }) => ({
    ...validarConversa(i),
    texto: validarTexto(i.texto),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Contexto;
    const e = await dadosDoEnvio(ctx, data.conversaId);
    const situacao = situacaoParaResponder(e.conversa.status);
    if (!situacao.pode)
      throw new Error("Assuma a conversa antes de responder (ela está com a Alice).");
    const janela = janelaDeResposta(e.ultimaDoCliente);
    if (!janela.aberta)
      throw new Error("Passou 24 h desde a última mensagem do cliente: use um modelo aprovado.");
    const { enviarMensagem, mudarSituacao } = await import("@/lib/alice/chatwoot-api.server");
    let id: number;
    try {
      ({ id } = await enviarMensagem(
        e.conta,
        e.token,
        e.conversa.chatwoot_conversation_id,
        data.texto,
      ));
    } catch (err) {
      console.error("Caixa: envio falhou", err instanceof Error ? err.message : err);
      throw new Error("O WhatsApp não aceitou a mensagem agora. Tente de novo.");
    }
    if (situacao.reabre)
      await mudarSituacao(e.conta, e.token, e.conversa.chatwoot_conversation_id, "open").catch(
        () => undefined,
      );
    await registrarEnvio(ctx, e, id, data.texto, "Texto", situacao.reabre);
    return { ok: true, chatwootMessageId: id };
  });

/** Modelos aprovados da caixa desta conversa, já preenchidos com o nome do cliente. */
export const modelosParaResponderFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator(validarConversa)
  .handler(async ({ data, context }): Promise<ModeloParaResponder[]> => {
    const ctx = context as unknown as Contexto;
    const e = await dadosDoEnvio(ctx, data.conversaId);
    if (!e.conversa.inbox_id) return [];
    const { modelosDaCaixa } = await import("@/lib/mkt/chatwoot.server");
    const modelos = await modelosDaCaixa(e.conta, e.token, e.conversa.inbox_id).catch(() => []);
    return modelosParaResponder(modelos, e.primeiroNome);
  });

/** Modelo aprovado (fora da janela de 24 h). O texto gravado é o que o cliente vai ler. */
export const enviarModeloFn = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((i: { conversaId: string; nome: string; idioma: string }) => {
    const nome = String(i?.nome ?? "").trim();
    const idioma = String(i?.idioma ?? "").trim();
    if (!/^[\w-]{1,512}$/.test(nome) || !/^[A-Za-z_-]{2,10}$/.test(idioma))
      throw new Error("Modelo inválido.");
    return { ...validarConversa(i), nome, idioma };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Contexto;
    const e = await dadosDoEnvio(ctx, data.conversaId);
    const situacao = situacaoParaResponder(e.conversa.status);
    if (!situacao.pode)
      throw new Error("Assuma a conversa antes de responder (ela está com a Alice).");
    if (!e.conversa.inbox_id) throw new Error("Esta conversa não tem caixa do WhatsApp ligada.");
    const { modelosDaCaixa, enviarModelo } = await import("@/lib/mkt/chatwoot.server");
    const { templateParams, acharModelo } = await import("@/lib/mkt/modelos");
    const modelos = await modelosDaCaixa(e.conta, e.token, e.conversa.inbox_id);
    const escolhido = modelosParaResponder(modelos, e.primeiroNome).find(
      (m) => m.nome === data.nome && m.idioma.toLowerCase() === data.idioma.toLowerCase(),
    );
    const meta = acharModelo(modelos, data.nome, data.idioma);
    if (!escolhido || !meta) throw new Error("Esse modelo não está aprovado nesta caixa.");
    const { mudarSituacao } = await import("@/lib/alice/chatwoot-api.server");
    let id: number;
    try {
      ({ id } = await enviarModelo(
        e.conta,
        e.token,
        e.conversa.chatwoot_conversation_id,
        escolhido.texto,
        templateParams(meta, escolhido.parametros),
      ));
    } catch (err) {
      console.error("Caixa: modelo falhou", err instanceof Error ? err.message : err);
      throw new Error("O WhatsApp não aceitou o modelo agora. Tente de novo.");
    }
    if (situacao.reabre)
      await mudarSituacao(e.conta, e.token, e.conversa.chatwoot_conversation_id, "open").catch(
        () => undefined,
      );
    await registrarEnvio(ctx, e, id, escolhido.texto, "Texto", situacao.reabre);
    return { ok: true, chatwootMessageId: id };
  });
