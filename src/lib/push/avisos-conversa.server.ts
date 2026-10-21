/**
 * Item 5: push disparado pelo webhook do Chatwoot logo depois de gravar a mensagem do cliente.
 * Quem recebe e o texto ficam em avisos-conversa.ts; aqui só se lê o banco e se envia. Uma vez
 * por espera (push_envios, tipo "cliente_esperando" com referência própria). Nunca derruba o
 * webhook: qualquer erro vira aviso no log.
 */
import { textoDaMensagem } from "@/lib/conversas";
import { log, type Db } from "@/lib/mkt/contexto.server";
import { avisosDaMensagem, VENDO_HA_MS, type MensagemChegada } from "./avisos-conversa";
import { enviarParaPessoa, pessoasComCelular, registrarUmaVez } from "./notificacoes.server";

export async function avisarEquipeMensagemNova(
  db: Db,
  ids: { empresaId: string; conversaId: string; mensagemId: string },
): Promise<{ enviados: number }> {
  const pessoas = (await pessoasComCelular(db, ids.empresaId)).get(ids.empresaId) ?? [];
  if (!pessoas.length) return { enviados: 0 };
  const agora = new Date();
  const [
    { data: msg },
    { data: conv },
    { data: vinculos },
    { data: conexoes },
    { data: leituras },
  ] = await Promise.all([
    db
      .from("whatsapp_messages")
      .select("direction, privada, text_content, message_type")
      .eq("id", ids.mensagemId)
      .maybeSingle(),
    db
      .from("conversas")
      .select(
        "status, aguardando_desde, assumida_por, responsavel_id, contato:whatsapp_contact_id ( profile_name, display_phone )",
      )
      .eq("id", ids.conversaId)
      .maybeSingle(),
    db
      .from("usuarios_empresa")
      .select("user_id, chatwoot_agent_id")
      .eq("empresa_id", ids.empresaId)
      .not("chatwoot_agent_id", "is", null),
    db.from("chatwoot_conexoes").select("alice_bot_id"),
    db
      .from("conversas_leituras")
      .select("user_id, lida_em")
      .eq("conversa_id", ids.conversaId)
      .gte("lida_em", new Date(agora.getTime() - VENDO_HA_MS).toISOString()),
  ]);
  if (!msg || !conv) return { enviados: 0 };
  const contato = conv.contato as {
    profile_name: string | null;
    display_phone: string | null;
  } | null;
  const usuarioDoAgente = new Map<number, string>();
  for (const v of vinculos ?? [])
    if (v.chatwoot_agent_id != null) usuarioDoAgente.set(Number(v.chatwoot_agent_id), v.user_id);
  const botIds = (conexoes ?? []).map((c) => c.alice_bot_id).filter((x): x is number => x != null);
  // Quem está com a conversa: a pessoa do Chatwoot (quando ligada a um usuário), senão quem
  // assumiu pelo app; a Alice (agent_bot) não conta. Mesma regra de quemEstaCom.
  const responsavelId = conv.responsavel_id == null ? null : Number(conv.responsavel_id);
  const pessoaNoChatwoot = responsavelId != null && !botIds.includes(responsavelId);
  const comAlguem = pessoaNoChatwoot || Boolean(conv.assumida_por);
  const responsavelUserId = pessoaNoChatwoot
    ? (usuarioDoAgente.get(responsavelId) ?? null)
    : (conv.assumida_por ?? null);
  const chegada: MensagemChegada = {
    conversaId: ids.conversaId,
    mensagemId: ids.mensagemId,
    direction: msg.direction,
    privada: Boolean(msg.privada),
    texto: textoDaMensagem(msg.text_content, msg.message_type),
    clienteNome: contato?.profile_name || contato?.display_phone || "Cliente",
    status: conv.status,
    aguardandoDesde: conv.aguardando_desde,
    comAlguem,
    responsavelUserId,
  };
  const vendoEm = new Map<string, string>();
  for (const l of leituras ?? []) vendoEm.set(l.user_id, l.lida_em);
  const avisos = avisosDaMensagem(
    chegada,
    pessoas.map((p) => ({
      userId: p.userId,
      papel: p.papel,
      clienteEsperando: p.pref.cliente_esperando,
    })),
    vendoEm,
    agora,
  );
  let enviados = 0;
  for (const a of avisos) {
    const pessoa = pessoas.find((p) => p.userId === a.userId);
    if (!pessoa) continue;
    const id = await registrarUmaVez(
      db,
      ids.empresaId,
      a.userId,
      "cliente_esperando",
      a.ref,
      a.n.titulo,
    );
    if (!id) continue; // esta espera já avisou
    const r = await enviarParaPessoa(db, pessoa.celulares, a.n);
    await db.from("push_envios").update({ enviados: r.enviados }).eq("id", id);
    enviados += r.enviados;
  }
  if (enviados) log("INFO", "push.conversa", { conversa: ids.conversaId, enviados });
  return { enviados };
}
