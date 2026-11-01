/**
 * Tatiana, gerente do mês, etapa 3 (servidor): números da semana da equipe (sempre da equipe
 * toda) e o bloco "Mês" do relatório de domingo. Sem IA; nada é enviado a clientes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { linhaDaMeta, resumoSemana, type MesRelatorio, type SemanaEquipe } from "./equipe";
import { calcularMes, liquidoDaOs, osVendidasNoPeriodo } from "./mes.server";
import type { AcaoPlano } from "./plano";

type Db = SupabaseClient;

function somarDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Semana da equipe (últimos 7 dias e os 7 anteriores), só da empresa. */
export async function semanaDaEquipe(db: Db, emp: string, hoje: string): Promise<SemanaEquipe> {
  const agora = new Date();
  const desde14 = somarDias(hoje, -14);
  const desde14Iso = `${desde14}T00:00:00-03:00`;
  const [{ data: leads }, { data: quotes }, vendas, { data: tarefas }, { data: acertos }] =
    await Promise.all([
      db
        .from("crm_leads")
        .select("first_contact_date")
        .eq("empresa_id", emp)
        .eq("entrada", "receptivo")
        .gte("first_contact_date", desde14)
        .limit(5000),
      db
        .from("quotes")
        .select("created_at")
        .eq("empresa_id", emp)
        .in("status", ["enviado", "aprovado", "recusado", "convertido"])
        .gte("created_at", desde14Iso)
        .limit(5000),
      osVendidasNoPeriodo(db, emp, desde14, hoje),
      db
        .from("crm_followups")
        .select("status, pulado_motivo, concluida_em, scheduled_at")
        .eq("empresa_id", emp)
        .eq("origem", "gerente")
        .eq("responsavel", "equipe")
        .or(`concluida_em.gte.${desde14Iso},status.eq.Pendente`)
        .limit(5000),
      db
        .from("comercial_cobrancas")
        .select("situacao, resolvida_em")
        .eq("empresa_id", emp)
        .or(`resolvida_em.gte.${desde14Iso},situacao.eq.pendente`)
        .limit(5000),
    ]);
  return resumoSemana({
    agora,
    leads: ((leads ?? []) as Array<{ first_contact_date: string }>).map(
      (l) => l.first_contact_date,
    ),
    orcamentos: ((quotes ?? []) as Array<{ created_at: string }>).map((q) => q.created_at),
    vendas: vendas
      .filter((os) => os.sale_date)
      .map((os) => ({ data: os.sale_date as string, valor: liquidoDaOs(os, hoje) })),
    tarefas: (
      (tarefas ?? []) as Array<{
        status: string;
        pulado_motivo: string | null;
        concluida_em: string | null;
        scheduled_at: string;
      }>
    ).map((t) => ({
      status: t.status,
      pulada: t.status === "Cancelada" && t.pulado_motivo !== null,
      quando: t.concluida_em,
    })),
    acertos: ((acertos ?? []) as Array<{ situacao: string; resolvida_em: string | null }>).map(
      (a) => ({ situacao: a.situacao, resolvidaEm: a.resolvida_em }),
    ),
  });
}

/** Bloco "Mês" do relatório de domingo: meta, previsão, agenda, alertas, plano da semana e equipe. */
export async function mesParaRelatorio(
  db: Db,
  emp: string,
  hoje: string,
  diasUteis: number[],
): Promise<MesRelatorio> {
  const [m, semana, { data: planos }] = await Promise.all([
    calcularMes(db, emp, hoje, diasUteis),
    semanaDaEquipe(db, emp, hoje),
    db
      .from("comercial_planos")
      .select("acoes")
      .eq("empresa_id", emp)
      .gte("dia", somarDias(hoje, -6))
      .limit(10),
  ]);
  const acoes = ((planos ?? []) as Array<{ acoes: AcaoPlano[] }>).flatMap((p) => p.acoes ?? []);
  const ids = acoes.map((a) => a.campanhaId).filter(Boolean) as string[];
  const { data: ks } = ids.length
    ? await db.from("mkt_campanhas").select("nome").in("id", ids).limit(20)
    : { data: [] };
  return {
    frase: linhaDaMeta(
      m.meta,
      m.agenda.vazios.map((d) => d.data),
    ),
    meta: m.meta,
    previsao: {
      total: m.previsao.total,
      chegaA: m.previsao.chegaA,
      pctDaMeta: m.previsao.pctDaMeta,
    },
    agenda: {
      livres: m.agenda.livres,
      base: m.agenda.base,
      vazios: m.agenda.vazios.map((d) => d.data),
    },
    alertas: m.alertas.map((a) => a.titulo),
    planos: {
      propostas: acoes.length,
      aprovadas: acoes.filter((a) => a.status === "aprovada").length,
      recusadas: acoes.filter((a) => a.status === "recusada").length,
      pendentes: acoes.filter((a) => a.status === "sugerida").length,
      campanhas: ((ks ?? []) as Array<{ nome: string }>).map((k) => k.nome),
    },
    semana,
  };
}
