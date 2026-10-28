import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { AgendarManual } from "@/components/crm/agendar-retorno";
import { Destino } from "@/components/crm/destino-lead";
import { LeadsDoSite } from "@/components/crm/leads-do-site";
import { SemDesfechoLista } from "@/components/crm/sem-desfecho";
import { LeadLink, TemperatureBadge } from "@/components/crm-ui";
import { Botao, CabecalhoDeTela, Card, Chip, Recolhido } from "@/components/nexa";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneBR, scheduleFollowup, suggestFollowupAt } from "@/lib/crm";
import { mensagemDeErro } from "@/lib/erros";
import { dateBR, dateTimeBR } from "@/lib/format";
import {
  ABAS_FOLLOWUPS,
  FILTROS_PADRAO,
  abaDoItem,
  diasDeAtraso,
  ehAbaFollowups,
  filtrarFollowups,
  ordenarFollowups,
  textoAtraso,
  type AbaFollowups,
  type FiltrosFollowups,
  type ItemFollowup,
} from "@/lib/follow-ups";
import { concluirFollowupEquipeFn, precisaDeVoceFn } from "@/lib/precisa-de-voce.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/crm/follow-ups")({
  validateSearch: (s: Record<string, unknown>): { aba?: AbaFollowups } =>
    ehAbaFollowups(s["aba"]) && s["aba"] !== "hoje" ? { aba: s["aba"] } : {},
  head: () => ({
    meta: [
      { title: "Follow-ups — Nexa OS" },
      {
        name: "description",
        content:
          "Retornos e follow-ups de hoje e vencidos, próximos, sem desfecho, sem resposta e leads do site, com o destino em um toque.",
      },
    ],
  }),
  component: FollowUps,
});

type LeadDaFila = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  temperature: string;
  temperature_confirmed: boolean;
  temperatura_motivo: string | null;
  retorno_combinado_em: string | null;
  orcamento_enviado_em: string | null;
  is_open: boolean | null;
  linked_work_order_id: string | null;
  perdido_em: string | null;
  loss_reason_id: string | null;
  summary: string | null;
};

type LinhaFila = ItemFollowup & {
  conversaId: string | null;
  notas: string | null;
  etapa: string | null;
  lead: LeadDaFila | null;
};

const CHAVE = ["follow-ups"] as const;
const SELECT_LEAD =
  "id, lead_name, phone, temperature, temperature_confirmed, temperatura_motivo, retorno_combinado_em, orcamento_enviado_em, is_open, linked_work_order_id, perdido_em, loss_reason_id, summary";

const aberto = (l: LeadDaFila | null) =>
  Boolean(
    l && l.is_open !== false && !l.linked_work_order_id && !l.perdido_em && !l.loss_reason_id,
  );

/** Conversa mais recente de cada lead (para "Abrir conversa" no app). */
async function conversasDosLeads(ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase
      .from("conversas")
      .select("id, crm_lead_id, ultima_atividade_em")
      .in("crm_lead_id", ids.slice(i, i + 150))
      .order("ultima_atividade_em", { ascending: false, nullsFirst: false });
    for (const c of data ?? [])
      if (c.crm_lead_id && !mapa.has(c.crm_lead_id)) mapa.set(c.crm_lead_id, c.id);
  }
  return mapa;
}

