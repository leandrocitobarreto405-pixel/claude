import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarPlus,
  ClipboardPlus,
  FileCheck2,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AbasDeRota, BadgeAlerta, Botao, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { JanelaNovaOs } from "@/components/nova-os/janela";
import { ABAS_DE_TELA } from "@/lib/menu";
import { supabase } from "@/integrations/supabase/client";
import {
  brl,
  currentMonth,
  dateBR,
  monthEnd,
  monthLabelPT,
  monthStart,
  timeBR,
  todayISO,
} from "@/lib/format";
import { useSalespeople, useTechnicians } from "@/lib/data";
import {
  CHIPS_OS,
  STATUS_OS_ABERTAS,
  atendimentoDoCartao,
  buscarOs,
  chipSemPeriodo,
  filtrarPorChip,
  resumoDoServico,
  situacaoDaOs,
  temDocumento,
  textoTotal,
  totalDaLista,
  type ChipOs,
  type OsDaLista,
} from "@/lib/oss-lista";
import { cn } from "@/lib/utils";
import {
  OPCOES_QUEM_VENDEU,
  filtrarQuemVendeu,
  temVendaDaNexa,
  vendidaPelaNexa,
  type QuemVendeu,
} from "@/lib/vendido-por";

export const Route = createFileRoute("/_authenticated/oss")({
  validateSearch: (s: Record<string, unknown>): BuscaOss => {
    const r: BuscaOss = {};
    if (CHIPS_OS.some((c) => c.id === s["chip"])) r.chip = s["chip"] as ChipOs;
    if (s["nova"]) r.nova = 1;
    for (const k of ["lead", "orcamento", "cotacao"] as const) {
      if (typeof s[k] === "string" && s[k]) r[k] = s[k] as string;
    }
    return r;
  },
  head: () => ({
    meta: [
      { title: "OS e orçamentos — Nexa OS" },
      {
        name: "description",
        content: "Ordens de serviço em cartões, com busca, situação, período, vendedora e técnico.",
      },
      { property: "og:title", content: "OS e orçamentos — Nexa OS" },
      {
        property: "og:description",
        content: "Ordens de serviço em cartões, com busca, situação, período, vendedora e técnico.",
      },
    ],
  }),
  component: OssCriadas,
  errorComponent: () => (
    <Card className="text-center">
      <p className="font-bold">Não foi possível carregar as OS.</p>
    </Card>
  ),
});

const SELECT = `
  id, os_number, sale_date, status, total_gross_value, eh_teste, cancelled_at, deleted_at, salesperson_id,
  vendido_por, vendedora:salesperson_id ( atendente_nexa ),
  customer:customer_id ( full_name, phone ),
  visits!visits_work_order_id_fkey ( status, scheduled_date, scheduled_time, technician_id, upholstery_description,
    technician:technician_id ( name ), service_type:service_type_id ( name ), service_items ( description, active ) ),
  work_order_documents ( is_active, generation_status )
`;

type BuscaOss = { chip?: ChipOs; nova?: 1; lead?: string; orcamento?: string; cotacao?: string };

