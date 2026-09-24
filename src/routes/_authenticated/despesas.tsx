import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinanceQueries } from "@/lib/cache";
import { useSession } from "@/lib/session";
import {
  EXPENSE_STATUS_LIST,
  cashPaidAmount,
  fetchExpenseHistory,
  payExpense,
  remainingAmount,
  reopenExpense,
  setExpenseStatus,
  softDeleteExpense,
  updateExpense,
  type ExpenseFull,
  type ExpenseStatus,
} from "@/lib/expenses";
import { planRecurringMonth, syncRecurringMonth, type RecurringTemplate } from "@/lib/recurring-core";
import {
  brl,
  currentMonth,
  dateBR,
  dateTimeBR,
  monthEnd,
  monthLabelPT,
  monthStart,
  parseNumberBR,
  todayISO,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/despesas")({
  validateSearch: (search: Record<string, unknown>) => ({
    aba: search["aba"] ? String(search["aba"]) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Custos e despesas — Turbine Clean" },
      { name: "description", content: "Despesas fixas, recorrentes e de quilometragem, com vencimentos, pagamentos e histórico." },
      { property: "og:title", content: "Custos e despesas — Turbine Clean" },
      { property: "og:description", content: "Despesas fixas, recorrentes e de quilometragem, com vencimentos, pagamentos e histórico." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Despesas,
});


const CATEGORIAS = [
  "Salários",
  "Marketing",
  "Ferramentas",
  "Aluguel",
  "Escritório",
  "Sistemas",
  "Contabilidade",
  "Produtos",
  "Veículo",
  "Quilometragem",
  "Combustível",
  "Manutenção",
  "Impostos",
  "Outros",
];

const FORMAS = ["Pix", "Dinheiro", "Transferência", "Cartão", "Boleto", "Débito automático"];

const ABAS = [
  "Todas",
  "Pendentes",
  "Pagas",
  "Parcialmente pagas",
  "Vencidas",
  "Recorrentes",
  "Quilometragem",
  "Canceladas",
] as const;

type Aba = (typeof ABAS)[number];

function NativeSelect(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <select
      id={props.id}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className={`h-10 w-full rounded-md border border-input bg-background px-3 text-sm ${props.className ?? ""}`}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Despesas() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { aba: abaBusca } = Route.useSearch();
  const [mes, setMes] = useState(currentMonth());
  const [aba, setAba] = useState<Aba>(
    (ABAS as readonly string[]).includes(abaBusca ?? "") ? (abaBusca as Aba) : "Todas",
  );

  const [busca, setBusca] = useState("");
  const [nova, setNova] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("Outros");
  const [beneficiario, setBeneficiario] = useState("");
  const [valor, setValor] = useState("0,00");
  const [vencimento, setVencimento] = useState(todayISO());

  const [pagando, setPagando] = useState<ExpenseFull | null>(null);
  const [valorPago, setValorPago] = useState("0,00");
  const [dataPagamento, setDataPagamento] = useState(todayISO());
  const [formaPagamento, setFormaPagamento] = useState(FORMAS[0]!);
  const [obsPagamento, setObsPagamento] = useState("");
  const [parcial, setParcial] = useState(false);

  const [alterando, setAlterando] = useState<ExpenseFull | null>(null);
  const [novoStatus, setNovoStatus] = useState<ExpenseStatus>("Pendente");
  const [motivoStatus, setMotivoStatus] = useState("");

  const [editando, setEditando] = useState<ExpenseFull | null>(null);
  const [editDescricao, setEditDescricao] = useState("");
  const [editCategoria, setEditCategoria] = useState("Outros");
  const [editBeneficiario, setEditBeneficiario] = useState("");
  const [editValor, setEditValor] = useState("0,00");
  const [editVencimento, setEditVencimento] = useState("");
  const [editObs, setEditObs] = useState("");

  const [historicoDe, setHistoricoDe] = useState<ExpenseFull | null>(null);

  const query = useQuery({
    queryKey: ["despesas", mes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .is("deleted_at", null)
        .gte("competence_date", monthStart(mes))
        .lte("competence_date", monthEnd(mes))
        .order("due_date", { nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as ExpenseFull[];
    },
  });

  const templatesQuery = useQuery({
    queryKey: ["recurring_templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_expenses")
        .select(
          "id, name, category, default_amount, recurrence, due_day, weekday, start_date, end_date, active, beneficiary",
        )
        .eq("active", true);
      if (error) throw error;
      return (data ?? []) as unknown as RecurringTemplate[];
    },
  });

  const historicoQuery = useQuery({
    queryKey: ["expense_history", historicoDe?.id],
    queryFn: () => fetchExpenseHistory(historicoDe!.id),
    enabled: !!historicoDe,
  });

  const todas = query.data ?? [];

  const planejadas = useMemo(
    () => planRecurringMonth(templatesQuery.data ?? [], mes),
    [templatesQuery.data, mes],
  );

  const recorrentes = todas.filter((e) => e.recurring_expense_id);
  const chavesExistentes = useMemo(() => {
    const set = new Set<string>();
    for (const e of recorrentes) {
      if (e.reference_key) set.add(e.reference_key);
      if (e.recurring_expense_id) {
        set.add(
          e.due_date
            ? `recurring:${e.recurring_expense_id}:${e.due_date}`
            : `recurring:${e.recurring_expense_id}:${e.competence_date.slice(0, 7)}`,
        );
      }
    }
    return set;
  }, [recorrentes]);
  const faltantes = planejadas.filter((p) => !chavesExistentes.has(p.referenceKey));
  const semVencimento = planejadas.filter((p) => p.missingDueDay);

  const sincronizadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!templatesQuery.data || !query.data) return;
    if (sincronizadoRef.current === mes) return;
    if (faltantes.length === 0) return;
    sincronizadoRef.current = mes;
    void (async () => {
      try {
        const res = await syncRecurringMonth(supabase, mes);
        if (res.created > 0) {
          toast.success(res.message);
          query.refetch();
          invalidateFinanceQueries(queryClient);
        }
      } catch {
        toast.error("Não foi possível sincronizar as despesas recorrentes.");
      }
    })();
  }, [mes, templatesQuery.data, query.data, faltantes.length, query]);

  const lista = todas
    .filter((e) => {
      if (aba === "Pendentes") return e.status === "Pendente";
      if (aba === "Pagas") return e.status === "Pago";
      if (aba === "Parcialmente pagas") return e.status === "Parcialmente pago";
      if (aba === "Vencidas") return e.status === "Vencido" || (e.status === "Pendente" && e.due_date && e.due_date < todayISO());
      if (aba === "Recorrentes") return !!e.recurring_expense_id;
      if (aba === "Quilometragem") return e.category === "Quilometragem" || e.category === "Combustível";
      if (aba === "Canceladas") return e.status === "Cancelado";
      return true;
    })
    .filter((e) => {
      const termo = busca.trim().toLowerCase();
      if (!termo) return true;
      return `${e.description} ${e.category} ${e.beneficiary ?? ""} ${e.origin}`.toLowerCase().includes(termo);
    });

  const previsto = lista.filter((e) => e.status !== "Cancelado").reduce((s, e) => s + Number(e.expected_amount ?? 0), 0);
  const pago = lista.reduce((s, e) => s + cashPaidAmount(e), 0);

  const recorrentesGeradas = recorrentes.length;
  const recorrentesPagas = recorrentes.filter((e) => e.status === "Pago").length;
  const recorrentesPendentes = recorrentes.filter((e) => e.status !== "Pago" && e.status !== "Cancelado").length;
  const totalRecorrentePrevisto = planejadas.reduce((s, p) => s + p.amount, 0);
  const totalRecorrentePago = recorrentes.reduce((s, e) => s + cashPaidAmount(e), 0);

  async function sincronizarMes() {
    setSincronizando(true);
    try {
      const res = await syncRecurringMonth(supabase, mes);
      toast.success(res.message);
      if (res.missingDueDay.length) {
        toast.warning(`Existem despesas recorrentes sem dia de vencimento configurado: ${res.missingDueDay.join(", ")}.`);
      }
      query.refetch();
      invalidateFinanceQueries(queryClient);
    } catch {
      toast.error("Não foi possível sincronizar as despesas recorrentes.");
    } finally {
      setSincronizando(false);
    }
  }

  async function criarDespesa() {
    if (descricao.trim().length < 3) {
      toast.error("Informe a descrição da despesa.");
      return;
    }
    if (parseNumberBR(valor) <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    const { error } = await supabase.from("expenses").insert({
      description: descricao.trim(),
      category: categoria,
      beneficiary: beneficiario.trim() || null,
      origin: "Manual",
      competence_date: `${mes}-01`,
      due_date: vencimento,
      expected_amount: parseNumberBR(valor),
      paid_amount: 0,
      status: "Pendente",
      updated_by: userId,
    });
    if (error) {
      toast.error(`Não foi possível salvar a despesa: ${error.message}`);
      return;
    }
    toast.success("Despesa cadastrada como pendente.");
    setNova(false);
    setDescricao("");
    setBeneficiario("");
    setValor("0,00");
    query.refetch();
    invalidateFinanceQueries(queryClient);
  }

  function abrirPagamento(e: ExpenseFull) {
    setPagando(e);
    setParcial(false);
    setValorPago(String(Number(e.expected_amount ?? 0).toFixed(2)).replace(".", ","));
    setDataPagamento(todayISO());
    setFormaPagamento(FORMAS[0]!);
    setObsPagamento("");
  }

  async function confirmarPagamento() {
    if (!pagando) return;
    const amount = parseNumberBR(valorPago);
    if (amount <= 0) {
      toast.error("Informe o valor pago.");
      return;
    }
    if (amount > Number(pagando.expected_amount ?? 0) && !parcial) {
      const ok = window.confirm(
        "O valor pago é maior que o valor previsto. Deseja confirmar como ajuste?",
      );
      if (!ok) return;
    }
    try {
      await payExpense({
        expense: pagando,
        amount,
        paymentDate: dataPagamento,
        paymentMethod: formaPagamento,
        notes: obsPagamento.trim() || null,
        partial: parcial,
        userId,
      });
      toast.success("Pagamento registrado.");
      setPagando(null);
      query.refetch();
      invalidateFinanceQueries(queryClient);
    } catch (error) {
      toast.error(`Não foi possível registrar o pagamento: ${(error as Error).message}`);
    }
  }

  function abrirStatus(e: ExpenseFull) {
    setAlterando(e);
    setNovoStatus((e.status as ExpenseStatus) ?? "Pendente");
    setMotivoStatus("");
  }

  async function confirmarStatus() {
    if (!alterando) return;
    try {
      if (novoStatus === "Pago") {
        setAlterando(null);
        abrirPagamento(alterando);
        return;
      }
      if (novoStatus === "Parcialmente pago") {
        setAlterando(null);
        setParcial(true);
        setPagando(alterando);
        setValorPago(String(Number(alterando.paid_amount ?? 0).toFixed(2)).replace(".", ","));
        setDataPagamento(todayISO());
        return;
      }
      const eraPago = alterando.status === "Pago" || Number(alterando.paid_amount ?? 0) > 0;
      if (eraPago && novoStatus === "Pendente") {
        const ok = window.confirm(
          "Esta despesa está marcada como paga. Deseja reabri-la como pendente?",
        );
        if (!ok) return;
        await reopenExpense({ expense: alterando, reason: motivoStatus.trim() || null, userId });
      } else {
        await setExpenseStatus({
          expense: alterando,
          status: novoStatus,
          reason: motivoStatus.trim() || null,
          userId,
        });
      }
      toast.success(`Status alterado para ${novoStatus}.`);
      setAlterando(null);
      query.refetch();
      invalidateFinanceQueries(queryClient);
    } catch (error) {
      toast.error(`Não foi possível alterar o status: ${(error as Error).message}`);
    }
  }

  function abrirEdicao(e: ExpenseFull) {
    setEditando(e);
    setEditDescricao(e.description);
    setEditCategoria(e.category);
    setEditBeneficiario(e.beneficiary ?? "");
    setEditValor(String(Number(e.expected_amount ?? 0).toFixed(2)).replace(".", ","));
    setEditVencimento(e.due_date ?? "");
    setEditObs(e.notes ?? "");
  }

  async function salvarEdicao() {
    if (!editando) return;
    try {
      await updateExpense({
        id: editando.id,
        description: editDescricao.trim(),
        category: editCategoria,
        beneficiary: editBeneficiario.trim() || null,
        competence_date: editando.competence_date,
        due_date: editVencimento || null,
        expected_amount: parseNumberBR(editValor),
        notes: editObs.trim() || null,
        userId,
      });
      toast.success("Despesa atualizada.");
      setEditando(null);
      query.refetch();
      invalidateFinanceQueries(queryClient);
    } catch (error) {
      toast.error(`Não foi possível salvar a despesa: ${(error as Error).message}`);
    }
  }

  async function cancelarDespesa(e: ExpenseFull) {
    const motivo = window.prompt("Motivo do cancelamento da despesa:");
    if (motivo === null) return;
    try {
      await softDeleteExpense({ expense: e, reason: motivo || null, userId });
      toast.success("Despesa cancelada.");
      query.refetch();
      invalidateFinanceQueries(queryClient);
    } catch (error) {
      toast.error(`Não foi possível cancelar a despesa: ${(error as Error).message}`);
    }
  }

  return (
    <>
      <PageHeader
        title="Custos e despesas"
        description={`${monthLabelPT(mes)} · previsto ${brl(previsto)} · pago ${brl(pago)}`}
        actions={
          <>
            <Button variant="outline" onClick={sincronizarMes} disabled={sincronizando}>
              {sincronizando ? "Sincronizando..." : "Sincronizar despesas do mês"}
            </Button>
            <Button onClick={() => setNova(true)}>Nova despesa</Button>
          </>
        }
      />

      <div className="card-surface mb-6 space-y-3 p-4">
        <h2 className="text-base font-semibold">Despesas recorrentes do mês</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Info label="Previstas" value={String(planejadas.length)} />
          <Info label="Geradas" value={String(recorrentesGeradas)} />
          <Info label="Faltantes" value={String(faltantes.length)} />
          <Info label="Pagas" value={String(recorrentesPagas)} />
          <Info label="Pendentes" value={String(recorrentesPendentes)} />
          <Info label="Total previsto" value={brl(totalRecorrentePrevisto)} />
        </div>
        <p className="text-sm text-muted-foreground">
          Total pago {brl(totalRecorrentePago)} · total pendente{" "}
          {brl(Math.max(0, totalRecorrentePrevisto - totalRecorrentePago))}
        </p>
        {semVencimento.length > 0 && (
          <p className="text-sm text-warning-foreground">
            Dia de vencimento não configurado: {semVencimento.map((p) => p.name).join(", ")}.
          </p>
        )}
        {faltantes.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Faltando gerar: {faltantes.map((p) => `${p.name}${p.dueDate ? ` (${dateBR(p.dueDate)})` : ""}`).join(", ")}.
          </p>
        )}
      </div>

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="mes">Mês</Label>
          <Input id="mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-[170px]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="busca">Buscar</Label>
          <Input
            id="busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Descrição, categoria, beneficiário"
            className="w-[260px]"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {ABAS.map((a) => (
            <Button key={a} size="sm" variant={aba === a ? "default" : "outline"} onClick={() => setAba(a)}>
              {a}
            </Button>
          ))}
        </div>
      </div>

      {lista.length === 0 ? (
        <EmptyState
          title="Nenhuma despesa no filtro selecionado"
          description="Use “Sincronizar despesas do mês” para gerar as despesas recorrentes que faltam."
        />
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="px-3 py-3 font-medium">Descrição</th>
                <th className="px-3 py-3 font-medium">Categoria</th>
                <th className="px-3 py-3 font-medium">Beneficiário</th>
                <th className="px-3 py-3 font-medium">Origem</th>
                <th className="px-3 py-3 font-medium">Competência</th>
                <th className="px-3 py-3 font-medium">Vencimento</th>
                <th className="px-3 py-3 font-medium">Previsto</th>
                <th className="px-3 py-3 font-medium">Pago</th>
                <th className="px-3 py-3 font-medium">Restante</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Pagamento</th>
                <th className="px-3 py-3 font-medium">Atualização</th>
                <th className="px-3 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="px-3 py-3">{e.description}</td>
                  <td className="px-3 py-3">{e.category}</td>
                  <td className="px-3 py-3">{e.beneficiary ?? "—"}</td>
                  <td className="px-3 py-3">{e.origin}</td>
                  <td className="px-3 py-3">{dateBR(e.competence_date)}</td>
                  <td className="px-3 py-3">
                    {e.due_date ? dateBR(e.due_date) : <span className="text-warning-foreground">Dia de vencimento não configurado</span>}
                  </td>
                  <td className="px-3 py-3">{brl(e.expected_amount)}</td>
                  <td className="px-3 py-3">{cashPaidAmount(e) > 0 ? brl(cashPaidAmount(e)) : "—"}</td>
                  <td className="px-3 py-3">{brl(remainingAmount(e))}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-3 py-3">
                    {e.payment_date ? `${dateBR(e.payment_date)}${e.payment_method ? ` · ${e.payment_method}` : ""}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{dateTimeBR(e.updated_at)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {e.status !== "Pago" && e.status !== "Cancelado" && (
                        <Button size="sm" variant="outline" onClick={() => abrirPagamento(e)}>
                          Registrar pagamento
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => abrirStatus(e)}>
                        Alterar status
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => abrirEdicao(e)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setHistoricoDe(e)}>
                        Histórico
                      </Button>
                      {e.status !== "Cancelado" && (
                        <Button size="sm" variant="ghost" onClick={() => cancelarDespesa(e)}>
                          Cancelar
                        </Button>
                      )}
                      {e.daily_route_id && (
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/rotas" search={{ dia: e.competence_date }}>
                            Abrir rota
                          </Link>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={nova} onOpenChange={setNova}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova despesa</DialogTitle>
            <DialogDescription>Cadastre uma despesa avulsa para o mês selecionado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="desc">Descrição</Label>
              <Input id="desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat">Categoria</Label>
              <NativeSelect
                id="cat"
                value={categoria}
                onChange={setCategoria}
                options={CATEGORIAS.map((c) => ({ value: c, label: c }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="benef">Beneficiário (opcional)</Label>
              <Input id="benef" value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="valor">Valor previsto</Label>
              <Input id="valor" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="venc">Vencimento</Label>
              <Input id="venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNova(false)}>
              Cancelar
            </Button>
            <Button onClick={criarDespesa}>Salvar despesa</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pagando} onOpenChange={(v) => !v && setPagando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{parcial ? "Registrar pagamento parcial" : "Registrar pagamento"}</DialogTitle>
            <DialogDescription>{pagando?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Previsto {brl(pagando?.expected_amount ?? 0)} · restante{" "}
              {brl(pagando ? remainingAmount(pagando) : 0)}
            </p>
            <div className="space-y-2">
              <Label htmlFor="valor-pago">Valor pago</Label>
              <Input id="valor-pago" value={valorPago} onChange={(e) => setValorPago(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="data-pag">Data do pagamento</Label>
              <Input id="data-pag" type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="forma">Forma de pagamento</Label>
              <NativeSelect
                id="forma"
                value={formaPagamento}
                onChange={setFormaPagamento}
                options={FORMAS.map((f) => ({ value: f, label: f }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="obs-pag">Observação (opcional)</Label>
              <Textarea id="obs-pag" value={obsPagamento} onChange={(e) => setObsPagamento(e.target.value)} rows={2} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={parcial} onChange={(e) => setParcial(e.target.checked)} />
              Pagamento parcial
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPagando(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarPagamento}>Confirmar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!alterando} onOpenChange={(v) => !v && setAlterando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar status</DialogTitle>
            <DialogDescription>{alterando?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="status">Novo status</Label>
              <NativeSelect
                id="status"
                value={novoStatus}
                onChange={(v) => setNovoStatus(v as ExpenseStatus)}
                options={EXPENSE_STATUS_LIST.map((s) => ({ value: s, label: s }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="motivo-status">Motivo (opcional)</Label>
              <Input id="motivo-status" value={motivoStatus} onChange={(e) => setMotivoStatus(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAlterando(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarStatus}>Confirmar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editando} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar despesa</DialogTitle>
            <DialogDescription>Altere os dados da despesa selecionada.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="ed-desc">Descrição</Label>
              <Input id="ed-desc" value={editDescricao} onChange={(e) => setEditDescricao(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-cat">Categoria</Label>
              <NativeSelect
                id="ed-cat"
                value={editCategoria}
                onChange={setEditCategoria}
                options={CATEGORIAS.map((c) => ({ value: c, label: c }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-benef">Beneficiário</Label>
              <Input id="ed-benef" value={editBeneficiario} onChange={(e) => setEditBeneficiario(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-valor">Valor previsto</Label>
              <Input id="ed-valor" value={editValor} onChange={(e) => setEditValor(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-venc">Vencimento</Label>
              <Input id="ed-venc" type="date" value={editVencimento} onChange={(e) => setEditVencimento(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-obs">Observação</Label>
              <Textarea id="ed-obs" value={editObs} onChange={(e) => setEditObs(e.target.value)} rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicao}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historicoDe} onOpenChange={(v) => !v && setHistoricoDe(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Histórico da despesa</DialogTitle>
            <DialogDescription>{historicoDe?.description}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[360px] space-y-2 overflow-y-auto text-sm">
            {(historicoQuery.data ?? []).length === 0 ? (
              <p className="text-muted-foreground">Nenhuma alteração registrada.</p>
            ) : (
              (historicoQuery.data ?? []).map((h) => (
                <div key={h.id} className="rounded-md border border-border p-3">
                  <p className="font-medium">
                    {h.previous_status ?? "—"} → {h.new_status}
                  </p>
                  <p className="text-muted-foreground">{dateTimeBR(h.changed_at)}</p>
                  <p className="text-muted-foreground">
                    Pago: {brl(h.previous_paid_amount ?? 0)} → {brl(h.new_paid_amount ?? 0)} · pagamento em{" "}
                    {h.new_payment_date ? dateBR(h.new_payment_date) : "—"}
                  </p>
                  {h.reason && <p>{h.reason}</p>}
                  {h.notes && <p className="text-muted-foreground">{h.notes}</p>}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Info(props: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className="text-lg font-semibold">{props.value}</p>
    </div>
  );
}
