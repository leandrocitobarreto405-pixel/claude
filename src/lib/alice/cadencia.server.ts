/**
 * Cadência do follow-up no servidor: agenda o próximo toque (ia_tarefas + crm_followups), confere a
 * trava antes de cada toque, manda o modelo aprovado fora da janela de 24 h e marca o lead como "sem
 * desfecho" no fim da trilha. As regras puras ficam em cadencia.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  MOTIVO_FIM,
  doisHorarios,
  horarioDoPasso,
  passoDaEtapa,
  proximoPasso,
  travaDoLead,
  trilhaDoLead,
  type Passo,
  type Trilha,
} from "./cadencia";
import { proximoHorarioPermitido } from "./regras";

type Db = SupabaseClient<Database>;
type ConfigIa = Database["public"]["Tables"]["ia_configuracoes"]["Row"];

/** Dados guardados na tarefa de follow-up da cadência. */
export type DadosCadencia = {
  cadencia?: boolean;
  trilha?: string;
  etapa?: string;
  /** Resposta da Alice que começou a trilha (ISO). */
  ancora?: string;
  motivo?: string;
  mensagem_sugerida?: string;
};

const SELECT_LEAD =
  "id, lead_name, is_open, perdido_em, os_criada_em, linked_work_order_id, agendado_em, closed_at, orcamento_enviado_em, customer_id";

