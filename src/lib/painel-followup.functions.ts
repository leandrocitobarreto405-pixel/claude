import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import {
  funilAliceEquipe,
  porSemana,
  porToque,
  type FunilAliceEquipe,
  type LeadBruto,
  type LinhaSemana,
  type LinhaToque,
  type ToqueBruto,
} from "@/lib/painel-followup";
import type { Papel } from "@/lib/tenant";

// Painel de follow-up (item H): só leitura do que já está no banco.

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PAPEIS: Papel[] = ["admin", "atendente", "tecnico"];

export type PainelFollowup = {
  toques: LinhaToque[];
  semanas: LinhaSemana[];
  funil: FunilAliceEquipe;
};

/** Início do dia (São Paulo) em ISO. */
const inicioSP = (d: string) => new Date(`${d}T00:00:00-03:00`).toISOString();

export const painelFollowupFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { de: string; ate: string }) => {
    if (!DATA.test(input.de) || !DATA.test(input.ate) || input.ate < input.de)
      throw new Error("Período inválido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<PainelFollowup> => {
    const { data: papel } = await context.supabase.rpc("meu_papel" as never);
    if (!PAPEIS.includes(papel as unknown as Papel) || (papel as unknown) === "tecnico")
      throw new Error("Sem acesso.");
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    const emp = context.empresaId;
    const de = inicioSP(data.de);
    const fim = new Date(
      new Date(`${data.ate}T00:00:00-03:00`).getTime() + 86_400_000,
    ).toISOString();

    const [{ data: toques }, { data: leads }] = await Promise.all([
      db
        .from("crm_followups")
        .select("trilha, etapa, status, canal, result, scheduled_at, respondido_em, crm_lead_id")
        .eq("empresa_id", emp)
        .not("trilha", "is", null)
        .gte("scheduled_at", de)
        .lt("scheduled_at", fim)
        .limit(5000),
      db
        .from("crm_leads")
        .select(
          "id, primeira_mensagem_em, created_at, orcamento_enviado_em, os_criada_em, realizado_em",
        )
        .eq("empresa_id", emp)
        // Só quem chamou (como nos Indicadores); os leads dos disparos ficam de fora.
        .eq("entrada", "receptivo")
        .gte("created_at", de)
        .lt("created_at", fim)
        .limit(5000),
    ]);

    const listaToques = (toques ?? []) as ToqueBruto[];
    const idsDosToques = [
      ...new Set(listaToques.map((t) => t.crm_lead_id).filter((x): x is string => Boolean(x))),
    ];
    const { data: leadsDosToques } = idsDosToques.length
      ? await db.from("crm_leads").select("id, os_criada_em").in("id", idsDosToques)
      : { data: [] as Array<{ id: string; os_criada_em: string | null }> };
    const osDoLead = new Map((leadsDosToques ?? []).map((l) => [l.id, l.os_criada_em]));

    // Quem orçou: o orçamento mais recente do lead sem usuário é da Alice.
    const listaLeads = leads ?? [];
    const idsComOrcamento = listaLeads.filter((l) => l.orcamento_enviado_em).map((l) => l.id);
    const { data: orcamentos } = idsComOrcamento.length
      ? await db
          .from("quotes")
          .select("crm_lead_id, created_by, total, created_at")
          .eq("empresa_id", emp)
          .in("crm_lead_id", idsComOrcamento)
          .order("created_at", { ascending: false })
          .limit(5000)
      : {
          data: [] as Array<{
            crm_lead_id: string | null;
            created_by: string | null;
            total: number | null;
          }>,
        };
    const ultimoOrcamento = new Map<string, { created_by: string | null; total: number | null }>();
    for (const q of orcamentos ?? [])
      if (q.crm_lead_id && !ultimoOrcamento.has(q.crm_lead_id))
        ultimoOrcamento.set(q.crm_lead_id, q);

    const brutos: LeadBruto[] = listaLeads.map((l) => {
      const q = ultimoOrcamento.get(l.id);
      return {
        id: l.id,
        entrada_em: l.primeira_mensagem_em ?? l.created_at,
        orcamento_enviado_em: l.orcamento_enviado_em,
        os_criada_em: l.os_criada_em,
        realizado_em: l.realizado_em,
        orcou: q ? (q.created_by ? "equipe" : "alice") : null,
        valor: q?.total ?? null,
      };
    });

    return {
      toques: porToque(listaToques, osDoLead),
      semanas: porSemana(listaToques, osDoLead),
      funil: funilAliceEquipe(brutos),
    };
  });
