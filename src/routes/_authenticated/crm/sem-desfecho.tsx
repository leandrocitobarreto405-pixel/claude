import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Sparkles } from "lucide-react";
import { AbasDeRota } from "@/components/nexa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, SectionCard } from "@/components/app-shell";
import { LeadLink, NativeSelect } from "@/components/crm-ui";
import { supabase } from "@/integrations/supabase/client";
import { ABAS_DE_TELA } from "@/lib/menu";
import { useCrmCatalog, useCrmInvalidate } from "@/lib/crm";
import { brl, currentMonth, dateBR, monthEnd, monthStart, todayISO } from "@/lib/format";
import { rotuloServico } from "@/lib/sem-desfecho";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/crm/sem-desfecho")({
  head: () => ({
    meta: [
      { title: "Orçamentos sem desfecho — Nexa OS" },
      {
        name: "description",
        content: "Orçamentos enviados que não viraram OS: marque o motivo em um clique.",
      },
    ],
  }),
  component: SemDesfecho,
});

type LeadSemDesfecho = {
  id: string;
  nome: string;
  servico: string | null;
  valor: number | null;
  enviado_em: string;
  origem: string | null;
  resumo: string | null;
  sugerido: string | null;
  data_desejada: string | null;
  entrou: "cadencia" | "validade";
  conversa_id: string | null;
};

type Motivo = {
  id: string;
  nome: string;
  pede_data: "desejada" | "retorno" | null;
  adiou: boolean;
  nao_conta: boolean;
};

type Perdas = {
  motivos: { motivo: string; quantidade: number; valor: number; nao_conta: boolean }[];
  total: { quantidade: number; valor: number };
  agenda_cheia: {
    servico: string;
    quantidade: number;
    valor: number;
    dias_frente_media: number | null;
  }[];
};

function SemDesfecho() {
  const lista = useQuery({
    queryKey: ["crm_leads", "sem-desfecho"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("leads_sem_desfecho");
      if (error) throw error;
      return (data ?? []) as unknown as LeadSemDesfecho[];
    },
  });
  const motivos = useQuery({
    queryKey: ["crm_catalog", "motivos-sem-desfecho"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("motivos_sem_desfecho");
      if (error) throw error;
      return (data ?? []) as unknown as Motivo[];
    },
  });
  const leads = lista.data ?? [];

  return (
    <>
      <PageHeader
        title="Leads e funil"
        description="Orçamentos enviados que não viraram OS. Marque por que não fechou: vira o relatório de perdas."
      />
      <AbasDeRota abas={ABAS_DE_TELA.leads} rotulo="Leads e funil" className="mb-4" />

      <SectionCard
        title={
          lista.isLoading
            ? "Orçamentos sem desfecho"
            : `Orçamentos sem desfecho · ${leads.length} esperando o motivo`
        }
        description="Entram quando a Alice termina os follow-ups sem resposta, quando ela sugere um motivo ou quando o orçamento vence há 2 dias. Lead que vira OS sai sozinho."
      >
        {lista.error ? (
          <p className="text-sm text-problema-foreground">
            Não deu para carregar: {(lista.error as Error).message}
          </p>
        ) : lista.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !leads.length ? (
          <EmptyState
            title="Nenhum orçamento esperando o motivo"
            description="Quando um orçamento ficar sem resposta, ele aparece aqui."
          />
        ) : (
          <ul className="space-y-3">
            {leads.map((l) => (
              <LinhaLead key={l.id} lead={l} motivos={motivos.data ?? []} />
            ))}
          </ul>
        )}
      </SectionCard>

      <RelatorioPerdas />
    </>
  );
}

