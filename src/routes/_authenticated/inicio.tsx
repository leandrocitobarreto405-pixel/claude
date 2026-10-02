import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, MessageCircle, Plus } from "lucide-react";
import {
  BadgeAlerta,
  BlocoEscuro,
  Botao,
  CabecalhoDeTela,
  Card,
  CardEscuro,
  Chip,
  NumeroGrande,
  Recolhido,
} from "@/components/nexa";
import { CartaoAtendimento } from "@/components/agenda/cartao-atendimento";
import { FaixaHorariosLivres } from "@/components/agenda/faixa-horarios-livres";
import { VisitDialog } from "@/components/visit-dialog";
import { BudgetVisitDialog } from "@/components/budget-visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { resumoAliceHoje } from "@/lib/alice.functions";
import { deOrcamento, deVisita, idAtual } from "@/lib/agenda";
import { BUDGET_VISIT_SELECT, type BudgetVisitRow } from "@/lib/budget-visits";
import {
  brl,
  currentMonth,
  monthLabelPT,
  remainingDaysInMonth,
  todayISO,
  tomorrowISO,
  weekdayPT,
} from "@/lib/format";
import {
  dataPorExtenso,
  horaEmSaoPaulo,
  percentualDaMeta,
  primeiroNome,
  saudacao,
} from "@/lib/inicio";
import { VISIT_SELECT, type VisitRow } from "@/lib/os";
import { useMonthSummary } from "@/lib/reports";
import { displayName, useProfile, useSession } from "@/lib/session";
import { podeAcessar, usePapel } from "@/lib/tenant";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/inicio")({
  head: () => ({
    meta: [
      { title: "Início — Nexa OS" },
      { name: "description", content: "O dia de hoje: Alice, serviços, meta do mês e pendências." },
      { property: "og:title", content: "Início — Nexa OS" },
      {
        property: "og:description",
        content: "O dia de hoje: Alice, serviços, meta do mês e pendências.",
      },
    ],
  }),
  component: Inicio,
});

function useVisitsBetween(from: string, to: string) {
  return useQuery({
    queryKey: ["visits_range", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .gte("scheduled_date", from)
        .lte("scheduled_date", to)
        .order("scheduled_date")
        .order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });
}

function useOrcamentosDoDia(dia: string) {
  return useQuery({
    queryKey: ["orcamentos", "inicio", dia],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budget_visits")
        .select(BUDGET_VISIT_SELECT)
        .eq("scheduled_date", dia)
        .order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as BudgetVisitRow[];
    },
  });
}

