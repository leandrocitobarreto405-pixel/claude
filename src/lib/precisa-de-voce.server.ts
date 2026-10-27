/**
 * "Precisa de você" (item F): lê do banco o que depende da equipe hoje e calcula o dono de cada
 * item. Usado pela tela (precisa-de-voce.functions.ts) e pelo aviso das 10h no sininho.
 */
import { esperaDeVerdade } from "@/lib/conversas-espera";
import { haQuanto, ordenarItens, type ItemPrecisa } from "@/lib/precisa-de-voce";

type Db = Awaited<ReturnType<typeof import("@/lib/mkt/contexto.server").dbServico>>;

/** Fim do dia de hoje em São Paulo (ISO). */
function fimDeHojeSP(agora: Date): string {
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return new Date(`${hoje}T23:59:59-03:00`).toISOString();
}

/** Dono de cada conversa: quem assumiu pelo app ou o agente do Chatwoot (a Alice não conta). */
async function donosDasConversas(db: Db, empresaId: string, ids: string[]) {
  const donos = new Map<string, string | null>();
  if (!ids.length) return donos;
  const [{ data: conversas }, { data: vinculos }, { data: conexoes }] = await Promise.all([
    db.from("conversas").select("id, assumida_por, responsavel_id").in("id", ids),
    db
      .from("usuarios_empresa")
      .select("user_id, chatwoot_agent_id")
      .eq("empresa_id", empresaId)
      .not("chatwoot_agent_id", "is", null),
    db.from("chatwoot_conexoes").select("alice_bot_id"),
  ]);
  const usuarioDoAgente = new Map<number, string>();
  for (const v of vinculos ?? [])
    if (v.chatwoot_agent_id != null) usuarioDoAgente.set(Number(v.chatwoot_agent_id), v.user_id);
  const bots = new Set((conexoes ?? []).map((c) => Number(c.alice_bot_id)));
  for (const c of conversas ?? []) {
    const r = c.responsavel_id == null ? null : Number(c.responsavel_id);
    donos.set(
      c.id,
      c.assumida_por ?? (r == null || bots.has(r) ? null : (usuarioDoAgente.get(r) ?? null)),
    );
  }
  return donos;
}

