/**
 * Cliente que foi (ou vai) para a concorrência: aviso URGENTE só no app (vermelho no sininho e no
 * topo do "Precisa de você"), com o valor da concorrência, o valor do nosso orçamento e o link da
 * conversa. Vem da transferência da Alice (motivo "concorrência") ou do toque bloqueado pelo
 * contexto. Um aviso por lead (ou conversa): se já existe e chegou o valor da concorrência, é
 * atualizado e volta como não lido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

/** Motivo da transferência que conta como concorrência. */
export function ehMotivoConcorrencia(motivo: string): boolean {
  return /concorr|outra empresa|mais barat/i.test(motivo);
}

function reais(v: unknown): string | null {
  const n = Number(v);
  return v != null && Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : null;
}

export async function avisarConcorrencia(
  db: Db,
  o: {
    empresaId: string;
    conversaId: string;
    leadId: string | null;
    /** Valor que o cliente disse que a outra empresa cobrou (texto livre, ex.: "R$ 350"). */
    valorConcorrencia?: string | null;
    /** O que o cliente disse (trecho curto). */
    frase?: string | null;
  },
) {
  const referencia = `concorrente:${o.leadId ?? o.conversaId}`;
  const [{ data: lead }, { data: orc }] = await Promise.all([
    o.leadId
      ? db.from("crm_leads").select("lead_name").eq("id", o.leadId).maybeSingle()
      : Promise.resolve({ data: null }),
    o.leadId
      ? db
          .from("quotes")
          .select("total, numero")
          .eq("empresa_id", o.empresaId)
          .eq("crm_lead_id", o.leadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const nosso = reais((orc as { total?: unknown } | null)?.total) ?? "sem orçamento";
  const deles = o.valorConcorrencia?.trim() || "não informado";
  const titulo = `URGENTE: ${(lead as { lead_name?: string } | null)?.lead_name ?? "cliente"} foi para a concorrência`;
  const mensagem = [
    `Concorrência: ${deles} · Nosso orçamento: ${nosso}.`,
    o.frase ? `O cliente disse: "${o.frase.slice(0, 300)}".` : null,
    "Abra a conversa: a tarefa URGENTE já está no topo de Follow-ups.",
  ]
    .filter(Boolean)
    .join(" ");
  // Tempo real (05/11): cria ou sobe a tarefa P1 e manda push, sem esperar a noite.
  await tarefaUrgenteConcorrencia(db, {
    empresaId: o.empresaId,
    conversaId: o.conversaId,
    leadId: o.leadId,
    nome: (lead as { lead_name?: string } | null)?.lead_name ?? null,
    deles,
    nosso,
    frase: o.frase ?? null,
  }).catch((e) =>
    console.error("concorrência: tarefa urgente", e instanceof Error ? e.message : String(e)),
  );
  const { data: ja } = await db
    .from("mkt_avisos")
    .select("id")
    .eq("empresa_id", o.empresaId)
    .eq("referencia", referencia)
    .limit(1);
  if (ja?.length) {
    // Sem valor novo, o aviso que já existe fica como está.
    if (!o.valorConcorrencia?.trim()) return;
    await db
      .from("mkt_avisos")
      .update({
        titulo,
        mensagem,
        conversa_id: o.conversaId,
        lido_em: null,
        created_at: new Date().toISOString(),
      })
      .eq("id", ja[0]!.id);
    return;
  }
  await db.from("mkt_avisos").insert({
    empresa_id: o.empresaId,
    tipo: "concorrente",
    titulo,
    mensagem,
    conversa_id: o.conversaId,
    so_no_app: true,
    referencia,
  });
}

/** Mensagem pronta da tarefa de concorrência: pergunta o que pesou, sem prometer condição. */
export function mensagemConcorrencia(nome: string | null): string {
  const oi = nome ? `Oi, ${nome}!` : "Oi!";
  return `${oi} Vi aqui que você recebeu outro orçamento, e a gente faz questão de te atender. Me conta: o que pesou mais pra você, o valor ou a data do serviço?`;
}

/**
 * Tarefa P1 "URGENTE: cliente comparando com concorrente" (05/11): uma por lead; se já existe uma
 * tarefa aberta da equipe para o lead, ela sobe para P1 com o motivo novo. Push para quem tem o
 * celular ativado (equipe e admin), uma vez por lead e dia.
 */
export async function tarefaUrgenteConcorrencia(
  db: Db,
  o: {
    empresaId: string;
    conversaId: string;
    leadId: string | null;
    nome: string | null;
    deles: string;
    nosso: string;
    frase: string | null;
  },
): Promise<void> {
  if (!o.leadId) return;
  const motivo =
    `URGENTE: cliente comparando com concorrente · Concorrência: ${o.deles} · Nosso: ${o.nosso}`.slice(
      0,
      300,
    );
  const primeiro = (o.nome ?? "").trim().split(/\s+/)[0] || null;
  const { data: aberta } = await db
    .from("crm_followups")
    .select("id, prioridade, motivo")
    .eq("empresa_id", o.empresaId)
    .eq("crm_lead_id", o.leadId)
    .eq("origem", "gerente")
    .eq("responsavel", "equipe")
    .eq("status", "Pendente")
    .order("scheduled_at")
    .limit(1)
    .maybeSingle();
  const a = aberta as { id: string; prioridade: number | null; motivo: string | null } | null;
  // Já é a tarefa urgente de concorrência: não mexe de novo (nem manda push outra vez no dia).
  if (a && a.prioridade === 1 && (a.motivo ?? "").startsWith("URGENTE: cliente comparando")) return;
  if (aberta) {
    await db
      .from("crm_followups")
      .update({ prioridade: 1, motivo, scheduled_at: new Date().toISOString() })
      .eq("id", (aberta as { id: string }).id);
  } else {
    await db.from("crm_followups").insert({
      empresa_id: o.empresaId,
      crm_lead_id: o.leadId,
      conversa_id: o.conversaId,
      scheduled_at: new Date().toISOString(),
      status: "Pendente",
      responsavel: "equipe",
      trilha: "G",
      etapa: "GC",
      canal: "equipe",
      origem: "gerente",
      tarefa_tipo: "mensagem",
      prioridade: 1,
      mensagem: mensagemConcorrencia(primeiro),
      motivo,
      notes:
        `Tatiana: ${motivo}${o.frase ? ` · O cliente disse: "${o.frase.slice(0, 150)}"` : ""}`.slice(
          0,
          500,
        ),
    });
  }
  // Push para a equipe e o admin (uma vez por lead e dia).
  const { pessoasComCelular, registrarUmaVez, enviarParaPessoa } =
    await import("@/lib/push/notificacoes.server");
  const pessoas = (await pessoasComCelular(db as never, o.empresaId)).get(o.empresaId) ?? [];
  const dia = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const titulo = `URGENTE: ${primeiro ?? "cliente"} comparando com concorrente`;
  const corpo = `Concorrência: ${o.deles} · Nosso: ${o.nosso}. Tarefa no topo de Follow-ups.`;
  for (const p of pessoas) {
    if (p.papel !== "admin" && p.papel !== "atendente") continue;
    const id = await registrarUmaVez(
      db as never,
      o.empresaId,
      p.userId,
      "tatiana_tarefas",
      `concorrente:${o.leadId}:${dia}`,
      titulo,
    );
    if (!id) continue;
    const r = await enviarParaPessoa(db as never, p.celulares, {
      titulo,
      corpo,
      url: "/crm/follow-ups",
      tag: `concorrente-${o.leadId}`,
    });
    await db.from("push_envios").update({ enviados: r.enviados }).eq("id", id);
  }
}
