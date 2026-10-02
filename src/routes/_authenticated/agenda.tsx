import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ClipboardPlus,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { SugestaoDiasCep } from "@/components/sugestao-dias-cep";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BadgeAlerta, Botao, CabecalhoDeTela, Card, NumeroGrande } from "@/components/nexa";
import { CartaoAtendimento } from "@/components/agenda/cartao-atendimento";
import { FaixaHorariosLivres } from "@/components/agenda/faixa-horarios-livres";
import { VisitDialog } from "@/components/visit-dialog";
import { BudgetVisitDialog } from "@/components/budget-visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { VISIT_SELECT, type VisitRow } from "@/lib/os";
import { BUDGET_VISIT_SELECT, type BudgetVisitRow } from "@/lib/budget-visits";
import { VISIT_STATUSES, useTechnicians } from "@/lib/data";
import {
  contagemPorDia,
  deOrcamento,
  deVisita,
  idAtual,
  rotuloDoMes,
  semanaDe,
  type Atendimento,
} from "@/lib/agenda";
import {
  addDaysISO,
  brl,
  dateBR,
  monthEnd,
  monthLabelPT,
  monthStart,
  todayISO,
  weekdayPT,
} from "@/lib/format";
import { dataPorExtenso } from "@/lib/inicio";
import { podeAcessar, usePapel } from "@/lib/tenant";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/agenda")({
  validateSearch: (search: Record<string, unknown>) => {
    const modo = String(search["modo"] ?? "dia");
    return {
      modo: (["dia", "semana", "mes", "atrasados", "sem-tecnico"] as const).includes(modo as Modo)
        ? (modo as Modo)
        : ("dia" as const),
      tecnico: search["tecnico"] ? String(search["tecnico"]) : undefined,
      status: search["status"] ? String(search["status"]) : undefined,
      // Dia que a agenda abre (AAAA-MM-DD), ex.: o "Ver amanhã" do Início.
      dia: /^\d{4}-\d{2}-\d{2}$/.test(String(search["dia"] ?? ""))
        ? String(search["dia"])
        : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Agenda — Nexa OS" },
      {
        name: "description",
        content: "Agenda de serviços por dia, semana e mês, com atrasados e serviços sem técnico.",
      },
      { property: "og:title", content: "Agenda — Nexa OS" },
      {
        property: "og:description",
        content: "Agenda de serviços por dia, semana e mês, com atrasados e serviços sem técnico.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Agenda,
});

type Modo = "dia" | "semana" | "mes" | "atrasados" | "sem-tecnico";

const NOME_MODO: Record<Modo, string> = {
  dia: "Dia",
  semana: "Semana",
  mes: "Mês",
  atrasados: "Atrasados",
  "sem-tecnico": "Sem técnico",
};

/** Serviços considerados em aberto (mesmo critério das pendências do início). */
const ATRASADOS_STATUSES = ["Agendado", "Em execução", "Reagendado"];

/** Visitas de orçamento ainda em aberto. */
const ORCAMENTOS_ABERTOS = ["Agendado", "Confirmado", "Em deslocamento", "Reagendado"];

/** "R$ 2.400" (sem centavos, para caber no resumo do dia). */
function reaisSemCentavos(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function Agenda() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const hoje = todayISO();
  const [modo, setModo] = useState<Modo>(search.modo);
  const [ref, setRef] = useState(search.dia ?? hoje);
  const [tecnico, setTecnico] = useState(search.tecnico ?? "todos");
  const [status, setStatus] = useState(search.status ?? "todos");
  // undefined = automático (abre o próximo serviço de hoje); null = todos fechados.
  const [aberto, setAberto] = useState<string | null | undefined>(undefined);
  const [opcoes, setOpcoes] = useState(false);
  const [selecionada, setSelecionada] = useState<VisitRow | null>(null);
  const [orcamento, setOrcamento] = useState<BudgetVisitRow | null>(null);
  const [novoOrcamento, setNovoOrcamento] = useState(false);
  const { data: tecnicos } = useTechnicians(true);
  const { papel } = usePapel();

  const especial = modo === "atrasados" || modo === "sem-tecnico";
  const semana = useMemo(() => semanaDe(ref), [ref]);
  // No modo dia busca a semana inteira, para a faixa de dias mostrar onde há serviço.
  const from = modo === "mes" ? monthStart(ref.slice(0, 7)) : semana[0]!.iso;
  const to = modo === "mes" ? monthEnd(ref.slice(0, 7)) : semana[6]!.iso;
  const chave = especial ? modo : `${from}_${to}`;

  const query = useQuery({
    queryKey: ["agenda", chave],
    queryFn: async () => {
      let q = supabase.from("visits").select(VISIT_SELECT);
      if (modo === "atrasados") {
        q = q.lt("scheduled_date", todayISO()).in("status", ATRASADOS_STATUSES);
      } else if (modo === "sem-tecnico") {
        q = q.is("technician_id", null).neq("status", "Cancelado");
      } else {
        q = q.gte("scheduled_date", from).lte("scheduled_date", to);
      }
      const { data, error } = await q.order("scheduled_date").order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const orcamentosQuery = useQuery({
    queryKey: ["orcamentos", "agenda", chave],
    queryFn: async () => {
      let q = supabase.from("budget_visits").select(BUDGET_VISIT_SELECT);
      if (modo === "atrasados") {
        q = q.lt("scheduled_date", todayISO()).in("status", ORCAMENTOS_ABERTOS);
      } else if (modo === "sem-tecnico") {
        q = q.is("technician_id", null).neq("status", "Cancelado");
      } else {
        q = q.gte("scheduled_date", from).lte("scheduled_date", to);
      }
      const { data, error } = await q.order("scheduled_date").order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as BudgetVisitRow[];
    },
  });

  // Quilômetros da rota do dia (quando a rota já foi calculada).
  const rotaQuery = useQuery({
    queryKey: ["agenda", "rota", ref],
    enabled: modo === "dia",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_routes")
        .select("technician_id, calculated_km, real_km")
        .eq("route_date", ref);
      if (error) return [];
      return data ?? [];
    },
  });

  const visitaPorId = useMemo(
    () => new Map((query.data ?? []).map((v) => [`os-${v.id}`, v])),
    [query.data],
  );
  const orcamentoPorId = useMemo(
    () => new Map((orcamentosQuery.data ?? []).map((b) => [`orc-${b.id}`, b])),
    [orcamentosQuery.data],
  );

  const doTecnico = useMemo(() => {
    const todos = [
      ...(query.data ?? [])
        .filter((v) => tecnico === "todos" || v.technician?.id === tecnico)
        .map(deVisita),
      ...(orcamentosQuery.data ?? [])
        .filter((b) => tecnico === "todos" || b.technician?.id === tecnico)
        .map(deOrcamento),
    ];
    return todos.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  }, [query.data, orcamentosQuery.data, tecnico]);

  const filtrados = useMemo(
    () => doTecnico.filter((i) => status === "todos" || i.status === status),
    [doTecnico, status],
  );

  const porDia = useMemo(
    () => contagemPorDia(doTecnico.map((i) => ({ date: i.data, status: i.status }))),
    [doTecnico],
  );

  const doDia = useMemo(() => filtrados.filter((i) => i.data === ref), [filtrados, ref]);
  const atualId = idAtual(
    doDia.map((i) => ({ id: i.id, status: i.status, time: i.hora })),
    ref,
    hoje,
  );
  const abertoId = aberto === undefined ? atualId : aberto;

  const grupos = useMemo(() => {
    const mapa = new Map<string, Atendimento[]>();
    for (const i of filtrados) mapa.set(i.data, [...(mapa.get(i.data) ?? []), i]);
    return [...mapa.entries()];
  }, [filtrados]);

  const ativos = (lista: Atendimento[]) => lista.filter((i) => i.status !== "Cancelado");
  const previsto = (lista: Atendimento[]) =>
    ativos(lista)
      .filter((i) => i.tipo === "os")
      .reduce((s, i) => s + (i.valor ?? 0), 0);
  const km = (rotaQuery.data ?? [])
    .filter((r) => tecnico === "todos" || r.technician_id === tecnico)
    .reduce((s, r) => s + Number(r.real_km ?? r.calculated_km ?? 0), 0);

  const podeNovaOs = papel ? podeAcessar(papel, "/nova-os") : false;
  const filtrosAtivos = status !== "todos" ? 1 : 0;

  function irPara(dia: string) {
    setModo("dia");
    setRef(dia);
    setAberto(undefined);
  }

  function alternar(id: string) {
    setAberto(abertoId === id ? null : id);
  }

  function detalhes(id: string) {
    const v = visitaPorId.get(id);
    // Serviço: tela cheia (celular do técnico). Orçamento continua na janela.
    if (v) return void navigate({ to: "/servico/$visitId", params: { visitId: v.id } });
    const b = orcamentoPorId.get(id);
    if (b) setOrcamento(b);
  }

  function recarregar() {
    void query.refetch();
    void orcamentosQuery.refetch();
  }

  const carregando = query.isLoading || orcamentosQuery.isLoading;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        sobretitulo={
          modo === "dia"
            ? `${weekdayPT(ref)}, ${dataPorExtenso(ref)}`
            : modo === "mes"
              ? monthLabelPT(ref.slice(0, 7))
              : modo === "semana"
                ? rotuloDoMes(semana)
                : "Agenda"
        }
        titulo={modo === "dia" ? "Agenda" : NOME_MODO[modo]}
        acao={
          podeNovaOs ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Botao>
                  <Plus /> Novo
                </Botao>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem onSelect={() => setNovoOrcamento(true)}>
                  <CalendarPlus className="size-4" /> Visita de orçamento
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/nova-os">
                    <ClipboardPlus className="size-4" /> Nova OS
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Botao onClick={() => setNovoOrcamento(true)}>
              <Plus /> Orçamento
            </Botao>
          )
        }
      />

      {papel && podeAcessar(papel, "/promocao") ? <FaixaHorariosLivres /> : null}

      {/* Navegação: semana anterior/próxima, hoje e as outras opções. */}
      <div className="flex items-center gap-2">
        {modo === "dia" ? (
          <>
            <Botao
              variante="neutro"
              tamanho="icone"
              aria-label="Semana anterior"
              onClick={() => irPara(addDaysISO(ref, -7))}
            >
              <ChevronLeft />
            </Botao>
            <span className="min-w-0 truncate text-center text-sm font-bold">
              {rotuloDoMes(semana)}
            </span>
            <Botao
              variante="neutro"
              tamanho="icone"
              aria-label="Próxima semana"
              onClick={() => irPara(addDaysISO(ref, 7))}
            >
              <ChevronRight />
            </Botao>
            {ref !== hoje ? (
              <Botao variante="neutro" onClick={() => irPara(hoje)}>
                Hoje
              </Botao>
            ) : null}
          </>
        ) : (
          <Botao variante="neutro" onClick={() => irPara(ref)}>
            <ChevronLeft /> Voltar ao dia
          </Botao>
        )}
        <Botao variante="contorno" className="relative ml-auto" onClick={() => setOpcoes(true)}>
          <SlidersHorizontal /> Opções
          {filtrosAtivos ? (
            <BadgeAlerta numero={filtrosAtivos} className="absolute -right-1.5 -top-1.5" />
          ) : null}
        </Botao>
      </div>

      {modo === "dia" ? (
        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Dias da semana">
          {semana.map((d) => {
            const sel = d.iso === ref;
            const n = porDia.get(d.iso) ?? 0;
            return (
              <button
                key={d.iso}
                type="button"
                aria-pressed={sel}
                aria-label={`${weekdayPT(d.iso)}, ${d.dia}: ${n} atendimento(s)`}
                onClick={() => irPara(d.iso)}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border transition-colors",
                  sel
                    ? "border-marca bg-marca text-marca-foreground"
                    : "border-border bg-card text-foreground hover:border-marca/40",
                  !sel && d.iso === hoje && "border-marca/50",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-semibold",
                    sel ? "text-marca-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {d.curto}
                </span>
                <span className="font-titulo text-lg leading-none">{d.dia}</span>
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    n === 0 ? "bg-transparent" : sel ? "bg-destaque" : "bg-dado",
                  )}
                />
              </button>
            );
          })}
        </div>
      ) : null}

      {(tecnicos ?? []).length > 1 ? (
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
          role="group"
          aria-label="Técnico"
        >
          {[{ id: "todos", name: "Todos" }, ...(tecnicos ?? [])].map((t) => {
            const sel = tecnico === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={sel}
                onClick={() => setTecnico(t.id)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors",
                  sel
                    ? "border-marca bg-marca text-marca-foreground"
                    : "border-border bg-card text-foreground hover:border-marca/40",
                )}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {modo === "dia" ? (
        <>
          <Card className={cn("grid gap-3", km > 0 ? "grid-cols-3" : "grid-cols-2")}>
            <NumeroGrande
              tamanho="pequeno"
              valor={ativos(doDia).length}
              legenda={ativos(doDia).length === 1 ? "atendimento" : "atendimentos"}
            />
            <NumeroGrande
              tamanho="pequeno"
              valor={reaisSemCentavos(previsto(doDia))}
              legenda="previsto"
            />
            {km > 0 ? (
              <NumeroGrande tamanho="pequeno" valor={`${Math.round(km)} km`} legenda="de rota" />
            ) : null}
          </Card>

          {carregando ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : doDia.length === 0 ? (
            <Card className="items-center py-8 text-center">
              <p className="text-[15px] font-bold">
                Nenhum atendimento {ref === hoje ? "hoje" : "neste dia"}
              </p>
              <p className="text-sm text-muted-foreground">
                {weekdayPT(ref)}, {dateBR(ref)}
              </p>
              <Botao variante="contorno" onClick={() => setNovoOrcamento(true)}>
                <CalendarPlus /> Agendar visita de orçamento
              </Botao>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {doDia.map((item) => (
                <CartaoAtendimento
                  key={item.id}
                  item={item}
                  aberto={abertoId === item.id}
                  onAlternar={() => alternar(item.id)}
                  onDetalhes={() => detalhes(item.id)}
                />
              ))}
            </ul>
          )}
        </>
      ) : carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : grupos.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <p className="text-[15px] font-bold">Nenhum atendimento aqui</p>
          <p className="text-sm text-muted-foreground">Mude o período ou os filtros em Opções.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            {ativos(filtrados).length} atendimento(s) · {brl(previsto(filtrados))} em serviços
          </p>
          {grupos.map(([dia, lista]) => (
            <section key={dia} className="flex flex-col gap-2.5">
              <h2 className="flex items-baseline justify-between gap-2">
                <button
                  type="button"
                  onClick={() => irPara(dia)}
                  className="min-h-11 text-left font-titulo text-lg capitalize hover:text-marca"
                >
                  {weekdayPT(dia)}, {dateBR(dia)}
                </button>
                <span className="text-sm text-muted-foreground">{lista.length}</span>
              </h2>
              <ul className="flex flex-col gap-2.5">
                {lista.map((item) => (
                  <CartaoAtendimento
                    key={item.id}
                    item={item}
                    aberto={abertoId === item.id}
                    onAlternar={() => alternar(item.id)}
                    onDetalhes={() => detalhes(item.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Gaveta com o que antes ficava na frente da lista. */}
      <Sheet open={opcoes} onOpenChange={setOpcoes}>
        <SheetContent
          side="bottom"
          className="max-h-[88vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <SheetTitle className="font-titulo text-xl">Opções da agenda</SheetTitle>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pt-4">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold">Ver</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(Object.keys(NOME_MODO) as Modo[]).map((m) => (
                  <Botao
                    key={m}
                    variante={modo === m ? "primario" : "contorno"}
                    onClick={() => {
                      setModo(m);
                      setAberto(undefined);
                      setOpcoes(false);
                    }}
                  >
                    {NOME_MODO[m]}
                  </Botao>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <Label htmlFor="agenda-status" className="text-sm font-bold">
                Situação
              </Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="agenda-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  {VISIT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section className="flex flex-col gap-2">
              <Label htmlFor="agenda-data" className="text-sm font-bold">
                Ir para uma data
              </Label>
              <Input
                id="agenda-data"
                type="date"
                value={ref}
                onChange={(e) => {
                  if (!e.target.value) return;
                  irPara(e.target.value);
                  setOpcoes(false);
                }}
              />
            </section>

            <SugestaoDiasCep
              onEscolher={(dia) => {
                irPara(dia);
                setOpcoes(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

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

      <BudgetVisitDialog
        visit={null}
        open={novoOrcamento}
        onOpenChange={setNovoOrcamento}
        onChanged={recarregar}
      />
    </div>
  );
}