export async function coletarItens(
  db: Db,
  emp: string,
  agora = new Date(),
): Promise<ItemPrecisa[]> {
  const desde24h = new Date(agora.getTime() - 24 * 3600_000).toISOString();
  const desde7d = new Date(agora.getTime() - 7 * 86_400_000).toISOString();
  const desde14d = new Date(agora.getTime() - 14 * 86_400_000).toISOString();

  const [avisos, esperas, leadsSite, followups] = await Promise.all([
    db
      .from("mkt_avisos")
      .select("id, titulo, mensagem, conversa_id, created_at")
      .eq("empresa_id", emp)
      .eq("tipo", "concorrente")
      .is("lido_em", null)
      .gte("created_at", desde14d)
      .limit(50),
    db
      .from("conversas")
      .select(
        "id, aguardando_desde, crm_lead_id, contato:whatsapp_contact_id ( profile_name, display_phone )",
      )
      .eq("empresa_id", emp)
      .eq("status", "open")
      .gte("aguardando_desde", desde24h)
      .limit(100),
    db
      .from("leads_site")
      .select("id, nome, lp, cadastrado_em, conversa_id, crm_lead_id, modelo_enviado_em")
      .eq("empresa_id", emp)
      .eq("situacao", "nao_chamou")
      .is("repetido_de", null)
      .gte("cadastrado_em", desde7d)
      .order("cadastrado_em")
      .limit(50),
    db
      .from("crm_followups")
      .select("id, crm_lead_id, conversa_id, scheduled_at, notes, assigned_to, status")
      .eq("empresa_id", emp)
      .eq("responsavel", "equipe")
      .in("status", ["Pendente", "Vencida"])
      .gte("scheduled_at", desde14d)
      .lte("scheduled_at", fimDeHojeSP(agora))
      .limit(100),
  ]);

  // Esperas de verdade (o "ok, obrigado" depois da resposta não conta).
  const convEspera = (esperas.data ?? []) as unknown as Array<{
    id: string;
    aguardando_desde: string;
    crm_lead_id: string | null;
    contato: { profile_name: string | null; display_phone: string | null } | null;
  }>;
  const { data: msgs } = convEspera.length
    ? await db
        .from("whatsapp_messages")
        .select("conversa_id, direction, text_content, message_type, message_timestamp, created_at")
        .in(
          "conversa_id",
          convEspera.map((c) => c.id),
        )
        .eq("privada", false)
        .gte("created_at", desde24h)
        .order("message_timestamp", { ascending: false })
        .limit(1000)
    : { data: [] };

  const leadsDoSite = leadsSite.data ?? [];
  const fups = followups.data ?? [];
  const conversasComDono = [
    ...(avisos.data ?? []).map((a) => a.conversa_id),
    ...convEspera.map((c) => c.id),
    ...fups.map((f) => f.conversa_id),
  ].filter((x): x is string => Boolean(x));
  const leadIds = [
    ...fups.map((f) => f.crm_lead_id),
    ...leadsDoSite.map((l) => l.crm_lead_id),
  ].filter((x): x is string => Boolean(x));
  const [donos, { data: leads }, { data: conversasDosAvisos }] = await Promise.all([
    donosDasConversas(db, emp, [...new Set(conversasComDono)]),
    leadIds.length
      ? db
          .from("crm_leads")
          .select("id, lead_name")
          .in("id", [...new Set(leadIds)])
      : Promise.resolve({ data: [] as Array<{ id: string; lead_name: string | null }> }),
    (avisos.data ?? []).some((a) => a.conversa_id)
      ? db
          .from("conversas")
          .select("id, crm_lead_id")
          .in(
            "id",
            (avisos.data ?? []).map((a) => a.conversa_id).filter((x): x is string => Boolean(x)),
          )
      : Promise.resolve({ data: [] as Array<{ id: string; crm_lead_id: string | null }> }),
  ]);
  const nomeDoLead = new Map((leads ?? []).map((l) => [l.id, l.lead_name]));
  const leadDaConversa = new Map((conversasDosAvisos ?? []).map((c) => [c.id, c.crm_lead_id]));

  const itens: ItemPrecisa[] = [];
  for (const a of avisos.data ?? []) {
    itens.push({
      chave: `urgente:${a.id}`,
      secao: "urgente",
      nome: a.titulo.replace(/^URGENTE:\s*/, "").replace(/\s*foi para a concorrência$/, ""),
      detalhe: a.mensagem,
      quando: a.created_at,
      conversaId: a.conversa_id,
      leadId: a.conversa_id ? (leadDaConversa.get(a.conversa_id) ?? null) : null,
      donoUserId: a.conversa_id ? (donos.get(a.conversa_id) ?? null) : null,
      avisoId: a.id,
    });
  }
  for (const c of convEspera) {
    const daConversa = (msgs ?? []).filter((m) => m.conversa_id === c.id);
    if (!esperaDeVerdade(daConversa)) continue;
    const ultima = daConversa[0];
    const texto =
      ultima?.text_content?.trim() ||
      (ultima?.message_type === "Áudio" ? "Áudio" : ultima?.message_type || "Mensagem");
    itens.push({
      chave: `esperando:${c.id}`,
      secao: "esperando",
      nome: c.contato?.profile_name || c.contato?.display_phone || "Cliente",
      detalhe: `“${texto.slice(0, 120)}” · esperando ${haQuanto(c.aguardando_desde, agora)}`,
      quando: c.aguardando_desde,
      conversaId: c.id,
      leadId: c.crm_lead_id,
      donoUserId: donos.get(c.id) ?? null,
      dentroDaJanela: true,
    });
  }
  for (const l of leadsDoSite) {
    itens.push({
      chave: `lead_site:${l.id}`,
      secao: "lead_site",
      nome: l.nome || "Lead do site",
      detalhe: [
        l.lp,
        `cadastro ${haQuanto(l.cadastrado_em, agora)}`,
        l.modelo_enviado_em ? "mensagem enviada, sem resposta" : "ninguém chamou",
      ]
        .filter(Boolean)
        .join(" · "),
      quando: l.cadastrado_em,
      conversaId: l.conversa_id,
      leadId: l.crm_lead_id,
      donoUserId: null,
      leadSiteId: l.id,
      modeloEnviado: Boolean(l.modelo_enviado_em),
      // Quem não chamou nunca escreveu: fora da janela de 24 h (só o modelo aprovado).
      dentroDaJanela: false,
    });
  }
  for (const f of fups) {
    itens.push({
      chave: `followup:${f.id}`,
      secao: "followup",
      nome: (f.crm_lead_id && nomeDoLead.get(f.crm_lead_id)) || "Cliente",
      // "Atrasado" aparece na etiqueta do horário.
      detalhe: f.notes?.trim() || "Follow-up",
      quando: f.scheduled_at,
      conversaId: f.conversa_id,
      leadId: f.crm_lead_id,
      donoUserId: f.assigned_to ?? (f.conversa_id ? (donos.get(f.conversa_id) ?? null) : null),
      followupId: f.id,
    });
  }

  return ordenarItens(itens);
}

