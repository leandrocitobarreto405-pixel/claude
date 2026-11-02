/**
 * Histórico completo do contato (servidor): junta, pelo telefone (chave DDD + 8 dígitos) e pelos
 * vínculos (contato, leads, cliente), tudo o que a empresa já viveu com a pessoa antes da conversa
 * atual. Só leitura; consultas limitadas. Funciona com o cliente da pessoa (RLS) ou o do servidor
 * (com o filtro da empresa).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HISTORICO_VAZIO, type HistoricoContato } from "./historico-contato";

type Db = SupabaseClient;

const final8 = (tel: string | null | undefined) => (tel ?? "").replace(/\D/g, "").slice(-8);

export async function historicoDoContato(
  db: Db,
  o: {
    empresaId: string;
    telefone: string | null;
    contatoId?: string | null;
    /** Conversa atual (fica de fora da lista de anteriores). */
    conversaAtualId?: string | null;
    leadAtualId?: string | null;
  },
): Promise<HistoricoContato> {
  const fim = final8(o.telefone);
  if (!fim && !o.contatoId) return HISTORICO_VAZIO;
  const emp = o.empresaId;

  // Leads do mesmo telefone (todos), para orçamentos e cliente.
  const { data: leads } = fim
    ? await db
        .from("crm_leads")
        .select("id, created_at, customer_id, first_contact_date")
        .eq("empresa_id", emp)
        .like("normalized_phone", `%${fim}`)
        .order("created_at")
        .limit(20)
    : { data: [] };
  const ls = (leads ?? []) as Array<{
    id: string;
    created_at: string;
    customer_id: string | null;
    first_contact_date: string | null;
  }>;
  const leadIds = [...new Set([...ls.map((l) => l.id), ...(o.leadAtualId ? [o.leadAtualId] : [])])];
  const clienteIds = [...new Set(ls.map((l) => l.customer_id).filter(Boolean) as string[])];

  const [{ data: convs }, { data: quotes }, { data: contatos }, { data: envios }] =
    await Promise.all([
      o.contatoId
        ? db
            .from("conversas")
            .select("id, criada_em, encerrada_em, status")
            .eq("empresa_id", emp)
            .eq("whatsapp_contact_id", o.contatoId)
            .order("criada_em", { ascending: false })
            .limit(12)
        : Promise.resolve({ data: [] }),
      leadIds.length
        ? db
            .from("quotes")
            .select("numero, total, status, created_at, generated_work_order_id, crm_lead_id")
            .eq("empresa_id", emp)
            .in("crm_lead_id", leadIds)
            .order("created_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      o.contatoId
        ? db
            .from("whatsapp_contacts")
            .select("current_customer_id")
            .eq("id", o.contatoId)
            .eq("empresa_id", emp)
            .maybeSingle()
            .then((r) => ({ data: r.data ? [r.data] : [] }))
        : Promise.resolve({ data: [] }),
      fim
        ? db
            .from("mkt_envios")
            .select("enviado_em, respondido_em, mkt_campanhas(nome)")
            .eq("empresa_id", emp)
            .eq("status", "enviado")
            .like("normalized_phone", `%${fim}`)
            .order("enviado_em", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [] }),
    ]);
  for (const c of (contatos ?? []) as Array<{ current_customer_id: string | null }>)
    if (c.current_customer_id && !clienteIds.includes(c.current_customer_id))
      clienteIds.push(c.current_customer_id);

  // Clientes do mesmo telefone (cadastro da OS) que não vieram pelos leads.
  if (fim) {
    const { data: cs } = await db
      .from("customers")
      .select("id")
      .eq("empresa_id", emp)
      .like("phone", `%${fim}`)
      .limit(5);
    for (const c of (cs ?? []) as Array<{ id: string }>)
      if (!clienteIds.includes(c.id)) clienteIds.push(c.id);
  }
  const { data: oss } = clienteIds.length
    ? await db
        .from("work_orders")
        .select(
          "os_number, sale_date, status, total_gross_value, eh_teste, deleted_at, visits!visits_work_order_id_fkey ( scheduled_date, status, service_type:service_type_id ( name ) )",
        )
        .eq("empresa_id", emp)
        .in("customer_id", clienteIds)
        .is("deleted_at", null)
        .order("sale_date", { ascending: false })
        .limit(10)
    : { data: [] };

  type Conv = { id: string; criada_em: string; encerrada_em: string | null; status: string | null };
  const conversas = ((convs ?? []) as Conv[])
    .filter((c) => c.id !== o.conversaAtualId)
    .map((c) => ({
      id: c.id,
      inicio: c.criada_em,
      fim: c.encerrada_em,
      status: c.status,
      resumo: c.encerrada_em
        ? "encerrada"
        : c.status === "open"
          ? "aberta com a equipe"
          : (c.status ?? null),
    }));
  type Q = {
    numero: string | number | null;
    total: number | string;
    status: string;
    created_at: string;
    generated_work_order_id: string | null;
  };
  const orcamentos = ((quotes ?? []) as Q[])
    .filter((q) => q.status !== "rascunho")
    .map((q) => ({
      numero: q.numero === null ? null : String(q.numero),
      data: q.created_at,
      total: Number(q.total ?? 0),
      status: q.status,
      fechou: Boolean(q.generated_work_order_id) || q.status === "convertido",
    }));
  type Os = {
    os_number: string | number | null;
    sale_date: string | null;
    status: string | null;
    total_gross_value: number | string | null;
    eh_teste: boolean;
    visits: Array<{
      scheduled_date: string | null;
      status: string;
      service_type: { name: string } | null;
    }> | null;
  };
  const servicos = ((oss ?? []) as unknown as Os[])
    .filter((os) => !os.eh_teste && os.status !== "Cancelada")
    .map((os) => {
      const vs = (os.visits ?? []).filter((v) => v.status !== "Cancelado");
      const tipos = [...new Set(vs.map((v) => v.service_type?.name).filter(Boolean) as string[])];
      return {
        osNumero: os.os_number === null ? null : String(os.os_number),
        data:
          vs
            .map((v) => v.scheduled_date)
            .filter(Boolean)
            .sort()
            .at(-1) ?? os.sale_date,
        servico: tipos.join(" + ") || null,
        total: Number(os.total_gross_value ?? 0),
        status: os.status,
      };
    })
    .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
  const campanhas = (
    (envios ?? []) as unknown as Array<{
      enviado_em: string;
      respondido_em: string | null;
      mkt_campanhas: { nome: string } | null;
    }>
  ).map((e) => ({
    data: e.enviado_em,
    nome: e.mkt_campanhas?.nome ?? "campanha",
    respondeu: Boolean(e.respondido_em),
  }));
  const primeiroContato =
    [
      ...ls.map((l) => l.first_contact_date ?? l.created_at.slice(0, 10)),
      ...conversas.map((c) => c.inicio.slice(0, 10)),
    ]
      .filter(Boolean)
      .sort()[0] ?? null;
  const vazio = !conversas.length && !orcamentos.length && !servicos.length && !campanhas.length;
  return {
    primeiroContato: vazio ? null : primeiroContato,
    conversas,
    orcamentos,
    servicos,
    campanhas,
    vazio,
  };
}