function FollowUps() {
  const { aba: abaUrl } = Route.useSearch();
  const navigate = Route.useNavigate();
  const aba: AbaFollowups = abaUrl ?? "hoje";
  const [filtros, setFiltros] = useState<FiltrosFollowups>(FILTROS_PADRAO);
  const agora = useMemo(() => new Date(), []);

  // Pendentes e vencidos (o banco marca "Vencida" depois de 3 dias; aqui eles continuam).
  const fila = useQuery({
    queryKey: [...CHAVE, "fila"],
    queryFn: async () => {
      const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("crm_followups")
        .select(
          `id, crm_lead_id, conversa_id, scheduled_at, status, notes, responsavel, assigned_to, etapa,
           lead:crm_lead_id ( ${SELECT_LEAD} )`,
        )
        .in("status", ["Pendente", "Vencida"])
        .gte("scheduled_at", desde)
        .order("scheduled_at")
        .limit(1000);
      if (error) throw error;
      type Bruto = {
        id: string;
        crm_lead_id: string | null;
        conversa_id: string | null;
        scheduled_at: string;
        status: string;
        notes: string | null;
        responsavel: string;
        assigned_to: string | null;
        etapa: string | null;
        lead: LeadDaFila | null;
      };
      const linhas = ((data ?? []) as unknown as Bruto[]).filter(
        // Vencido de lead que já fechou (OS, perda) não é mais pendência.
        (f) => f.status === "Pendente" || aberto(f.lead),
      );
      const semConversa = linhas.filter((f) => !f.conversa_id && f.crm_lead_id);
      const conversas = await conversasDosLeads([
        ...new Set(semConversa.map((f) => f.crm_lead_id!)),
      ]);
      return linhas.map((f): LinhaFila => ({
        id: f.id,
        leadId: f.crm_lead_id,
        scheduledAt: f.scheduled_at,
        status: f.status,
        responsavel: f.responsavel === "alice" ? "alice" : "equipe",
        pessoaId: f.assigned_to,
        comOrcamento: Boolean(f.lead?.orcamento_enviado_em),
        conversaId:
          f.conversa_id ?? (f.crm_lead_id ? (conversas.get(f.crm_lead_id) ?? null) : null),
        notas: f.notes,
        etapa: f.etapa,
        lead: f.lead,
      }));
    },
    refetchInterval: 60_000,
  });

  // Leads abertos parados há 3+ dias sem retorno marcado (sugestão; nada vira perdido sozinho).
  const semResposta = useQuery({
    queryKey: [...CHAVE, "sem-resposta"],
    queryFn: async () => {
      const limite = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("crm_leads")
        .select(`${SELECT_LEAD}, last_interaction_at, salesperson_id`)
        .eq("is_open", true)
        .is("next_follow_up_at", null)
        .is("linked_work_order_id", null)
        .is("loss_reason_id", null)
        .lt("last_interaction_at", limite)
        .order("last_interaction_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      const leads = (data ?? []) as unknown as Array<LeadDaFila & { last_interaction_at: string }>;
      const conversas = await conversasDosLeads(leads.map((l) => l.id));
      return leads.map((l) => ({ ...l, conversaId: conversas.get(l.id) ?? null }));
    },
    enabled: aba === "sem-resposta",
  });

  // Pessoas da equipe (o mesmo do "Precisa de você": admin filtra por pessoa).
  const buscarPrecisa = useServerFn(precisaDeVoceFn);
  const precisa = useQuery({ queryKey: ["precisa-de-voce"], queryFn: () => buscarPrecisa() });
  const pessoas = precisa.data?.pessoas ?? [];

  const linhas = fila.data ?? [];
  const filtradas = filtrarFollowups(linhas, filtros);
  const daAba = (a: "hoje" | "proximos") =>
    ordenarFollowups(
      filtradas.filter((i) => abaDoItem(i, agora) === a),
      agora,
    );
  const hoje = daAba("hoje");
  const proximos = daAba("proximos");
  const vencidos = hoje.filter((i) => diasDeAtraso(i.scheduledAt, agora) > 0).length;
  const semRespostaFiltrada = (semResposta.data ?? []).filter(
    (l) =>
      filtros.orcamento === "todos" ||
      (filtros.orcamento === "com") === Boolean(l.orcamento_enviado_em),
  );

  const contagem: Partial<Record<AbaFollowups, number>> = {
    hoje: hoje.length,
    proximos: proximos.length,
    ...(semResposta.data ? { "sem-resposta": semRespostaFiltrada.length } : {}),
  };
  const usaFiltros = aba === "hoje" || aba === "proximos" || aba === "sem-resposta";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Follow-ups"
        sobretitulo="Vendas"
        descricao="Quem precisa de um retorno: da equipe e da Alice, com o destino em um toque."
      />

      <div
        role="tablist"
        aria-label="Follow-ups"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {ABAS_FOLLOWUPS.map((a) => {
          const ativo = a.id === aba;
          const n = contagem[a.id];
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() =>
                void navigate({ search: a.id === "hoje" ? {} : { aba: a.id }, replace: true })
              }
              className={cn(
                "min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold whitespace-nowrap",
                ativo ? "bg-marca text-marca-foreground" : "bg-muted text-foreground",
                a.id === "hoje" && vencidos > 0 && !ativo && "text-problema-foreground",
              )}
            >
              {a.rotulo}
              {n !== undefined ? ` · ${n}` : ""}
            </button>
          );
        })}
      </div>

      {usaFiltros ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtros">
          <Seletor
            rotulo="Orçamento"
            valor={filtros.orcamento}
            opcoes={[
              ["todos", "Com e sem orçamento"],
              ["com", "Com orçamento"],
              ["sem", "Sem orçamento"],
            ]}
            mudar={(v) => setFiltros({ ...filtros, orcamento: v as FiltrosFollowups["orcamento"] })}
          />
          {aba !== "sem-resposta" ? (
            <Seletor
              rotulo="Quem"
              valor={filtros.quem}
              opcoes={[
                ["todos", "Alice e equipe"],
                ["alice", "Alice"],
                ["equipe", "Equipe"],
              ]}
              mudar={(v) => setFiltros({ ...filtros, quem: v as FiltrosFollowups["quem"] })}
            />
          ) : null}
          {aba !== "sem-resposta" && pessoas.length ? (
            <Seletor
              rotulo="Pessoa"
              valor={filtros.pessoa}
              opcoes={[
                ["todas", "Todas as pessoas"],
                ...pessoas.map((p) => [p.id, p.nome] as const),
              ]}
              mudar={(v) => setFiltros({ ...filtros, pessoa: v })}
            />
          ) : null}
        </div>
      ) : null}

      {aba === "hoje" || aba === "proximos" ? (
        fila.error ? (
          <Card className="text-sm text-problema-foreground">
            {mensagemDeErro(fila.error, "Não deu para carregar os follow-ups.", "followups")}
          </Card>
        ) : fila.isLoading ? (
          <Card className="min-h-24 animate-pulse" aria-busy />
        ) : (aba === "hoje" ? hoje : proximos).length === 0 ? (
          <p className="flex items-center justify-center gap-2 rounded-card bg-marca-claro p-5 font-bold text-marca">
            <CheckCircle2 className="size-5" aria-hidden />
            {aba === "hoje" ? "Nada para hoje nem vencido ✔" : "Nenhum follow-up marcado"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(aba === "hoje" ? hoje : proximos).map((i) => (
              <LinhaFollowup key={i.id} item={i} agora={agora} />
            ))}
          </ul>
        )
      ) : null}

      {aba === "sem-desfecho" ? <SemDesfechoLista /> : null}
      {aba === "site" ? <LeadsDoSite /> : null}

      {aba === "sem-resposta" ? (
        semResposta.isLoading ? (
          <Card className="min-h-24 animate-pulse" aria-busy />
        ) : !semRespostaFiltrada.length ? (
          <p className="rounded-card bg-marca-claro p-5 text-center font-bold text-marca">
            Nenhum lead parado há mais de 3 dias ✔
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Leads em aberto sem conversa há mais de 3 dias e sem retorno marcado. É sugestão: nada
              vira perdido sozinho.
            </p>
            <ul className="flex flex-col gap-2">
              {semRespostaFiltrada.map((l) => (
                <LinhaSemResposta key={l.id} lead={l} />
              ))}
            </ul>
          </>
        )
      ) : null}

      {aba === "hoje" || aba === "proximos" ? (
        <Recolhido titulo="Agendar retorno para um lead">
          <div className="p-4">
            <AgendarManual onDone={() => void fila.refetch()} />
          </div>
        </Recolhido>
      ) : null}
    </div>
  );
}

