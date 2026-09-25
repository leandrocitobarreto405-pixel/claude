import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, SectionCard } from "@/components/app-shell";
import { LeadLink, NativeSelect, TemperatureBadge } from "@/components/crm-ui";
import { supabase } from "@/integrations/supabase/client";
import {
  CRM_RESULT_KIND,
  completeFollowup,
  formatPhoneBR,
  scheduleFollowup,
  suggestFollowupAt,
  useCrmCatalog,
  useCrmInvalidate,
} from "@/lib/crm";
import { dateTimeBR, todayISO, whatsappLink } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/crm/repescagens")({
  head: () => ({
    meta: [
      { title: "Repescagens do CRM — Nexa OS" },
      {
        name: "description",
        content:
          "Retornos vencidos, de hoje e próximos, com registro do que aconteceu em cada contato.",
      },
      { property: "og:title", content: "Repescagens do CRM — Nexa OS" },
      {
        property: "og:description",
        content:
          "Retornos vencidos, de hoje e próximos, com registro do que aconteceu em cada contato.",
      },
    ],
  }),
  component: Repescagens,
});

type FollowupRow = {
  id: string;
  crm_lead_id: string;
  scheduled_at: string;
  status: string;
  notes: string | null;
  lead: {
    id: string;
    lead_name: string;
    phone: string;
    temperature: string;
    temperature_confirmed: boolean;
    upholstery_description: string | null;
    summary: string | null;
    last_follow_up_at: string | null;
  } | null;
};

