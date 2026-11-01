/** Busca no banco os eventos dos defeitos contados pelo sistema (últimos 30 dias). */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contarDefeitosSistema,
  doisToquesNoDia,
  fotosAntesDeAgendar,
  orcamentosSemCep,
  toquesComRetornoCombinado,
  type DefeitoSistemaContado,
} from "./defeitos-sistema";

type Db = SupabaseClient;

export async function defeitosDoSistema(
  db: Db,
  empresaId: string,
  agora = new Date(),
): Promise<DefeitoSistemaContado[]> {
  const inicio = new Date(agora.getTime() - 30 * 86_400_000).toISOString();
  const [{ data: qs }, { data: execs }, { data: toques }] = await Promise.all([
    db
      .from("quotes")
      .select("created_at, crm_lead_id, cliente_cep, cliente_endereco, observacoes")
      .eq("empresa_id", empresaId)
      .gte("created_at", inicio)
      .ilike("observacoes", "Criado pela % (IA)%")
      .limit(2000),
    db
      .from("ia_execucoes")
      .select("created_at, crm_lead_id, ferramentas")
      .eq("empresa_id", empresaId)
      .gte("created_at", inicio)
      .contains("ferramentas", [{ nome: "enviar_dados_tecnico" }])
      .limit(2000),
    db
      .from("crm_followups")
      .select("crm_lead_id, completed_at, trilha, respondido_em")
      .eq("empresa_id", empresaId)
      .eq("responsavel", "alice")
      .eq("status", "Concluída")
      .in("trilha", ["A", "B"])
      .gte("completed_at", inicio)
      .limit(5000),
  ]);
  const ts = (
    (toques ?? []) as Array<{
      crm_lead_id: string | null;
      completed_at: string;
      trilha: string | null;
      respondido_em: string | null;
    }>
  ).filter((t) => t.crm_lead_id);
  // Só conta quando o técnico foi de fato passado (resultado "Técnico: …"); recusa não conta.
  const envios = (
    (execs ?? []) as Array<{
      created_at: string;
      crm_lead_id: string | null;
      ferramentas: Array<{ nome?: string; resultado?: string }> | null;
    }>
  )
    .filter((e) =>
      (e.ferramentas ?? []).some(
        (f) => f.nome === "enviar_dados_tecnico" && (f.resultado ?? "").startsWith("Técnico:"),
      ),
    )
    .map((e) => ({ em: e.created_at, lead: e.crm_lead_id }));
  const ids = [
    ...new Set([...ts.map((t) => t.crm_lead_id!), ...envios.map((e) => e.lead).filter(Boolean)]),
  ] as string[];
  const agendado = new Map<string, string | null>();
  const retorno = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: leads } = await db
      .from("crm_leads")
      .select("id, os_criada_em, agendado_em, retorno_combinado_em")
      .eq("empresa_id", empresaId)
      .in("id", ids.slice(i, i + 200));
    for (const l of (leads ?? []) as Array<{
      id: string;
      os_criada_em: string | null;
      agendado_em: string | null;
      retorno_combinado_em: string | null;
    }>) {
      const ag = [l.os_criada_em, l.agendado_em].filter(Boolean).sort()[0] ?? null;
      agendado.set(l.id, ag);
      retorno.set(l.id, l.retorno_combinado_em);
    }
  }
  const eventos = [
    ...orcamentosSemCep(
      (
        (qs ?? []) as Array<{
          created_at: string;
          crm_lead_id: string | null;
          cliente_cep: string | null;
          cliente_endereco: string | null;
        }>
      ).map((q) => ({
        criadoEm: q.created_at,
        lead: q.crm_lead_id,
        cep: q.cliente_cep,
        endereco: q.cliente_endereco,
        daAlice: true,
      })),
    ),
    ...fotosAntesDeAgendar(envios, agendado),
    ...doisToquesNoDia(
      ts.map((t) => ({
        em: t.completed_at,
        lead: t.crm_lead_id!,
        respondido: Boolean(t.respondido_em),
      })),
    ),
    ...toquesComRetornoCombinado(
      ts.map((t) => ({ em: t.completed_at, lead: t.crm_lead_id!, trilha: t.trilha })),
      retorno,
    ),
  ];
  return contarDefeitosSistema(eventos, inicio, agora);
}