/**
 * Orçamentos sem desfecho com a mesma regra da aba (leads_sem_desfecho): terminou os follow-ups,
 * a Alice sugeriu o motivo ou o orçamento venceu há 2 dias; sem OS, perda, desfecho nem follow-up
 * futuro. A função do banco exige usuário logado; aqui o aviso roda sem usuário.
 */
async function contarSemDesfecho(db: Db, emp: string, hoje: string): Promise<number> {
  const [{ data: cfg }, { data: leads }] = await Promise.all([
    db.from("orcamento_configuracoes").select("validade_dias").eq("empresa_id", emp).maybeSingle(),
    db
      .from("crm_leads")
      .select(
        "orcamento_enviado_em, sem_desfecho_em, sem_desfecho_sugerido, next_follow_up_at, is_open",
      )
      .eq("empresa_id", emp)
      .not("orcamento_enviado_em", "is", null)
      .is("os_criada_em", null)
      .is("linked_work_order_id", null)
      .is("loss_reason_id", null)
      .is("perdido_em", null)
      .is("desfecho_em", null)
      .limit(2000),
  ]);
  const validade = Number(cfg?.validade_dias ?? 7) || 7;
  const agora = Date.now();
  return (leads ?? []).filter((l) => {
    if (l.is_open === false) return false;
    if (l.next_follow_up_at && Date.parse(l.next_follow_up_at) >= agora) return false;
    if (l.sem_desfecho_em || l.sem_desfecho_sugerido) return true;
    const enviado = new Date(l.orcamento_enviado_em!).toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    });
    const limite = new Date(`${enviado}T12:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() + validade + 2);
    return limite.toISOString().slice(0, 10) < hoje;
  }).length;
}

/**
 * Aviso das 10h no sininho (só no app, nunca WhatsApp): o resumo do "Precisa de você" do dia, uma
 * vez por dia, nas empresas com a Alice ligada. Lista zerada não gera aviso.
 */
export async function avisoDasDezPrecisa(agora = new Date()) {
  const { dbServico } = await import("@/lib/mkt/contexto.server");
  const db = await dbServico();
  const { horarioSP } = await import("@/lib/leads-site");
  const { resumoDoDia } = await import("@/lib/precisa-de-voce");
  const { data: hoje, hora } = horarioSP(agora);
  if (hora < "10:00" || hora >= "12:00") return { avisos: 0 };
  const { data: empresas } = await db
    .from("ia_configuracoes")
    .select("empresa_id")
    .eq("ativo", true);
  let avisos = 0;
  for (const { empresa_id: emp } of empresas ?? []) {
    const referencia = `precisa:${hoje}`;
    const { data: ja } = await db
      .from("mkt_avisos")
      .select("id")
      .eq("empresa_id", emp)
      .eq("referencia", referencia)
      .limit(1);
    if (ja?.length) continue;
    const itens = await coletarItens(db, emp, agora);
    const texto = resumoDoDia(itens, { quantidade: await contarSemDesfecho(db, emp, hoje) });
    if (!texto) continue;
    await db.from("mkt_avisos").insert({
      empresa_id: emp,
      tipo: "precisa_resumo",
      titulo: "Precisa de você hoje",
      mensagem: `${texto} Abra o Início para ver a lista.`,
      so_no_app: true,
      referencia,
    });
    avisos++;
  }
  return { avisos };
}