function Repescagens() {
  const invalidate = useCrmInvalidate();
  const { data: resultados } = useCrmCatalog(CRM_RESULT_KIND);
  const [resultado, setResultado] = useState<Record<string, string>>({});
  const [obs, setObs] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["crm_followups", "pendentes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_followups")
        .select(
          `id, crm_lead_id, scheduled_at, status, notes,
           lead:crm_lead_id ( id, lead_name, phone, temperature, temperature_confirmed, upholstery_description, summary, last_follow_up_at )`,
        )
        .eq("status", "Pendente")
        .order("scheduled_at");
      if (error) throw error;
      return (data ?? []) as unknown as FollowupRow[];
    },
  });

  const semResposta = useQuery({
    queryKey: ["crm_followups", "sem-resposta"],
    queryFn: async () => {
      const limite = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
      const { data, error } = await supabase
        .from("crm_leads")
        .select(
          "id, lead_name, phone, temperature, temperature_confirmed, last_interaction_at, next_follow_up_at",
        )
        .eq("is_open", true)
        .is("next_follow_up_at", null)
        .lt("last_interaction_at", limite)
        .order("last_interaction_at")
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const grupos = useMemo(() => {
    const rows = query.data ?? [];
    const hoje = todayISO();
    const agora = new Date().toISOString();
    return {
      vencidas: rows.filter((f) => f.scheduled_at < agora && f.scheduled_at.slice(0, 10) < hoje),
      hoje: rows.filter((f) => f.scheduled_at.slice(0, 10) === hoje),
      proximas: rows.filter((f) => f.scheduled_at.slice(0, 10) > hoje),
    };
  }, [query.data]);

  async function registrar(f: FollowupRow) {
    const res = resultado[f.id];
    if (!res) {
      toast.error("Selecione o que aconteceu neste contato.");
      return;
    }
    try {
      await completeFollowup(f.id, f.crm_lead_id, res, obs[f.id]?.slice(0, 500));
      toast.success("Contato realizado e registrado.");
      invalidate();
      void query.refetch();
      void semResposta.refetch();
    } catch {
      toast.error("Não foi possível registrar o contato.");
    }
  }

  function Cartao({ f }: { f: FollowupRow }) {
    const link = whatsappLink(f.lead?.phone, undefined);
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {f.lead ? (
              <LeadLink id={f.lead.id}>{f.lead.lead_name || "Sem nome"}</LeadLink>
            ) : (
              "Lead removido"
            )}
            <p className="text-xs text-muted-foreground">
              {formatPhoneBR(f.lead?.phone)} · agendado para {dateTimeBR(f.scheduled_at)}
            </p>
          </div>
          {f.lead ? (
            <TemperatureBadge
              temperature={f.lead.temperature}
              suggested={!f.lead.temperature_confirmed}
            />
          ) : null}
        </div>
        {f.lead?.summary ? (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{f.lead.summary}</p>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">O que aconteceu?</Label>
            <NativeSelect
              value={resultado[f.id] ?? ""}
              onChange={(v) => setResultado((prev) => ({ ...prev, [f.id]: v }))}
              options={(resultados ?? []).map((r) => ({ value: r.name, label: r.name }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Observações</Label>
            <Textarea
              rows={2}
              maxLength={500}
              value={obs[f.id] ?? ""}
              onChange={(e) => setObs((prev) => ({ ...prev, [f.id]: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void registrar(f)}>
            Contato realizado
          </Button>
          {link ? (
            <Button size="sm" variant="outline" asChild className="gap-2">
              <a href={link} target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" /> Abrir WhatsApp
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const nada =
    grupos.vencidas.length === 0 && grupos.hoje.length === 0 && grupos.proximas.length === 0;

  return (
    <>
      <PageHeader
        title="Repescagens"
        description="Retornos combinados com o cliente. O envio da mensagem é sempre manual."
      />

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando repescagens...</p>
      ) : nada ? (
        <EmptyState
          icon={CalendarClock}
          title="Nenhuma repescagem pendente"
          description="Agende retornos na tela do lead para acompanhar quem ainda não respondeu."
        />
      ) : (
        <div className="grid gap-4">
          {grupos.vencidas.length > 0 ? (
            <SectionCard title={`Vencidas (${grupos.vencidas.length})`} accent="danger">
              <div className="grid gap-3">
                {grupos.vencidas.map((f) => (
                  <Cartao key={f.id} f={f} />
                ))}
              </div>
            </SectionCard>
          ) : null}
          {grupos.hoje.length > 0 ? (
            <SectionCard title={`De hoje (${grupos.hoje.length})`} accent="warning">
              <div className="grid gap-3">
                {grupos.hoje.map((f) => (
                  <Cartao key={f.id} f={f} />
                ))}
              </div>
            </SectionCard>
          ) : null}
          {grupos.proximas.length > 0 ? (
            <SectionCard title={`Próximas (${grupos.proximas.length})`}>
              <div className="grid gap-3">
                {grupos.proximas.map((f) => (
                  <Cartao key={f.id} f={f} />
                ))}
              </div>
            </SectionCard>
          ) : null}
        </div>
      )}

      <div className="mt-4">
        <SectionCard
          title={`Sem resposta há mais de 3 dias (${(semResposta.data ?? []).length})`}
          description="Sugestão de repescagem. Nada é marcado como perdido automaticamente."
          accent="navy"
        >
          {(semResposta.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lead parado no momento.</p>
          ) : (
            <div className="grid gap-2">
              {(semResposta.data ?? []).map((l) => (
                <div
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <LeadLink id={l.id}>{l.lead_name || "Sem nome"}</LeadLink>
                    <p className="text-xs text-muted-foreground">
                      {formatPhoneBR(l.phone)} · última interação{" "}
                      {l.last_interaction_at ? dateTimeBR(l.last_interaction_at) : "—"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await scheduleFollowup(l.id, suggestFollowupAt(24));
                        toast.success("Repescagem agendada para 24h.");
                        invalidate();
                        void query.refetch();
                        void semResposta.refetch();
                      } catch {
                        toast.error("Não foi possível agendar a repescagem.");
                      }
                    }}
                  >
                    Criar repescagem
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Agendar repescagem manual" description="Para um lead específico.">
          <AgendarManual onDone={() => void query.refetch()} />
        </SectionCard>
      </div>
    </>
  );
}

function AgendarManual({ onDone }: { onDone: () => void }) {
  const [leadId, setLeadId] = useState("");
  const [quando, setQuando] = useState("");
  const invalidate = useCrmInvalidate();

  const abertos = useQuery({
    queryKey: ["crm_leads_abertos_simples"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id, lead_name, phone")
        .eq("is_open", true)
        .order("last_interaction_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="m-lead">Lead</Label>
        <NativeSelect
          id="m-lead"
          value={leadId}
          onChange={setLeadId}
          options={(abertos.data ?? []).map((l) => ({
            value: l.id,
            label: `${l.lead_name || "Sem nome"} — ${formatPhoneBR(l.phone)}`,
          }))}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-quando">Data e hora</Label>
        <Input
          id="m-quando"
          type="datetime-local"
          value={quando}
          onChange={(e) => setQuando(e.target.value)}
        />
      </div>
      <Button
        onClick={async () => {
          if (!leadId || !quando) {
            toast.error("Escolha o lead e a data do retorno.");
            return;
          }
          try {
            await scheduleFollowup(leadId, new Date(quando).toISOString());
            toast.success("Repescagem agendada.");
            setLeadId("");
            setQuando("");
            invalidate();
            onDone();
          } catch {
            toast.error("Não foi possível agendar a repescagem.");
          }
        }}
      >
        Agendar
      </Button>
    </div>
  );
}