function useGoal(month: string) {
  return useQuery({
    queryKey: ["monthly_goal", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monthly_goals")
        .select("*")
        .eq("month", `${month}-01`)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function usePendencias() {
  return useQuery({
    queryKey: ["pendencias"],
    queryFn: async () => {
      const hoje = todayISO();
      const mesAtual = currentMonth();
      const [semTecnico, atrasadas, notas, naoPagos, despesas, despesasMes, rotasPend, rotasDif] =
        await Promise.all([
          supabase
            .from("visits")
            .select("id", { count: "exact", head: true })
            .is("technician_id", null)
            .neq("status", "Cancelado"),
          supabase
            .from("visits")
            .select("id", { count: "exact", head: true })
            .lt("scheduled_date", hoje)
            .in("status", ["Agendado", "Em execução", "Reagendado"]),
          supabase
            .from("invoice_tasks")
            .select("id", { count: "exact", head: true })
            .in("status", ["Pendente", "Solicitada"]),
          supabase
            .from("payments")
            .select("id", { count: "exact", head: true })
            .in("payment_status", ["Não pago", "Parcialmente pago"]),
          supabase
            .from("expenses")
            .select("id", { count: "exact", head: true })
            .lt("due_date", hoje)
            .in("status", ["Pendente", "Parcialmente pago", "Vencido"])
            .is("deleted_at", null),
          supabase
            .from("expenses")
            .select("id", { count: "exact", head: true })
            .gte("competence_date", `${mesAtual}-01`)
            .in("status", ["Pendente", "Parcialmente pago", "Vencido"])
            .is("deleted_at", null),
          supabase
            .from("daily_routes")
            .select("id", { count: "exact", head: true })
            .in("route_status", [
              "Aguardando conclusão dos serviços",
              "Aguardando custo por km",
              "Erro no cálculo",
            ]),
          supabase
            .from("daily_routes")
            .select("id", { count: "exact", head: true })
            .eq("financial_difference", true),
        ]);
      return {
        semTecnico: semTecnico.count ?? 0,
        atrasadas: atrasadas.count ?? 0,
        notas: notas.count ?? 0,
        naoPagos: naoPagos.count ?? 0,
        despesas: despesas.count ?? 0,
        despesasMes: despesasMes.count ?? 0,
        rotasPend: rotasPend.count ?? 0,
        rotasDif: rotasDif.count ?? 0,
      };
    },
  });
}

type ItemLink = {
  label: string;
  valor: string | number;
  to: string;
  search?: Record<string, string>;
  /** Detalhe em letra menor embaixo do nome. */
  detalhe?: string;
};

function Inicio() {
  const navigate = useNavigate();
  const month = currentMonth();
  const hoje = todayISO();
  const amanha = tomorrowISO();
  const profile = useProfile();
  const { user } = useSession();
  const { papel } = usePapel();
  const { data: resumo } = useMonthSummary(month);
  const { data: meta } = useGoal(month);
  const { data: pend } = usePendencias();
  const visitasHoje = useVisitsBetween(hoje, hoje);
  const visitasAmanha = useVisitsBetween(amanha, amanha);
  const orcamentosHoje = useOrcamentosDoDia(hoje);
  const resumoFn = useServerFn(resumoAliceHoje);
  const alice = useQuery({
    queryKey: ["alice_resumo_hoje"],
    queryFn: () => resumoFn(),
    refetchInterval: 60_000,
  });
  const [aberto, setAberto] = useState<string | null | undefined>(undefined);
  const [selecionada, setSelecionada] = useState<VisitRow | null>(null);
  const [orcamento, setOrcamento] = useState<BudgetVisitRow | null>(null);

  const pode = (to: string) => (papel ? podeAcessar(papel, to) : false);
  const nome = primeiroNome(displayName(profile, user?.email));

  const doDia = useMemo(
    () =>
      [
        ...(visitasHoje.data ?? []).map(deVisita),
        ...(orcamentosHoje.data ?? []).map(deOrcamento),
      ].sort((a, b) => a.hora.localeCompare(b.hora)),
    [visitasHoje.data, orcamentosHoje.data],
  );
  const atualId = idAtual(
    doDia.map((i) => ({ id: i.id, status: i.status, time: i.hora })),
    hoje,
    hoje,
  );
  const abertoId = aberto === undefined ? atualId : aberto;
  const qtdAmanha = (visitasAmanha.data ?? []).filter((v) => v.status !== "Cancelado").length;

  const metaValor = Number(meta?.goal_amount ?? 0);
  // Faturamento = valor efetivamente recebido no mês (pagamentos ativos).
  const realizado = resumo?.received ?? 0;
  const percentual = percentualDaMeta(realizado, metaValor);
  const faltam = Math.max(0, metaValor - realizado);
  const nomeDoMes = monthLabelPT(month).split(" de ")[0] ?? "";

  const pendencias: ItemLink[] = [
    {
      label: "Serviços sem técnico",
      valor: pend?.semTecnico ?? 0,
      to: "/agenda",
      search: { modo: "sem-tecnico" },
    },
    {
      label: "Serviços atrasados sem conclusão",
      valor: pend?.atrasadas ?? 0,
      to: "/agenda",
      search: { modo: "atrasados" },
    },
    { label: "Notas fiscais a emitir", valor: pend?.notas ?? 0, to: "/notas" },
    {
      label: "OS com pagamento pendente",
      valor: pend?.naoPagos ?? 0,
      to: "/pagamentos",
      search: { status: "Não pago" },
    },
    {
      label: "Despesas vencidas",
      valor: pend?.despesas ?? 0,
      to: "/despesas",
      search: { aba: "Vencidas" },
    },
    {
      label: "Despesas pendentes do mês",
      valor: pend?.despesasMes ?? 0,
      to: "/despesas",
      search: { aba: "Pendentes" },
    },
    { label: "Rotas pendentes de cálculo", valor: pend?.rotasPend ?? 0, to: "/rotas" },
    { label: "Rotas alteradas após o pagamento", valor: pend?.rotasDif ?? 0, to: "/rotas" },
  ];
  const totalPendencias = pendencias.reduce((s, p) => s + Number(p.valor), 0);

  const numeros: ItemLink[] = [
    { label: "Serviços concluídos no mês", valor: resumo?.completedCount ?? 0, to: "/servicos" },
    {
      label: "Recebido líquido no mês",
      valor: brl(resumo?.receivedNet),
      to: "/pagamentos",
      detalhe: `Bruto ${brl(resumo?.received)} · Taxas ${brl(resumo?.fees)}`,
    },
    {
      label: "A receber",
      valor: brl(resumo?.receivable),
      to: "/a-receber",
      search: { aba: "concluido" },
      detalhe: `Concluídos ${brl(resumo?.receivableCompleted)} · Agendados ${brl(resumo?.receivableScheduled)}`,
    },
    { label: "Lucro líquido estimado", valor: brl(resumo?.netProfit), to: "/dre" },
  ];

  function detalhes(id: string) {
    const v = (visitasHoje.data ?? []).find((x) => `os-${x.id}` === id);
    // Serviço: tela cheia (celular do técnico). Orçamento continua na janela.
    if (v) return void navigate({ to: "/servico/$visitId", params: { visitId: v.id } });
    const b = (orcamentosHoje.data ?? []).find((x) => `orc-${x.id}` === id);
    if (b) setOrcamento(b);
  }

  function recarregar() {
    void visitasHoje.refetch();
    void visitasAmanha.refetch();
    void orcamentosHoje.refetch();
  }

  const a = alice.data;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <CabecalhoDeTela
        sobretitulo={`${weekdayPT(hoje)}, ${dataPorExtenso(hoje)}`}
        titulo={`${saudacao(horaEmSaoPaulo())}${nome ? `, ${nome}` : ""}`}
        acao={
          pode("/nova-os") ? (
            <Botao asChild>
              <Link to="/nova-os">
                <Plus /> Nova OS
              </Link>
            </Botao>
          ) : null
        }
      />

      {pode("/promocao") ? <FaixaHorariosLivres /> : null}

      {/* Alice: o que ela está fazendo agora e o que precisa da equipe. */}
      <CardEscuro aria-label="Alice">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span
              aria-hidden
              className={cn("size-2 rounded-full", a?.ligada ? "bg-destaque" : "bg-desligado")}
            />
            {a ? (a.ligada ? "Alice online" : "Alice desligada") : "Alice"}
          </span>
        </div>
        <NumeroGrande
          tamanho="grande"
          disposicao="ao-lado"
          valor={a?.comAlice ?? "–"}
          legenda={a?.comAlice === 1 ? "conversa com a Alice agora" : "conversas com a Alice agora"}
          sobreEscuro
        />
        <div className="grid grid-cols-3 gap-2">
          <BlocoEscuro>
            <NumeroGrande
              tamanho="pequeno"
              valor={a?.respostasHoje ?? "–"}
              legenda="respostas hoje"
              sobreEscuro
            />
          </BlocoEscuro>
          <BlocoEscuro>
            <NumeroGrande
              tamanho="pequeno"
              valor={a?.passagensHoje ?? "–"}
              legenda="passou para a equipe"
              sobreEscuro
            />
          </BlocoEscuro>
          <BlocoEscuro>
            <NumeroGrande
              tamanho="pequeno"
              valor={doDia.filter((i) => i.status !== "Cancelado").length}
              legenda="serviços hoje"
              sobreEscuro
            />
          </BlocoEscuro>
        </div>
        <Botao asChild variante="claro" tamanho="grande" larguraTotal>
          <Link
            to="/conversas"
            search={{ aba: a && a.esperandoEquipe > 0 ? "precisam" : undefined }}
          >
            {a && a.esperandoEquipe > 0 ? (
              <>
                <BadgeAlerta numero={a.esperandoEquipe} />
                {a.esperandoEquipe === 1
                  ? "1 conversa precisa de você"
                  : `${a.esperandoEquipe} conversas precisam de você`}
              </>
            ) : (
              <>
                <MessageCircle /> Ver conversas
              </>
            )}
          </Link>
        </Botao>
      </CardEscuro>

      {/* Hoje: o próximo serviço já aberto, com rota e contato. */}
      <section className="flex flex-col gap-2.5" aria-labelledby="inicio-hoje">
        <div className="flex items-center justify-between gap-3">
          <h2 id="inicio-hoje" className="font-titulo text-xl">
            Hoje
          </h2>
          <Link
            to="/agenda"
            search={{ modo: "dia", tecnico: undefined, status: undefined, dia: undefined }}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-success hover:text-marca"
          >
            Ver agenda <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
        {visitasHoje.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : doDia.length === 0 ? (
          <Card className="py-6 text-center">
            <p className="text-[15px] font-bold">Nenhum serviço hoje</p>
            <p className="text-sm text-muted-foreground">
              Aproveite para organizar as próximas vendas.
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {doDia.map((item) => (
              <CartaoAtendimento
                key={item.id}
                item={item}
                aberto={abertoId === item.id}
                onAlternar={() => setAberto(abertoId === item.id ? null : item.id)}
                onDetalhes={() => detalhes(item.id)}
              />
            ))}
          </ul>
        )}
        <Link
          to="/agenda"
          search={{ modo: "dia", tecnico: undefined, status: undefined, dia: amanha }}
          className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-card px-4 py-3 hover:border-marca/40"
        >
          <span className="flex flex-col">
            <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Amanhã
            </span>
            <span className="text-[15px] font-bold">
              {qtdAmanha === 0
                ? "Nenhum serviço"
                : qtdAmanha === 1
                  ? "1 serviço"
                  : `${qtdAmanha} serviços`}
            </span>
          </span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </Link>
      </section>

      {/* Meta do mês. */}
      <Card aria-label="Meta do mês">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold">Meta de {nomeDoMes}</span>
          {metaValor > 0 ? (
            <Chip tom={percentual >= 100 ? "sucesso" : "neutro"}>{Math.floor(percentual)}%</Chip>
          ) : null}
        </div>
        <NumeroGrande
          valor={brl(realizado)}
          complemento={metaValor > 0 ? `de ${brl(metaValor)}` : undefined}
        />
        <div
          className="h-2.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percentual)}
          aria-label="Meta do mês"
        >
          <div className="h-full rounded-full bg-dado" style={{ width: `${percentual}%` }} />
        </div>
        {metaValor > 0 ? (
          <p className="text-sm text-muted-foreground">
            {faltam > 0
              ? `Faltam ${brl(faltam)} em ${remainingDaysInMonth(month)} dia(s)`
              : "Meta batida!"}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Nenhuma meta definida para este mês.</p>
            {pode("/configuracoes") ? (
              <Botao asChild variante="contorno" className="self-start">
                <Link to="/configuracoes">Definir meta</Link>
              </Botao>
            ) : null}
          </>
        )}
      </Card>

      {/* Pendências e números do mês: recolhidos, para não tomar a tela. */}
      <Recolhido titulo="Pendências" contagem={totalPendencias}>
        <ul className="flex flex-col divide-y divide-border px-4">
          {pendencias.map((p) => (
            <LinhaLink
              key={p.label}
              item={p}
              liberado={pode(p.to)}
              destaque={Number(p.valor) > 0}
            />
          ))}
        </ul>
      </Recolhido>

      <Recolhido titulo="Números do mês">
        <ul className="flex flex-col divide-y divide-border px-4">
          {numeros.map((n) => (
            <LinhaLink key={n.label} item={n} liberado={pode(n.to)} />
          ))}
        </ul>
      </Recolhido>

      <VisitDialog
        visit={selecionada}
        open={!!selecionada}
        onOpenChange={(v) => !v && setSelecionada(null)}
        onChanged={recarregar}
      />
      <BudgetVisitDialog
        visit={orcamento}
        open={!!orcamento}
        onOpenChange={(v) => !v && setOrcamento(null)}
        onChanged={recarregar}
      />
    </div>
  );
}

/** Linha com nome e valor. Abre a tela do item quando a pessoa tem acesso a ela. */
function LinhaLink({
  item,
  liberado,
  destaque = false,
}: {
  item: ItemLink;
  liberado: boolean;
  destaque?: boolean;
}) {
  const conteudo = (
    <>
      <span className="flex min-w-0 flex-col">
        <span>{item.label}</span>
        {item.detalhe ? (
          <span className="text-xs text-muted-foreground">{item.detalhe}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {typeof item.valor === "number" ? (
          <Chip tom={destaque ? "atencao" : "neutro"}>{item.valor}</Chip>
        ) : (
          <span className="font-bold">{item.valor}</span>
        )}
        {liberado ? <ChevronRight className="size-4 text-muted-foreground" aria-hidden /> : null}
      </span>
    </>
  );
  const classe = "flex min-h-12 items-center justify-between gap-3 py-2 text-sm";
  return (
    <li>
      {liberado ? (
        <Link to={item.to} search={item.search ?? {}} className={cn(classe, "hover:text-marca")}>
          {conteudo}
        </Link>
      ) : (
        <div className={classe}>{conteudo}</div>
      )}
    </li>
  );
}