function OssCriadas() {
  const navigate = useNavigate();
  const { chip: chipInicial, nova, lead, orcamento, cotacao } = Route.useSearch();
  const origemDaJanela = useMemo(
    () => ({
      ...(lead ? { lead } : {}),
      ...(orcamento ? { orcamento } : {}),
      ...(cotacao ? { cotacao } : {}),
    }),
    [lead, orcamento, cotacao],
  );
  const hoje = todayISO();
  const mes = currentMonth();
  const [chip, setChip] = useState<ChipOs>(chipInicial ?? "todas");
  const [busca, setBusca] = useState("");
  const [de, setDe] = useState(monthStart(mes));
  const [ate, setAte] = useState(monthEnd(mes));
  const [vendedora, setVendedora] = useState("");
  const [tecnico, setTecnico] = useState("");
  // Decisão E: Vendas da Nexa x da empresa (só aparece quando há venda da Nexa).
  const [quemVendeu, setQuemVendeu] = useState<QuemVendeu>("todas");
  const [filtros, setFiltros] = useState(false);
  const { data: vendedoras } = useSalespeople(false);
  const { data: tecnicos } = useTechnicians(false);

  // Período pela data da venda (padrão: mês atual). Agendadas e Em andamento ignoram o período:
  // senão some serviço marcado para o mês que vem.
  const semPeriodo = chipSemPeriodo(chip);
  const porPeriodo = useQuery({
    queryKey: ["oss_criadas", de, ate],
    enabled: !semPeriodo,
    queryFn: async () => {
      let q = supabase.from("work_orders").select(SELECT).order("sale_date", { ascending: false });
      if (de) q = q.gte("sale_date", de);
      if (ate) q = q.lte("sale_date", ate);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as OsDaLista[];
    },
  });
  const abertas = useQuery({
    queryKey: ["oss_abertas"],
    enabled: semPeriodo,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select(SELECT)
        .in("status", STATUS_OS_ABERTAS)
        .is("deleted_at", null)
        .order("sale_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as OsDaLista[];
    },
  });
  const fonte = semPeriodo ? abertas : porPeriodo;

  const lista = useMemo(() => {
    const base = filtrarPorChip(fonte.data ?? [], chip).filter(
      (r) =>
        (!vendedora || r.salesperson_id === vendedora) &&
        (!tecnico || r.visits.some((v) => v.technician_id === tecnico)),
    );
    return buscarOs(filtrarQuemVendeu(base, quemVendeu), busca);
  }, [fonte.data, chip, vendedora, tecnico, busca, quemVendeu]);
  const separaVendas = temVendaDaNexa(fonte.data ?? []);

  const total = totalDaLista(lista);
  const rotuloPeriodo = semPeriodo
    ? "em aberto"
    : de === monthStart(mes) && ate === monthEnd(mes)
      ? `em ${monthLabelPT(mes).split(" de ")[0]}`
      : `de ${dateBR(de)} a ${dateBR(ate)}`;
  const filtrosAtivos =
    (vendedora ? 1 : 0) +
    (quemVendeu !== "todas" ? 1 : 0) +
    (tecnico ? 1 : 0) +
    (!semPeriodo && (de !== monthStart(mes) || ate !== monthEnd(mes)) ? 1 : 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-20">
      <CabecalhoDeTela titulo="OS e orçamentos" />
      <AbasDeRota abas={ABAS_DE_TELA.os} rotulo="OS e orçamentos" />

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Buscar"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nº da OS, cliente, telefone ou estofado"
            className="min-h-11 pl-9"
          />
        </div>
        <Botao variante="contorno" className="relative shrink-0" onClick={() => setFiltros(true)}>
          <SlidersHorizontal /> Filtros
          {filtrosAtivos ? (
            <BadgeAlerta numero={filtrosAtivos} className="absolute -top-1.5 -right-1.5" />
          ) : null}
        </Botao>
      </div>

      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
        role="group"
        aria-label="Situação"
      >
        {CHIPS_OS.map((c) => {
          const sel = chip === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={sel}
              onClick={() => setChip(c.id)}
              className={cn(
                "min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors",
                sel
                  ? "border-marca bg-marca text-marca-foreground"
                  : "border-border bg-card text-foreground hover:border-marca/40",
              )}
            >
              {c.rotulo}
            </button>
          );
        })}
      </div>

      {separaVendas || quemVendeu !== "todas" ? (
        <div
          className="flex rounded-full border border-border bg-card p-1"
          role="group"
          aria-label="Quem vendeu"
        >
          {OPCOES_QUEM_VENDEU.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={quemVendeu === o.id}
              onClick={() => setQuemVendeu(o.id)}
              className={cn(
                "min-h-11 flex-1 rounded-full px-3 text-sm font-semibold transition-colors",
                quemVendeu === o.id ? "bg-marca text-marca-foreground" : "text-muted-foreground",
              )}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      ) : null}

      {fonte.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <p className="text-[15px] font-bold">Nenhuma OS aqui</p>
          <p className="text-sm text-muted-foreground">Ajuste a busca, a situação ou os filtros.</p>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {textoTotal(total, rotuloPeriodo)}
            {lista.some((r) => r.eh_teste) ? " · OS de teste fora do total" : ""}
          </p>
          <ul className="flex flex-col gap-2.5" aria-label="Ordens de serviço">
            {lista.map((r) => {
              const sit = situacaoDaOs(r);
              const at = atendimentoDoCartao(r.visits, hoje);
              return (
                <li key={r.id}>
                  <Link
                    to="/os/$osNumber"
                    params={{ osNumber: r.os_number }}
                    className="flex flex-col gap-1.5 rounded-card border border-border bg-card p-4 hover:border-marca/40"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="font-titulo text-[17px]">OS {r.os_number}</span>
                        {temDocumento(r) ? (
                          <FileCheck2
                            className="size-4 text-success"
                            aria-label="Documento gerado"
                          />
                        ) : null}
                        {r.eh_teste ? <Chip tom="neutro">Teste</Chip> : null}
                        {separaVendas && vendidaPelaNexa(r) ? <Chip tom="neutro">Nexa</Chip> : null}
                      </span>
                      <Chip tom={sit.tom}>{sit.rotulo}</Chip>
                    </span>
                    <span className="truncate text-[15px] font-bold">
                      {r.customer?.full_name ?? "Cliente"}
                    </span>
                    <span className="text-[13px] text-muted-foreground">{resumoDoServico(r)}</span>
                    <span className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                      <span>
                        {at
                          ? `${dateBR(at.scheduled_date)}${at.scheduled_time ? ` · ${timeBR(at.scheduled_time)}` : ""} · ${at.technician?.name ?? "Sem técnico"}`
                          : "Sem atendimento"}
                      </span>
                      <span className="font-titulo text-base text-foreground">
                        {brl(Number(r.total_gross_value ?? 0))}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Botão flutuante: Nova OS ou Novo orçamento. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Botao
            tamanho="grande"
            aria-label="Nova OS ou orçamento"
            className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 size-14 rounded-full p-0 shadow-card lg:bottom-6"
          >
            <Plus className="size-6" />
          </Botao>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem onSelect={() => void navigate({ to: "/oss", search: { nova: 1 } })}>
            <ClipboardPlus className="size-4" /> Nova OS
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void navigate({ to: "/orcamentos/$quoteId", params: { quoteId: "novo" } })
            }
          >
            <CalendarPlus className="size-4" /> Novo orçamento
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <JanelaNovaOs
        aberta={nova === 1}
        origem={origemDaJanela}
        aoFechar={() =>
          void navigate({ to: "/oss", search: chip === "todas" ? {} : { chip }, replace: true })
        }
      />

      <Sheet open={filtros} onOpenChange={setFiltros}>
        <SheetContent
          side="bottom"
          className="max-h-[88vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <SheetTitle className="font-titulo text-xl">Filtros</SheetTitle>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="de">Venda de</Label>
                <Input
                  id="de"
                  type="date"
                  value={de}
                  onChange={(e) => setDe(e.target.value)}
                  disabled={semPeriodo}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ate">Venda até</Label>
                <Input
                  id="ate"
                  type="date"
                  value={ate}
                  onChange={(e) => setAte(e.target.value)}
                  disabled={semPeriodo}
                />
              </div>
            </div>
            {semPeriodo ? (
              <p className="text-xs text-muted-foreground">
                Agendadas e Em andamento mostram tudo o que está em aberto, sem período.
              </p>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="vendedora">Vendedora</Label>
              <select
                id="vendedora"
                value={vendedora}
                onChange={(e) => setVendedora(e.target.value)}
                className="min-h-11 w-full rounded-botao border border-input bg-background px-3 text-sm"
              >
                <option value="">Todas</option>
                {(vendedoras ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tecnico">Técnico</Label>
              <select
                id="tecnico"
                value={tecnico}
                onChange={(e) => setTecnico(e.target.value)}
                className="min-h-11 w-full rounded-botao border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {(tecnicos ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Botao
                variante="neutro"
                onClick={() => {
                  setDe(monthStart(mes));
                  setAte(monthEnd(mes));
                  setVendedora("");
                  setTecnico("");
                  setQuemVendeu("todas");
                }}
              >
                Limpar
              </Botao>
              <Botao onClick={() => setFiltros(false)}>Aplicar</Botao>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