function Seletor({
  rotulo,
  valor,
  opcoes,
  mudar,
}: {
  rotulo: string;
  valor: string;
  opcoes: ReadonlyArray<readonly [string, string]>;
  mudar: (v: string) => void;
}) {
  return (
    <select
      aria-label={rotulo}
      className="min-h-11 rounded-botao border border-border bg-card px-3 text-sm"
      value={valor}
      onChange={(e) => mudar(e.target.value)}
    >
      {opcoes.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );
}

function horaSP(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LinhaFollowup({ item, agora }: { item: LinhaFila; agora: Date }) {
  const qc = useQueryClient();
  const concluir = useServerFn(concluirFollowupEquipeFn);
  const [ocupado, setOcupado] = useState(false);
  const atraso = diasDeAtraso(item.scheduledAt, agora);
  const vencido = textoAtraso(atraso);
  const l = item.lead;

  async function feito() {
    setOcupado(true);
    try {
      await concluir({ data: { id: item.id } });
      toast.success("Follow-up feito.");
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não deu certo.", "followups"));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-card border p-3",
        vencido ? "border-problema-foreground/40 bg-problema" : "border-border bg-card",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          <p className="flex flex-wrap items-center gap-2 font-bold">
            {vencido ? (
              <Chip tom="problema">{vencido}</Chip>
            ) : (
              <Chip tom="atencao">
                {abaDoItem(item, agora) === "hoje"
                  ? `Hoje ${horaSP(item.scheduledAt)}`
                  : `${dateBR(item.scheduledAt)} ${horaSP(item.scheduledAt)}`}
              </Chip>
            )}
            <Chip tom={item.responsavel === "alice" ? "neutro" : "atencao"}>
              {item.responsavel === "alice" ? "Alice" : "Equipe"}
              {item.etapa ? ` · ${item.etapa === "R" ? "retomada" : item.etapa}` : ""}
            </Chip>
            {l ? (
              <LeadLink id={l.id}>{l.lead_name || "Sem nome"}</LeadLink>
            ) : (
              <span>Sem lead ligado</span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatPhoneBR(l?.phone)} · {item.comOrcamento ? "com orçamento" : "sem orçamento"}
            {vencido ? ` · era para ${dateTimeBR(item.scheduledAt)}` : ""}
          </p>
          {item.notas ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {item.notas}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {l ? (
            <TemperatureBadge
              temperature={l.temperature}
              suggested={!l.temperature_confirmed}
              motivo={l.temperatura_motivo}
              retornoEm={l.retorno_combinado_em}
            />
          ) : null}
          {item.conversaId ? (
            <Botao asChild>
              <Link to="/conversas/$conversaId" params={{ conversaId: item.conversaId }}>
                Abrir conversa
              </Link>
            </Botao>
          ) : null}
          {item.responsavel === "equipe" ? (
            <Botao variante="contorno" disabled={ocupado} onClick={() => void feito()}>
              Feito
            </Botao>
          ) : null}
        </div>
      </div>
      {item.responsavel === "alice" && !vencido ? (
        <p className="text-xs text-muted-foreground">
          A Alice manda sozinha no horário (com a leitura de contexto antes). Se o cliente responder
          antes, o toque é cancelado.
        </p>
      ) : null}
      {item.leadId && aberto(l) ? (
        <Destino
          leadId={item.leadId}
          aoConcluir={async () => {
            if (item.responsavel === "equipe") await concluir({ data: { id: item.id } });
            await qc.invalidateQueries({ queryKey: CHAVE });
          }}
        />
      ) : null}
    </li>
  );
}

function LinhaSemResposta({
  lead: l,
}: {
  lead: LeadDaFila & { last_interaction_at: string; conversaId: string | null };
}) {
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          <p className="flex flex-wrap items-center gap-2 font-bold">
            <LeadLink id={l.id}>{l.lead_name || "Sem nome"}</LeadLink>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatPhoneBR(l.phone)} · {l.orcamento_enviado_em ? "com orçamento" : "sem orçamento"}{" "}
            · última conversa {dateTimeBR(l.last_interaction_at)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TemperatureBadge
            temperature={l.temperature}
            suggested={!l.temperature_confirmed}
            motivo={l.temperatura_motivo}
            retornoEm={l.retorno_combinado_em}
          />
          {l.conversaId ? (
            <Botao asChild>
              <Link to="/conversas/$conversaId" params={{ conversaId: l.conversaId }}>
                Abrir conversa
              </Link>
            </Botao>
          ) : null}
          <Botao
            variante="contorno"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              try {
                await scheduleFollowup(l.id, suggestFollowupAt(24));
                toast.success("Retorno marcado para daqui a 24 h.");
                await qc.invalidateQueries({ queryKey: CHAVE });
              } catch {
                toast.error("Não foi possível marcar o retorno.");
              } finally {
                setOcupado(false);
              }
            }}
          >
            Retorno em 24 h
          </Botao>
        </div>
      </div>
      <Destino
        leadId={l.id}
        aoConcluir={async () => {
          await qc.invalidateQueries({ queryKey: CHAVE });
        }}
      />
    </li>
  );
}
