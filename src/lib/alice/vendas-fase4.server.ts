/**
 * Plano "Alice e vendas", fase 4 (servidor): a oferta do follow-up 5 novo (valor guardado na tarefa
 * do toque e aplicado no orçamento quando o cliente aceita) e a Alice cobrindo o retorno combinado
 * que a equipe marcou e ninguém chamou. Tudo só com a chave da empresa (vendas-fase4.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEvento } from "./avisos.server";
import { primeiraAtendente } from "./cadencia";
import {
  calcularOferta5,
  chavesFase4,
  deveCobrirRetorno,
  diaDoPrazo,
  modeloDaOferta5,
  textoOferta5,
  textoRetornoDaEquipe,
  type ChavesFase4,
  type Oferta5,
} from "./vendas-fase4";

type Db = SupabaseClient;

/** O que fica gravado na tarefa do toque 5 (dados.oferta5). */
export type Oferta5Gravada = Oferta5 & { cheio: number; comVaga: boolean; texto: string };

const SITUACOES_NEGOCIADAS = ["autorizado", "outro_valor", "negado", "automatico"];

/** Tem horário livre na agenda até o fim desta semana (domingo)? Sem agenda, considera que não. */
export async function temVagaNaSemana(db: Db, empresaId: string): Promise<boolean> {
  try {
    const { agendaLivre } = await import("./agenda");
    const { agoraSP, carregarAgenda } = await import("./agendamento.server");
    const agora = agoraSP();
    const diaDaSemana = new Date(`${agora.data}T12:00:00Z`).getUTCDay();
    const dias = diaDaSemana === 0 ? 1 : 8 - diaDaSemana;
    const ate = new Date(new Date(`${agora.data}T12:00:00Z`).getTime() + (dias - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const agenda = await carregarAgenda({ admin: db, empresaId } as never, agora.data, ate);
    if ("erro" in agenda) return false;
    const livres = agendaLivre({
      inicio: agora.data,
      dias,
      base: agenda.horarios,
      ocupacoes: agenda.ocupacoes,
      periodo: "qualquer",
      agora,
      cliente: null,
      regras: agenda.regras,
      bloqueados: agenda.bloqueados,
    });
    return livres.some((d) => d.livres.length > 0);
  } catch {
    return false;
  }
}

/**
 * Oferta do toque 5 para este lead (orçamento atual, desconto que já tem e se já negociou) e o
 * texto aprovado. null = sem orçamento (o toque segue como antes).
 */
export async function prepararOferta5(
  db: Db,
  o: {
    empresaId: string;
    leadId: string | null;
    nome: string | null;
    agora: Date;
    chaves: ChavesFase4;
  },
): Promise<(Oferta5Gravada & { modelo: { modelo: string; valores: string[] } | null }) | null> {
  if (!o.leadId) return null;
  const [{ data: q }, { data: neg }] = await Promise.all([
    db
      .from("quotes")
      .select("subtotal, desconto, total")
      .eq("empresa_id", o.empresaId)
      .eq("crm_lead_id", o.leadId)
      .neq("status", "recusado")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("alice_autorizacoes")
      .select("id")
      .eq("empresa_id", o.empresaId)
      .eq("crm_lead_id", o.leadId)
      .in("situacao", SITUACOES_NEGOCIADAS)
      .limit(1),
  ]);
  const orc = q as { subtotal: number | null; desconto: number | null; total: number } | null;
  if (!orc) return null;
  const cheio = Number(orc.subtotal) > 0 ? Number(orc.subtotal) : Number(orc.total);
  const oferta = calcularOferta5({
    cheio,
    descontoAtual: Number(orc.desconto) || 0,
    negociou: Boolean(neg?.length),
    pct: o.chaves.followup5Pct,
    piso: o.chaves.followup5Piso,
  });
  const comVaga = oferta.tipo === "desconto" ? await temVagaNaSemana(db, o.empresaId) : false;
  const texto = textoOferta5({
    nome: o.nome,
    oferta,
    comVaga,
    pct: o.chaves.followup5Pct,
    prazo: diaDoPrazo(o.agora),
  });
  return {
    ...oferta,
    cheio,
    comVaga,
    texto,
    modelo: modeloDaOferta5({ nome: o.nome, oferta, comVaga }),
  };
}

/**
 * Valor da oferta do toque 5 novo nesta conversa (o cliente aceitou): o toque saiu nas últimas 48 h
 * pela Alice ou pelo modelo e teve desconto novo.
 */
export async function valorDaOferta5(
  db: Db,
  empresaId: string,
  conversaId: string,
  agora: Date,
): Promise<{ valor: number; cheio: number } | { erro: string }> {
  const { data } = await db
    .from("crm_followups")
    .select("ia_tarefa_id")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("etapa", "A5")
    .eq("status", "Concluída")
    .in("canal", ["texto", "modelo"])
    .gte("completed_at", new Date(agora.getTime() - 48 * 3_600_000).toISOString())
    .order("completed_at", { ascending: false })
    .limit(1);
  const tarefaId = (data?.[0] as { ia_tarefa_id?: string | null } | undefined)?.ia_tarefa_id;
  if (!tarefaId)
    return {
      erro: "Não há condição do último follow-up válida nesta conversa (vale até o dia seguinte ao envio).",
    };
  const { data: t } = await db.from("ia_tarefas").select("dados").eq("id", tarefaId).maybeSingle();
  const oferta = ((t as { dados?: { oferta5?: Oferta5Gravada } } | null)?.dados ?? {}).oferta5;
  if (!oferta || oferta.tipo !== "desconto")
    return { erro: "O último follow-up não teve condição nova nesta conversa." };
  return { valor: Number(oferta.valor), cheio: Number(oferta.cheio) };
}

/* ------------------------------------------------------------------------------------------ */
/* Retorno combinado marcado pela equipe: a Alice chama se ninguém chamou em 15 min             */
/* ------------------------------------------------------------------------------------------ */

type CfgRetorno = {
  empresa_id: string;
  ativo: boolean | null;
  nomes_atendentes: string | null;
  retorno_alice_cobre?: boolean;
  retorno_alice_cobre_min?: number;
  transferencia_prazo_min?: number | null;
};

type Retorno = {
  id: string;
  empresa_id: string;
  crm_lead_id: string;
  conversa_id: string | null;
  scheduled_at: string;
  notes: string | null;
};

/**
 * Varredura (~5 min): retornos que a equipe marcou (Agendar retorno: tarefa manual com pessoa, sem
 * trilha nem tarefa da Alice) e que ninguém chamou em 15 min. Dentro da janela de 24 h, a Alice
 * manda o texto aprovado e a conversa vai para a equipe (transferência com prazo, e o alarme se
 * estiver ligado). Fora da janela, nada: fica a tarefa da equipe.
 */
export async function rodarRetornoDaEquipe(db: Db, agora = new Date()): Promise<number> {
  const { data: cfgs } = await db
    .from("ia_configuracoes")
    .select(
      "empresa_id, ativo, nomes_atendentes, retorno_alice_cobre, retorno_alice_cobre_min, transferencia_prazo_min",
    )
    .eq("retorno_alice_cobre", true);
  let feitos = 0;
  for (const cfg of (cfgs ?? []) as CfgRetorno[]) {
    if (!cfg.ativo) continue;
    const chaves = chavesFase4(cfg);
    if (!chaves.retornoCobre) continue;
    const empresaId = String(cfg.empresa_id);
    const { data: lista } = await db
      .from("crm_followups")
      .select("id, empresa_id, crm_lead_id, conversa_id, scheduled_at, notes")
      .eq("empresa_id", empresaId)
      .eq("status", "Pendente")
      .is("origem", null)
      .is("trilha", null)
      .is("ia_tarefa_id", null)
      .not("assigned_to", "is", null)
      .gte("scheduled_at", new Date(agora.getTime() - 3 * 3_600_000).toISOString())
      .lte(
        "scheduled_at",
        new Date(agora.getTime() - chaves.retornoCobreMin * 60_000).toISOString(),
      )
      .limit(20);
    for (const r of (lista ?? []) as Retorno[]) {
      try {
        if (await cobrirRetorno(db, r, cfg, chaves, agora)) feitos++;
      } catch (e) {
        console.error(
          "Alice: retorno da equipe não coberto",
          r.id,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
  return feitos;
}

async function cobrirRetorno(
  db: Db,
  r: Retorno,
  cfg: CfgRetorno,
  chaves: ChavesFase4,
  agora: Date,
): Promise<boolean> {
  // Uma vez por retorno.
  const { data: ja } = await db
    .from("alice_eventos")
    .select("id")
    .eq("empresa_id", r.empresa_id)
    .eq("tipo", "retorno_coberto")
    .eq("dados->>followup", r.id)
    .limit(1);
  if (ja?.length) return false;
  const q = db
    .from("conversas")
    .select("id, status, chatwoot_conversation_id, whatsapp_contact_id, crm_lead_id")
    .eq("empresa_id", r.empresa_id);
  const { data: conversa } = await (
    r.conversa_id
      ? q.eq("id", r.conversa_id)
      : q.eq("crm_lead_id", r.crm_lead_id).order("updated_at", { ascending: false }).limit(1)
  ).maybeSingle();
  const c = conversa as {
    id: string;
    status: string | null;
    chatwoot_conversation_id: number | null;
    whatsapp_contact_id: string | null;
  } | null;
  if (!c?.chatwoot_conversation_id) return false;
  if (c.whatsapp_contact_id) {
    const { data: contato } = await db
      .from("whatsapp_contacts")
      .select("ia_desligada, sem_pos_venda, marketing_optout_em")
      .eq("id", c.whatsapp_contact_id)
      .maybeSingle();
    const k = contato as {
      ia_desligada?: boolean;
      sem_pos_venda?: boolean;
      marketing_optout_em?: string | null;
    } | null;
    if (k?.ia_desligada || k?.sem_pos_venda || k?.marketing_optout_em) return false;
  }
  const ultima = async (direcao: "Recebida" | "Enviada") => {
    const { data } = await db
      .from("whatsapp_messages")
      .select("message_timestamp")
      .eq("empresa_id", r.empresa_id)
      .eq("conversa_id", c.id)
      .eq("direction", direcao)
      .eq("privada", false)
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const m = data as { message_timestamp?: string } | null;
    return m?.message_timestamp ? new Date(m.message_timestamp) : null;
  };
  const [ultimaDoCliente, ultimaEnviada] = await Promise.all([
    ultima("Recebida"),
    ultima("Enviada"),
  ]);
  const decisao = deveCobrirRetorno({
    agendado: new Date(r.scheduled_at),
    agora,
    minutos: chaves.retornoCobreMin,
    ultimaDoCliente,
    ultimaEnviada,
  });
  if (!decisao.cobrir) return false;

  const { nomeConfirmado } = await import("./nome.server");
  const nomeCompleto = await nomeConfirmado(db as never, r.empresa_id, c.id, c.whatsapp_contact_id);
  const nome = nomeCompleto ? (nomeCompleto.split(/\s+/)[0] ?? null) : null;
  const atendente = primeiraAtendente(cfg.nomes_atendentes);
  const texto = textoRetornoDaEquipe(nome, atendente);

  const { contextoEmpresa } = await import("@/lib/mkt/contexto.server");
  const ctx = await contextoEmpresa(db as never, r.empresa_id);
  if (!ctx.tokenRobo) return false;
  const { enviarMensagem, mudarSituacao } = await import("./chatwoot-api.server");
  // Grava o evento antes de mandar: se a varredura rodar de novo no meio, não manda duas vezes.
  await registrarEvento(db, {
    empresa_id: r.empresa_id,
    tipo: "retorno_coberto",
    conversa_id: c.id,
    crm_lead_id: r.crm_lead_id,
    dados: {
      followup: r.id,
      atraso_min: Math.round((agora.getTime() - Date.parse(r.scheduled_at)) / 60_000),
    },
  });
  await enviarMensagem(ctx.conta, ctx.tokenRobo, c.chatwoot_conversation_id, texto);
  const hora = agora.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  await enviarMensagem(
    ctx.conta,
    ctx.tokenRobo,
    c.chatwoot_conversation_id,
    `🤖 Ninguém chamou o cliente no retorno combinado: a Alice chamou às ${hora}. Quando ele responder, é com a equipe.`,
    true,
  ).catch(() => undefined);
  // A resposta do cliente vai para a equipe (com o prazo e o alarme da transferência, se ligado).
  await mudarSituacao(ctx.conta, ctx.tokenRobo, c.chatwoot_conversation_id, "open").catch((e) =>
    console.error("Alice: conversa do retorno não foi para a equipe", e),
  );
  await db.from("conversas").update({ status: "open" }).eq("id", c.id);
  const { prazoParaTransferir, registrarTransferencia } = await import("./transferencia.server");
  const prazoMin = Number(
    (cfg as { transferencia_prazo_min?: number }).transferencia_prazo_min ?? 10,
  );
  await registrarTransferencia(db, {
    empresaId: r.empresa_id,
    conversaId: c.id,
    leadId: r.crm_lead_id,
    motivo: "retorno combinado da equipe",
    resumo: `A Alice chamou o cliente no retorno combinado (marcado para ${new Date(r.scheduled_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}) porque ninguém chamou em ${chaves.retornoCobreMin} min.`,
    prazo: await prazoParaTransferir(db, r.empresa_id, prazoMin, agora),
  });
  await db
    .from("crm_followups")
    .update({
      notes:
        `${r.notes ? `${r.notes}\n` : ""}🤖 Ninguém chamou em ${chaves.retornoCobreMin} min: a Alice chamou às ${hora} ("${texto}"). Quando o cliente responder, é com você.`.slice(
          0,
          2000,
        ),
    })
    .eq("id", r.id);
  return true;
}