function LinhaLead({ lead, motivos }: { lead: LeadSemDesfecho; motivos: Motivo[] }) {
  const invalidate = useCrmInvalidate();
  const qc = useQueryClient();
  const [escolhido, setEscolhido] = useState<Motivo | null>(null);
  const [data, setData] = useState(lead.data_desejada ?? "");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const sugerido = motivos.find((m) => m.nome === lead.sugerido) ?? null;
  // A sugestão da Alice vem primeiro.
  const ordenados = sugerido ? [sugerido, ...motivos.filter((m) => m.id !== sugerido.id)] : motivos;

  async function registrar(m: Motivo, dataEscolhida?: string) {
    if (m.pede_data === "retorno" && !dataEscolhida) {
      toast.error("Informe a data para voltar a falar com o cliente.");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc("registrar_desfecho", {
      _lead: lead.id,
      _motivo: m.id,
      ...(obs.trim() ? { _obs: obs.trim() } : {}),
      ...(dataEscolhida ? { _data: dataEscolhida } : {}),
    });
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      m.adiou ? `Volta para o follow-up em ${dateBR(dataEscolhida)}.` : `Motivo: ${m.nome}`,
    );
    invalidate();
    void qc.invalidateQueries({ queryKey: ["perdas-por-motivo"] });
  }

  function clicar(m: Motivo) {
    if (m.pede_data) {
      setEscolhido(escolhido?.id === m.id ? null : m);
      return;
    }
    void registrar(m);
  }

  return (
    <li className="rounded-card border bg-card p-3 shadow-card sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <LeadLink id={lead.id}>{lead.nome}</LeadLink>
          <p className="text-sm text-muted-foreground">
            {[lead.servico, lead.origem].filter(Boolean).join(" · ") || "Sem serviço informado"}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold tabular-nums">{lead.valor != null ? brl(lead.valor) : "—"}</p>
          <p className="text-xs text-muted-foreground">Orçamento de {dateBR(lead.enviado_em)}</p>
        </div>
      </div>
      {lead.resumo ? (
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{lead.resumo}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          {lead.entrou === "cadencia" ? "Terminou os follow-ups" : "Orçamento vencido"}
        </span>
        {lead.sugerido ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-atencao px-2 py-0.5 text-atencao-foreground">
            <Sparkles className="size-3" aria-hidden /> Alice sugere: {lead.sugerido}
          </span>
        ) : null}
        {lead.conversa_id ? (
          <Link
            to="/conversas/$conversaId"
            params={{ conversaId: lead.conversa_id }}
            className="inline-flex min-h-8 items-center gap-1 font-medium text-primary hover:underline"
          >
            <MessageCircle className="size-3.5" aria-hidden /> Abrir conversa
          </Link>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Motivo">
        {ordenados.map((m) => (
          <Button
            key={m.id}
            type="button"
            size="sm"
            variant={m.id === sugerido?.id ? "default" : "outline"}
            disabled={salvando}
            aria-pressed={escolhido?.id === m.id}
            className={cn(
              "h-auto min-h-9 whitespace-normal text-left",
              m.nao_conta && "opacity-80",
            )}
            onClick={() => clicar(m)}
          >
            {m.nome}
          </Button>
        ))}
      </div>

      {escolhido ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-muted p-3">
          <div className="grid gap-1">
            <Label htmlFor={`data-${lead.id}`}>
              {escolhido.pede_data === "retorno"
                ? "Voltar a falar em"
                : "Data que o cliente queria (opcional)"}
            </Label>
            <Input
              id={`data-${lead.id}`}
              type="date"
              min={escolhido.pede_data === "retorno" ? todayISO() : undefined}
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            type="button"
            disabled={salvando}
            onClick={() => void registrar(escolhido, data || undefined)}
          >
            Confirmar “{escolhido.nome}”
          </Button>
        </div>
      ) : null}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Observação (opcional)
        </summary>
        <Textarea
          className="mt-1"
          rows={2}
          maxLength={500}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="O que o cliente disse (vale para o motivo que você marcar)."
        />
      </details>
    </li>
  );
}

function RelatorioPerdas() {
  const [de, setDe] = useState(monthStart(currentMonth()));
  const [ate, setAte] = useState(monthEnd(currentMonth()));
  const [origem, setOrigem] = useState("");
  const [servico, setServico] = useState("");
  const { data: origens } = useCrmCatalog("sales_origin");

  const q = useQuery({
    queryKey: ["perdas-por-motivo", de, ate, origem, servico],
    enabled: Boolean(de && ate),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("perdas_por_motivo", {
        _de: de,
        _ate: ate,
        ...(origem ? { _origem: origem } : {}),
        ...(servico ? { _servico: servico } : {}),
      });
      if (error) throw error;
      return data as unknown as Perdas;
    },
  });
  const p = q.data;
  const maior = useMemo(
    () => Math.max(1, ...(p?.motivos ?? []).filter((m) => !m.nao_conta).map((m) => m.valor)),
    [p],
  );

  return (
    <SectionCard
      className="mt-6"
      title="Perdas por motivo"
      description="Quantos orçamentos e quanto em R$ deixaram de fechar, por motivo (data em que o motivo foi marcado)."
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="grid gap-1">
          <Label htmlFor="perdas-de">De</Label>
          <Input id="perdas-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="perdas-ate">Até</Label>
          <Input id="perdas-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="perdas-origem">Origem</Label>
          <NativeSelect
            id="perdas-origem"
            value={origem}
            onChange={setOrigem}
            placeholder="Todas"
            options={[
              { value: "", label: "Todas" },
              ...(origens ?? []).map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="perdas-servico">Serviço</Label>
          <NativeSelect
            id="perdas-servico"
            value={servico}
            onChange={setServico}
            placeholder="Todos"
            options={[
              { value: "", label: "Todos" },
              { value: "higienizacao", label: "Higienização" },
              { value: "impermeabilizacao", label: "Impermeabilização" },
            ]}
          />
        </div>
      </div>

      {q.error ? (
        <p className="text-sm text-problema-foreground">
          Não deu para carregar: {(q.error as Error).message}
        </p>
      ) : !p ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !p.motivos.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma perda marcada no período.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {p.motivos.map((m) => (
              <li key={m.motivo} className={cn(m.nao_conta && "text-muted-foreground")}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {m.motivo}
                    {m.nao_conta ? " (fora do total)" : ""}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">
                    {m.quantidade} · {brl(m.valor)}
                  </span>
                </div>
                {!m.nao_conta ? (
                  <div className="mt-1 h-2 rounded-full bg-muted" aria-hidden>
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${Math.max(2, (100 * m.valor) / maior)}%` }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t pt-3 text-sm font-bold">
            Total: {p.total.quantidade} orçamentos · {brl(p.total.valor)}
          </p>
          {p.agenda_cheia.length ? (
            <div className="mt-4">
              <h3 className="text-sm font-bold">Agenda cheia por serviço</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {p.agenda_cheia.map((a) => (
                  <li key={a.servico} className="flex justify-between gap-2">
                    <span>{rotuloServico(a.servico)}</span>
                    <span className="tabular-nums">
                      {a.quantidade} · {brl(a.valor)}
                      {a.dias_frente_media != null
                        ? ` · queriam em ${a.dias_frente_media} dia(s)`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
