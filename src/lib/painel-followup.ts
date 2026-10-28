/**
 * Painel de follow-up (item H): o que cada toque da cadência fez (por trilha, toque e semana) e o
 * funil Alice × equipe. Só a parte pura; a leitura do banco fica em painel-followup.functions.ts.
 */

export type ToqueBruto = {
  trilha: string | null;
  etapa: string | null;
  status: string;
  canal: string | null;
  result: string | null;
  scheduled_at: string;
  respondido_em: string | null;
  crm_lead_id: string | null;
};

export type LeadBruto = {
  id: string;
  entrada_em: string | null;
  orcamento_enviado_em: string | null;
  os_criada_em: string | null;
  realizado_em: string | null;
  /** Quem fez o orçamento mais recente: "alice" (sem usuário) ou "equipe". */
  orcou: "alice" | "equipe" | null;
  valor: number | null;
};

export type MotivoCancelado = "respondeu" | "equipe" | "contexto" | "remarcado" | "outros";

export const ROTULO_CANCELADO: Record<MotivoCancelado, string> = {
  respondeu: "Cliente respondeu antes",
  equipe: "Equipe assumiu ou trava",
  contexto: "Contexto (desistiu, concorrência…)",
  remarcado: "Remarcado",
  outros: "Outros",
};

export function motivoDoCancelado(result: string | null): MotivoCancelado {
  const r = (result ?? "").toLowerCase();
  if (r.startsWith("cliente respondeu")) return "respondeu";
  if (r.startsWith("contexto:")) return "contexto";
  if (r.startsWith("substitu")) return "remarcado";
  if (
    /equipe|atendente|humano|assumiu|os |agend|visita|ganho|perdid|descadastr|ia desligada/.test(r)
  )
    return "equipe";
  return "outros";
}

/** Nome do toque: A1…A5, B1…B4, R (retomada), C (data combinada) ou "Avulso". */
export function nomeDoToque(t: Pick<ToqueBruto, "trilha" | "etapa">): string {
  if (t.etapa) return t.etapa;
  if (t.trilha === "C") return "C";
  return t.trilha ? `${t.trilha} (avulso)` : "Avulso";
}

/** Segunda-feira da semana (São Paulo) do instante, em ISO curto. */
export function semanaDe(iso: string): string {
  const dia = new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const d = new Date(`${dia}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export type LinhaToque = {
  toque: string;
  agendados: number;
  enviados: number;
  responderam: number;
  viraramOs: number;
  cancelados: Record<MotivoCancelado, number>;
  pendentes: number;
};

const vazioCancelados = (): Record<MotivoCancelado, number> => ({
  respondeu: 0,
  equipe: 0,
  contexto: 0,
  remarcado: 0,
  outros: 0,
});

/** Ordem natural: A1…, B1…, R, C, avulsos. */
function ordemDoToque(t: string): string {
  const m = /^([ABR])(\d*)/.exec(t);
  if (m) return `${"ABR".indexOf(m[1]!)}${m[2]!.padStart(2, "0")}`;
  return t === "C" ? "3" : `4${t}`;
}

/**
 * Por toque: enviados (concluídos com canal), responderam (resposta registrada depois do toque),
 * viraram OS (OS criada depois do toque) e cancelados por motivo.
 */
export function porToque(toques: ToqueBruto[], osDoLead: Map<string, string | null>): LinhaToque[] {
  const linhas = new Map<string, LinhaToque>();
  for (const t of toques) {
    const nome = nomeDoToque(t);
    const l =
      linhas.get(nome) ??
      ({
        toque: nome,
        agendados: 0,
        enviados: 0,
        responderam: 0,
        viraramOs: 0,
        cancelados: vazioCancelados(),
        pendentes: 0,
      } satisfies LinhaToque);
    l.agendados++;
    if (t.status === "Concluída" && t.canal) {
      l.enviados++;
      if (t.respondido_em) l.responderam++;
      const os = t.crm_lead_id ? osDoLead.get(t.crm_lead_id) : null;
      if (os && os > t.scheduled_at) l.viraramOs++;
    } else if (t.status === "Cancelada") {
      l.cancelados[motivoDoCancelado(t.result)]++;
    } else if (t.status === "Pendente") {
      l.pendentes++;
    }
    linhas.set(nome, l);
  }
  return [...linhas.values()].sort((a, b) =>
    ordemDoToque(a.toque).localeCompare(ordemDoToque(b.toque)),
  );
}

export type LinhaSemana = {
  semana: string;
  enviados: number;
  responderam: number;
  viraramOs: number;
};

export function porSemana(
  toques: ToqueBruto[],
  osDoLead: Map<string, string | null>,
): LinhaSemana[] {
  const linhas = new Map<string, LinhaSemana>();
  for (const t of toques) {
    if (t.status !== "Concluída" || !t.canal) continue;
    const s = semanaDe(t.scheduled_at);
    const l = linhas.get(s) ?? { semana: s, enviados: 0, responderam: 0, viraramOs: 0 };
    l.enviados++;
    if (t.respondido_em) l.responderam++;
    const os = t.crm_lead_id ? osDoLead.get(t.crm_lead_id) : null;
    if (os && os > t.scheduled_at) l.viraramOs++;
    linhas.set(s, l);
  }
  return [...linhas.values()].sort((a, b) => a.semana.localeCompare(b.semana));
}

export type EtapaFunil = {
  orcamentos: number;
  agendaram: number;
  realizados: number;
  valorAgendado: number;
};

export type FunilAliceEquipe = {
  leadsNovos: number;
  semOrcamento: number;
  alice: EtapaFunil;
  equipe: EtapaFunil;
};

/** Funil dos leads que entraram no período, separado por quem fez o orçamento. */
export function funilAliceEquipe(leads: LeadBruto[]): FunilAliceEquipe {
  const etapa = (): EtapaFunil => ({
    orcamentos: 0,
    agendaram: 0,
    realizados: 0,
    valorAgendado: 0,
  });
  const r: FunilAliceEquipe = {
    leadsNovos: leads.length,
    semOrcamento: 0,
    alice: etapa(),
    equipe: etapa(),
  };
  for (const l of leads) {
    if (!l.orcamento_enviado_em || !l.orcou) {
      r.semOrcamento++;
      continue;
    }
    const e = r[l.orcou];
    e.orcamentos++;
    if (l.os_criada_em) {
      e.agendaram++;
      e.valorAgendado += Number(l.valor ?? 0);
    }
    if (l.realizado_em) e.realizados++;
  }
  return r;
}
