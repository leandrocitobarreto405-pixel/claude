/**
 * Aplica a regra do "Quem vendeu" (quem-vendeu.ts) às OS do período, só na leitura: troca a
 * vendedora de cada OS pela da regra antes de somar. Nada é gravado nas OS.
 * Usa o banco de serviço (transferências e mensagens), sempre filtrado pela empresa ativa.
 */
import type { OsVendido } from "@/lib/vendido";
import { vendedoraPelaRegra } from "@/lib/quem-vendeu";

type Execucao = { conversa_id: string; created_at: string; ferramentas: unknown };

function lotes<T>(xs: T[], n = 150): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n));
  return r;
}

function motivosDeTransferencia(ferramentas: unknown): string[] {
  if (!Array.isArray(ferramentas)) return [];
  return ferramentas
    .filter((f) => (f as { nome?: string })?.nome === "transferir_para_humano")
    .map((f) => String((f as { entrada?: { motivo?: string } }).entrada?.motivo ?? ""));
}

export async function aplicarQuemVendeu(empresaId: string, oss: OsVendido[]): Promise<OsVendido[]> {
  const ids = [...new Set(oss.map((o) => o.id))];
  if (!ids.length) return oss;
  const { dbServico } = await import("@/lib/mkt/contexto.server");
  const db = await dbServico();

  const [{ data: vendedoras }, osInfo, orcamentos] = await Promise.all([
    db.from("salespeople").select("id, name, user_id, eh_ia").eq("empresa_id", empresaId),
    Promise.all(
      lotes(ids).map((l) =>
        db.from("work_orders").select("id, created_at").eq("empresa_id", empresaId).in("id", l),
      ),
    ),
    Promise.all(
      lotes(ids).map((l) =>
        db
          .from("quotes")
          .select("generated_work_order_id, created_by, created_at, crm_lead_id")
          .eq("empresa_id", empresaId)
          .in("generated_work_order_id", l),
      ),
    ),
  ]);
  const alice = (vendedoras ?? []).find((v) => v.eh_ia)?.name ?? null;
  const porUsuario = new Map(
    (vendedoras ?? []).filter((v) => v.user_id).map((v) => [v.user_id as string, v.name]),
  );
  const criadaEm = new Map(osInfo.flatMap((r) => r.data ?? []).map((o) => [o.id, o.created_at]));
  // Orçamento mais recente que virou a OS.
  const orcamentoDaOs = new Map<
    string,
    { created_by: string | null; created_at: string; crm_lead_id: string | null }
  >();
  for (const q of orcamentos.flatMap((r) => r.data ?? [])) {
    const os = q.generated_work_order_id as string | null;
    if (!os) continue;
    const atual = orcamentoDaOs.get(os);
    if (!atual || q.created_at > atual.created_at) orcamentoDaOs.set(os, q);
  }

  const autor = (os: string) => {
    const q = orcamentoDaOs.get(os);
    if (!q) return null;
    return { vendedora: q.created_by ? (porUsuario.get(q.created_by) ?? null) : alice };
  };
  // Só precisa olhar a negociação quando o autor do orçamento é outra pessoa.
  const duvidosas = oss.filter((o) => {
    const a = autor(o.id);
    return a && a.vendedora && a.vendedora !== o.vendedora && criadaEm.get(o.id);
  });
  if (!duvidosas.length)
    return oss.map((o) => ({ ...o, vendedora: (autor(o.id)?.vendedora ?? o.vendedora) || null }));

  // Contato do cliente de cada OS: lead ligado à OS ou lead do orçamento.
  const leadsDoOrc = [
    ...new Set(duvidosas.map((o) => orcamentoDaOs.get(o.id)?.crm_lead_id).filter(Boolean)),
  ] as string[];
  const idsDuvidosas = duvidosas.map((o) => o.id);
  const [{ data: leadsOs }, { data: leadsQ }] = await Promise.all([
    db
      .from("crm_leads")
      .select("linked_work_order_id, whatsapp_contact_id")
      .eq("empresa_id", empresaId)
      .in("linked_work_order_id", idsDuvidosas),
    leadsDoOrc.length
      ? db
          .from("crm_leads")
          .select("id, whatsapp_contact_id")
          .eq("empresa_id", empresaId)
          .in("id", leadsDoOrc)
      : Promise.resolve({ data: [] as Array<{ id: string; whatsapp_contact_id: string | null }> }),
  ]);
  const contatoDaOs = new Map<string, string>();
  for (const l of leadsOs ?? [])
    if (l.linked_work_order_id && l.whatsapp_contact_id)
      contatoDaOs.set(l.linked_work_order_id, l.whatsapp_contact_id);
  const contatoDoLead = new Map((leadsQ ?? []).map((l) => [l.id, l.whatsapp_contact_id]));
  for (const o of duvidosas) {
    if (contatoDaOs.has(o.id)) continue;
    const c = contatoDoLead.get(orcamentoDaOs.get(o.id)?.crm_lead_id ?? "");
    if (c) contatoDaOs.set(o.id, c);
  }
  const contatos = [...new Set(contatoDaOs.values())];
  const janelas = duvidosas.map((o) => ({
    os: o.id,
    de: orcamentoDaOs.get(o.id)!.created_at,
    ate: criadaEm.get(o.id)!,
  }));
  const inicio = janelas.map((j) => j.de).sort()[0]!;
  const fim = janelas
    .map((j) => j.ate)
    .sort()
    .at(-1)!;

  const [msgs, conversas] = contatos.length
    ? await Promise.all([
        Promise.all(
          lotes(contatos).map((l) =>
            db
              .from("whatsapp_messages")
              .select("whatsapp_contact_id, message_timestamp, text_content")
              .eq("empresa_id", empresaId)
              .eq("direction", "Enviada")
              .eq("remetente_tipo", "user")
              .eq("privada", false)
              .in("whatsapp_contact_id", l)
              .gte("message_timestamp", inicio)
              .lte("message_timestamp", fim)
              .limit(5000),
          ),
        ),
        Promise.all(
          lotes(contatos).map((l) =>
            db
              .from("conversas")
              .select("id, whatsapp_contact_id")
              .eq("empresa_id", empresaId)
              .in("whatsapp_contact_id", l),
          ),
        ),
      ])
    : [[], []];
  const contatoDaConversa = new Map(
    conversas.flatMap((r) => r.data ?? []).map((c) => [c.id, c.whatsapp_contact_id as string]),
  );
  const execucoes = contatoDaConversa.size
    ? await Promise.all(
        lotes([...contatoDaConversa.keys()]).map((l) =>
          db
            .from("ia_execucoes")
            .select("conversa_id, created_at, ferramentas")
            .eq("empresa_id", empresaId)
            .in("conversa_id", l)
            .gte("created_at", inicio)
            .lte("created_at", fim)
            .limit(5000),
        ),
      )
    : [];
  const mensagens = msgs.flatMap((r) => r.data ?? []);
  const transferencias = execucoes.flatMap((r) => (r.data ?? []) as Execucao[]);

  const negociacao = new Map<string, { transferencias: string[]; mensagensEquipe: string[] }>();
  for (const j of janelas) {
    const contato = contatoDaOs.get(j.os);
    if (!contato) {
      negociacao.set(j.os, { transferencias: [], mensagensEquipe: [] });
      continue;
    }
    negociacao.set(j.os, {
      mensagensEquipe: mensagens
        .filter(
          (m) =>
            m.whatsapp_contact_id === contato &&
            m.message_timestamp >= j.de &&
            m.message_timestamp <= j.ate,
        )
        .map((m) => m.text_content ?? ""),
      transferencias: transferencias
        .filter(
          (e) =>
            contatoDaConversa.get(e.conversa_id) === contato &&
            e.created_at >= j.de &&
            e.created_at <= j.ate,
        )
        .flatMap((e) => motivosDeTransferencia(e.ferramentas)),
    });
  }

  return oss.map((o) => {
    const a = autor(o.id);
    const n = negociacao.get(o.id) ?? { transferencias: [], mensagensEquipe: [] };
    const { vendedora } = vendedoraPelaRegra({
      vendedoraOs: o.vendedora ?? null,
      orcamento: a,
      ...n,
    });
    return { ...o, vendedora };
  });
}
