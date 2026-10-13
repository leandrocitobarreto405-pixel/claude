/**
 * Resposta da cliente à confirmação ou ao pós-venda que a Alice mandou: confirmou (registra na
 * OS), pediu para remarcar, elogiou (pedido de avaliação, se ligado) ou relatou problema
 * (garantia). Na OS que a equipe agendou, a Alice só trata a resposta: depois, a conversa volta
 * para a equipe; qualquer outro assunto é transferido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { podeRemarcar } from "./agendamento";
import { decidirResposta, primeiroNome, textoAvaliacao, type TipoPos } from "./pos-atendimento";
import type { ContextoFerramenta } from "./ferramentas.server";

type Db = SupabaseClient;

export type PosPendente = {
  id: string;
  tipo: TipoPos;
  workOrderId: string;
  osNumero: string;
  dataServico: string;
  hora: string | null;
  /** A própria Alice criou a OS nesta conversa. */
  osDaAlice: boolean;
  /** OS da equipe: a Alice só trata a resposta (o resto vai para a equipe). */
  restrito: boolean;
};

export const RespostaPosAtendimento = z.object({
  acao: z.enum(["confirmou", "remarcar", "elogio", "problema", "outro"]),
  detalhe: z.string().trim().max(1000).optional(),
});

function agoraSP() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

/** Mensagem da Alice (confirmação ou pós-venda) ainda sem resposta nesta conversa (até 4 dias). */
export async function posPendente(
  db: Db,
  empresaId: string,
  conversa: { id: string; chatwoot_conversation_id: number },
): Promise<PosPendente | null> {
  const { data } = await db
    .from("ia_pos_atendimento")
    .select("id, tipo, work_order_id, data_servico, work_order:work_order_id ( os_number )")
    .eq("empresa_id", empresaId)
    .eq("chatwoot_conversation_id", conversa.chatwoot_conversation_id)
    .eq("situacao", "enviado")
    .in("tipo", ["confirmacao", "pos_venda"])
    .is("resposta", null)
    .gte("enviado_em", new Date(Date.now() - 4 * 86400_000).toISOString())
    .order("enviado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const p = data as unknown as {
    id: string;
    tipo: TipoPos;
    work_order_id: string;
    data_servico: string;
    work_order: { os_number: string } | null;
  };
  const [{ count }, { data: visita }] = await Promise.all([
    db
      .from("work_order_history")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("work_order_id", p.work_order_id)
      .eq("event_type", "Criação")
      .eq("details->>conversa_id", conversa.id),
    db
      .from("visits")
      .select("scheduled_time")
      .eq("work_order_id", p.work_order_id)
      .eq("scheduled_date", p.data_servico)
      .neq("status", "Cancelado")
      .order("scheduled_time")
      .limit(1)
      .maybeSingle(),
  ]);
  const osDaAlice = (count ?? 0) > 0;
  return {
    id: p.id,
    tipo: p.tipo,
    workOrderId: p.work_order_id,
    osNumero: p.work_order?.os_number ?? "",
    dataServico: p.data_servico,
    hora: visita?.scheduled_time ? String(visita.scheduled_time).slice(0, 5) : null,
    osDaAlice,
    restrito: !osDaAlice,
  };
}

/** Instruções do momento para a Alice tratar a resposta. */
export function instrucoesPos(p: PosPendente): string {
  const oque =
    p.tipo === "confirmacao"
      ? `a confirmação do serviço da OS ${p.osNumero} (${p.dataServico}${p.hora ? `, chegada às ${p.hora}` : ""})`
      : `a mensagem de pós-venda da OS ${p.osNumero} (serviço de ${p.dataServico})`;
  return [
    `Você mandou ${oque} e a cliente respondeu. Classifique a resposta com resposta_pos_atendimento (confirmou, remarcar, elogio, problema ou outro) ANTES de escrever, e siga a orientação que a ferramenta devolver.`,
    p.restrito
      ? 'Esta OS foi agendada pela equipe: trate SÓ a resposta a essa mensagem. Qualquer outro assunto: acao "outro" (a conversa vai para a equipe). Não faça orçamento, não ofereça serviços.'
      : "Depois de tratar a resposta, siga o atendimento normalmente.",
  ].join(" ");
}

/** Garantia ou reclamação nesta OS (transferência registrada): não pede avaliação. */
async function teveGarantia(ctx: ContextoFerramenta, workOrderId: string): Promise<boolean> {
  const { count } = await ctx.admin
    .from("ia_pos_atendimento")
    .select("id", { count: "exact", head: true })
    .eq("work_order_id", workOrderId)
    .eq("resposta", "problema");
  if ((count ?? 0) > 0) return true;
  if (!ctx.leadId) return false;
  const { count: f } = await ctx.admin
    .from("crm_followups")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", ctx.empresaId)
    .eq("crm_lead_id", ctx.leadId)
    .or("notes.ilike.%garantia%,notes.ilike.%reclama%");
  return (f ?? 0) > 0;
}