async function lerLead(db: Db, empresaId: string, leadId: string) {
  const { data } = await db
    .from("crm_leads")
    .select(SELECT_LEAD)
    .eq("id", leadId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return data;
}

/**
 * Agenda o próximo toque. Sem `atual` (resposta normal da Alice ou toque que não era da cadência):
 * começa a trilha pelo estado do lead, contando de agora. Com `atual` (toque da cadência feito):
 * agenda o passo seguinte da mesma trilha, contando da mesma âncora. Devolve se agendou.
 */
export async function seguirCadencia(
  db: Db,
  o: {
    empresaId: string;
    conversaId: string;
    leadId: string | null;
    cfg: ConfigIa;
    atual?: DadosCadencia | null;
    agora?: Date;
  },
): Promise<boolean> {
  if (!o.cfg.cadencia_followup || !o.leadId) return false;
  // A retomada é uma mensagem só: não abre a sequência de toques depois.
  if (o.atual?.etapa === "R") return false;
  const lead = await lerLead(db, o.empresaId, o.leadId);
  if (travaDoLead(lead)) return false;
  const agora = o.agora ?? new Date();
  const continua = Boolean(o.atual?.cadencia && o.atual.etapa);
  const trilha: Trilha = continua ? (o.atual!.trilha === "B" ? "B" : "A") : trilhaDoLead(lead);
  const ancora = continua && o.atual!.ancora ? new Date(o.atual!.ancora) : agora;
  const passo = proximoPasso(trilha, continua ? o.atual!.etapa! : null, {
    oferta: Boolean(o.cfg.oferta_followup_ligada && o.cfg.oferta_followup_valor),
  });
  if (!passo) return false;
  const quando = passo.fim
    ? horarioDoPasso(passo, ancora, agora)
    : proximoHorarioPermitido(
        horarioDoPasso(passo, ancora, agora),
        o.cfg.hora_inicio,
        o.cfg.hora_fim,
      );

  const { cancelarFollowupPendente } = await import("./ferramentas.server");
  await cancelarFollowupPendente(db, o.empresaId, o.conversaId, "substituído pela cadência");
  const dados: DadosCadencia = {
    cadencia: true,
    trilha,
    etapa: passo.etapa,
    ancora: ancora.toISOString(),
    motivo: passo.fim ? `fim da trilha ${trilha}` : `toque ${passo.etapa} (trilha ${trilha})`,
    mensagem_sugerida: passo.guia,
  };
  const { data: t, error } = await db
    .from("ia_tarefas")
    .insert({
      empresa_id: o.empresaId,
      conversa_id: o.conversaId,
      tipo: "followup",
      executar_apos: quando.toISOString(),
      motivo: dados.motivo!,
      dados: dados as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(`cadência: ${error.message}`);
  await db.from("crm_followups").insert({
    empresa_id: o.empresaId,
    crm_lead_id: o.leadId,
    conversa_id: o.conversaId,
    scheduled_at: quando.toISOString(),
    responsavel: "alice",
    ia_tarefa_id: t.id,
    trilha,
    etapa: passo.etapa,
    notes: passo.fim
      ? `🤖 Fim da trilha ${trilha}: se o cliente não responder, o lead vai para "Orçamentos sem desfecho".`
      : `🤖 Toque ${passo.etapa} (trilha ${trilha}): ${passo.guia}`,
  });
  if (!passo.fim)
    await db
      .from("crm_leads")
      .update({ next_follow_up_at: quando.toISOString() })
      .eq("id", o.leadId)
      .eq("empresa_id", o.empresaId);
  return true;
}

/**
 * Trava antes de cada toque (a mensagem do cliente já cancela pelo gatilho do banco). Devolve o
 * motivo para não mandar ou null.
 */
export async function travaDoToque(
  db: Db,
  o: {
    empresaId: string;
    conversa: {
      id: string;
      status: string | null;
      crm_lead_id: string | null;
      assumida_por?: string | null;
      responsavel_id?: number | string | null;
    };
    contato: {
      ia_desligada: boolean;
      sem_pos_venda: boolean;
      marketing_optout_em: string | null;
    } | null;
    /** Desde quando olhar mensagens da equipe (última resposta da Alice / início da trilha). */
    desde: Date;
    /** Agente-robô da Alice no Chatwoot: responsável que não conta como dono. */
    botId?: number | null;
  },
): Promise<string | null> {
  if (o.contato?.ia_desligada) return "IA desligada para o cliente";
  if (o.contato?.sem_pos_venda) return "cliente marcado sem pós-venda";
  if (o.contato?.marketing_optout_em) return "cliente pediu para não receber mensagens";
  // Conversa encerrada (inclusive pelo encerramento automático por inatividade) ou aberta sem
  // dono não é "equipe assumiu": trava só quem assumiu pelo Nexa ou uma pessoa responsável pela
  // conversa aberta no Chatwoot (ou alguém ter escrito ao cliente, logo abaixo).
  if (o.conversa.assumida_por) return "equipe assumiu a conversa";
  const responsavel = o.conversa.responsavel_id == null ? null : Number(o.conversa.responsavel_id);
  if (o.conversa.status === "open" && responsavel != null && responsavel !== (o.botId ?? null))
    return "equipe assumiu a conversa";
  const { data: daEquipe } = await db
    .from("whatsapp_messages")
    .select("id")
    .eq("empresa_id", o.empresaId)
    .eq("conversa_id", o.conversa.id)
    .eq("direction", "Enviada")
    .eq("remetente_tipo", "user")
    .eq("privada", false)
    .gt("message_timestamp", o.desde.toISOString())
    .limit(1);
  if (daEquipe?.length) return "equipe escreveu para o cliente";
  if (!o.conversa.crm_lead_id) return "sem lead";
  const lead = await lerLead(db, o.empresaId, o.conversa.crm_lead_id);
  const trava = travaDoLead(lead);
  if (trava) return trava;
  if (lead?.customer_id) {
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: os } = await db
      .from("work_orders")
      .select("id, visits!inner(scheduled_date, status)")
      .eq("empresa_id", o.empresaId)
      .eq("customer_id", lead.customer_id)
      .gte("visits.scheduled_date", hoje)
      .neq("visits.status", "Cancelado")
      .limit(1);
    if (os?.length) return "cliente já tem visita marcada";
  }
  return null;
}

/** Dois horários reais da agenda (próximos 6 dias) para o modelo; null = sem agenda/horário. */
export async function horariosParaModelo(
  db: Db,
  empresaId: string,
): Promise<[string, string] | null> {
  try {
    const { agendaLivre } = await import("./agenda");
    const { agoraSP, carregarAgenda } = await import("./agendamento.server");
    const agora = agoraSP();
    // 13 dias à frente: dá para achar um segundo dia (de semana ou sábado) com agenda cheia.
    const ate = new Date(new Date(`${agora.data}T12:00:00Z`).getTime() + 13 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const agenda = await carregarAgenda({ admin: db, empresaId } as never, agora.data, ate);
    if ("erro" in agenda) return null;
    const dias = agendaLivre({
      inicio: agora.data,
      dias: 14,
      base: agenda.horarios,
      ocupacoes: agenda.ocupacoes,
      periodo: "qualquer",
      agora,
      cliente: null,
    });
    return doisHorarios(dias);
  } catch {
    return null;
  }
}

/**
 * Fora da janela: manda o modelo aprovado do passo pelo Chatwoot (o mesmo cano). Devolve o texto
 * enviado ou o motivo de não ter mandado (vira tarefa da equipe).
 */
export async function enviarToqueModelo(
  db: Db,
  o: {
    empresaId: string;
    chatwootConversa: number;
    nomeCliente: string | null;
    passo: Passo;
  },
): Promise<{ ok: true; texto: string; modelo: string } | { ok: false; motivo: string }> {
  if (!o.passo.modelo) return { ok: false, motivo: "este toque não tem modelo" };
  const { contextoEmpresa } = await import("@/lib/mkt/contexto.server");
  const ctx = await contextoEmpresa(db, o.empresaId);
  if (!ctx.tokenRobo) return { ok: false, motivo: "token do robô do Chatwoot não configurado" };
  const { modelosAtualizados } = await import("@/lib/mkt/modelos-situacao.server");
  const { situacaoModelo, templateParams, variaveis } = await import("@/lib/mkt/modelos");
  const { modelos } = await modelosAtualizados(db, o.empresaId, {
    ctx,
    precisa: [o.passo.modelo],
    idioma: ctx.cfg.template_idioma,
  });
  const sit = situacaoModelo(modelos, o.passo.modelo, ctx.cfg.template_idioma);
  if (!sit.ok) return { ok: false, motivo: `modelo ${o.passo.modelo}: ${sit.erro}` };
  const corpo = sit.modelo.components?.find((x) => x.type?.toUpperCase() === "BODY")?.text ?? "";
  const vars = variaveis(corpo);
  const valores: string[] = [o.nomeCliente || "tudo bem"];
  if (o.passo.horarios) {
    const h = await horariosParaModelo(db, o.empresaId);
    if (!h) return { ok: false, motivo: "sem dois horários livres na agenda para o modelo" };
    valores.push(...h);
  }
  if (vars.length > valores.length)
    return {
      ok: false,
      motivo: `o modelo ${o.passo.modelo} pede ${vars.length} variáveis (tem ${valores.length})`,
    };
  const parametros: Record<string, string> = Object.fromEntries(
    vars.map((v, i) => [v, valores[i]!]),
  );
  let texto = corpo;
  for (const v of vars) texto = texto.replace(`{{${v}}}`, parametros[v]!);
  const { enviarModelo } = await import("@/lib/mkt/chatwoot.server");
  await enviarModelo(
    ctx.conta,
    ctx.tokenRobo,
    o.chatwootConversa,
    texto,
    templateParams(sit.modelo, parametros),
  );
  return { ok: true, texto, modelo: o.passo.modelo };
}

/** Fim da trilha: o lead vai para "Orçamentos sem desfecho" com o motivo sugerido. */
export async function marcarSemDesfecho(
  db: Db,
  empresaId: string,
  leadId: string,
  trilha: Trilha,
): Promise<void> {
  await db
    .from("crm_leads")
    .update({
      sem_desfecho_em: new Date().toISOString(),
      sem_desfecho_motivo: MOTIVO_FIM[trilha],
      next_follow_up_at: null,
    })
    .eq("id", leadId)
    .eq("empresa_id", empresaId)
    .is("sem_desfecho_em", null);
}

export { passoDaEtapa };