export async function respostaPosAtendimento(
  ctx: ContextoFerramenta,
  input: z.infer<typeof RespostaPosAtendimento>,
): Promise<{ erro: boolean; texto: string }> {
  const p = ctx.posAtendimento;
  if (!p) return { erro: true, texto: "Não há confirmação nem pós-venda esperando resposta aqui." };
  const { data: cfg } = await ctx.admin
    .from("ia_configuracoes")
    .select("avaliacao_ligada, avaliacao_link, avaliacao_texto")
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  const { data: avaliado } = await ctx.admin
    .from("ia_pos_atendimento")
    .select("id")
    .eq("work_order_id", p.workOrderId)
    .eq("tipo", "avaliacao")
    .limit(1);
  const avaliacaoPossivel =
    Boolean(cfg?.avaliacao_ligada && cfg.avaliacao_link) &&
    !avaliado?.length &&
    !(await teveGarantia(ctx, p.workOrderId));
  const d = decidirResposta({
    tipo: p.tipo,
    resposta: input.acao,
    restrito: p.restrito,
    osDaAlice: p.osDaAlice,
    podeRemarcar: p.hora ? podeRemarcar({ data: p.dataServico, hora: p.hora }, agoraSP()) : false,
    avaliacaoPossivel,
  });

  await ctx.admin
    .from("ia_pos_atendimento")
    .update({
      resposta: input.acao,
      respondido_em: new Date().toISOString(),
      conversa_id: ctx.conversaId,
    })
    .eq("id", p.id);

  if (d.confirmar) {
    await ctx.admin
      .from("visits")
      .update({ status: "Confirmado" })
      .eq("work_order_id", p.workOrderId)
      .eq("scheduled_date", p.dataServico)
      .eq("status", "Agendado");
    await ctx.admin.from("work_order_history").insert({
      empresa_id: ctx.empresaId,
      work_order_id: p.workOrderId,
      event_type: "Edição",
      description: `Cliente confirmou o serviço pelo WhatsApp (${ctx.cfg.nome}, IA).`,
      details: { conversa_id: ctx.conversaId, pos_atendimento: "confirmou" } as never,
    });
  }

  if (d.transferir) {
    const resumo = [
      `OS ${p.osNumero} (${p.tipo === "confirmacao" ? "confirmação da véspera" : "pós-venda"}).`,
      input.detalhe ? `Cliente: ${input.detalhe}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (d.transferir === "garantia") {
      const { registrarProblemaPosVenda } = await import("./marketing.server");
      await registrarProblemaPosVenda(ctx, resumo);
      ctx.passagem = { motivo: "⚠️ PRIORIDADE (problema no pós-venda): garantia", resumo };
    } else {
      ctx.passagem = { motivo: d.transferir, resumo };
    }
  } else if (p.restrito) {
    // OS da equipe: a Alice responde e a conversa volta para a equipe.
    ctx.devolverEquipe = `🤖 ${ctx.cfg.nome} tratou a resposta à ${p.tipo === "confirmacao" ? "confirmação" : "mensagem de pós-venda"} da OS ${p.osNumero} (${input.acao}) e devolveu a conversa para a equipe.`;
  }

  if (d.avaliar && cfg?.avaliacao_link) {
    const { data: lead } = ctx.leadId
      ? await ctx.admin.from("crm_leads").select("lead_name").eq("id", ctx.leadId).maybeSingle()
      : { data: null };
    const { data: empresa } = await ctx.admin
      .from("empresas")
      .select("nome")
      .eq("id", ctx.empresaId)
      .maybeSingle();
    const texto = textoAvaliacao(
      cfg.avaliacao_texto,
      primeiroNome(lead?.lead_name) || "",
      empresa?.nome ?? "",
      cfg.avaliacao_link,
    ).replace(/^Que bom, !/, "Que bom!");
    ctx.saida.push({ tipo: "texto", texto, bloco: true });
    await ctx.admin.from("ia_pos_atendimento").insert({
      empresa_id: ctx.empresaId,
      work_order_id: p.workOrderId,
      tipo: "avaliacao",
      data_servico: p.dataServico,
      situacao: "enviado",
      via: "texto",
      conversa_id: ctx.conversaId,
      mensagem: texto.slice(0, 2000),
      enviado_em: new Date().toISOString(),
    } as never);
  }
  return { erro: false, texto: d.orientacao };
}

/** Hoje é dia de serviço desta cliente (OS não cancelada): a Alice não responde. */
export async function servicoHoje(
  db: Db,
  empresaId: string,
  fone: string | null | undefined,
): Promise<string | null> {
  const digitos = (fone ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  const { data: clientes } = await db
    .from("customers")
    .select("id, phone")
    .eq("empresa_id", empresaId)
    .ilike("phone", `%${digitos.slice(-8).slice(0, 4)}%${digitos.slice(-4)}%`)
    .limit(10);
  const { chaveTelefone } = await import("@/lib/mkt/chatwoot.server");
  const ids = (clientes ?? [])
    .filter((c) => chaveTelefone(String(c.phone ?? "")) === chaveTelefone(digitos))
    .map((c) => c.id as string);
  if (!ids.length) return null;
  const { data } = await db
    .from("visits")
    .select("status, work_order:work_order_id!inner ( os_number, customer_id, deleted_at, status )")
    .eq("empresa_id", empresaId)
    .eq("scheduled_date", agoraSP().data)
    .neq("status", "Cancelado")
    .in("work_order.customer_id", ids)
    .limit(5);
  const v = (
    (data ?? []) as unknown as Array<{
      work_order: { os_number: string; deleted_at: string | null; status: string | null } | null;
    }>
  ).find(
    (x) => x.work_order && !x.work_order.deleted_at && !/cancel/i.test(x.work_order.status ?? ""),
  );
  return v?.work_order?.os_number ?? null;
}
