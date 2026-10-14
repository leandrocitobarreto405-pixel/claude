import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { AbasDeRota, Botao, Recolhido } from "@/components/nexa";
import { ABAS_DE_TELA, abasPermitidas } from "@/lib/menu";
import { useContextoTenant } from "@/lib/tenant";

import { StatusBadge } from "@/components/visit-dialog";
import { PaymentDialog } from "@/components/payment-dialog";
import { PAYMENT_CHANNELS, PAYMENT_STATUSES } from "@/lib/data";
import { fetchPayments, fetchPaymentsByServiceMonth, type PaymentRow } from "@/lib/reports";
import { recebido } from "@/lib/payments";
import { fetchPaymentHistory, type PaymentFull } from "@/lib/payments";
import {
  brl,
  currentMonth,
  dateBR,
  dateTimeBR,
  monthEnd,
  monthLabelPT,
  monthStart,
  todayISO,
  weekEnd,
  weekStart,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/pagamentos")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: search["status"] ? String(search["status"]) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Recebimentos: recebidos — Nexa OS" },
      {
        name: "description",
        content: "Controle de recebimentos, taxas por canal e valores líquidos.",
      },
      { property: "og:title", content: "Recebimentos: recebidos — Nexa OS" },
      {
        property: "og:description",
        content: "Controle de recebimentos, taxas por canal e valores líquidos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Pagamentos,
});

type Modo = "dia" | "semana" | "mes" | "personalizado";

function Pagamentos() {
  const { status: statusBusca } = Route.useSearch();
  const [modo, setModo] = useState<Modo>("mes");
  const [mes, setMes] = useState(currentMonth());
  const [dia, setDia] = useState(todayISO());
  const [de, setDe] = useState(monthStart(currentMonth()));
  const [ate, setAte] = useState(monthEnd(currentMonth()));
  const [canal, setCanal] = useState("todos");
  const [status, setStatus] = useState(statusBusca ?? "todos");
  const [busca, setBusca] = useState("");
  const [referencia, setReferencia] = useState<"pagamento" | "servico">("pagamento");

  const [dialogo, setDialogo] = useState<{
    payment: PaymentRow;
    mode: "registrar" | "reabrir";
  } | null>(null);
  const [historico, setHistorico] = useState<PaymentRow | null>(null);
  const { data: tenant } = useContextoTenant();
  const papel = tenant?.ativa?.papel ?? null;
  const souNexa = tenant?.souNexa === true;

  const { from, to, periodoLabel } = useMemo(() => {
    if (modo === "dia") return { from: dia, to: dia, periodoLabel: dateBR(dia) };
    if (modo === "semana") {
      const f = weekStart(dia);
      const t = weekEnd(dia);
      return { from: f, to: t, periodoLabel: `${dateBR(f)} a ${dateBR(t)}` };
    }
    if (modo === "personalizado") {
      const f = de <= ate ? de : ate;
      const t = de <= ate ? ate : de;
      return { from: f, to: t, periodoLabel: `${dateBR(f)} a ${dateBR(t)}` };
    }
    return { from: monthStart(mes), to: monthEnd(mes), periodoLabel: monthLabelPT(mes) };
  }, [modo, dia, de, ate, mes]);

  const query = useQuery({
    queryKey: ["pagamentos", from, to, referencia],
    queryFn: () =>
      referencia === "servico"
        ? fetchPaymentsByServiceMonth(from, to)
        : fetchPayments(from, to, true),
  });

  const lista = useMemo(
    () =>
      (query.data ?? []).filter((p) => {
        const termo = busca.trim().toLowerCase();
        const cliente = p.work_order?.customer?.full_name?.toLowerCase() ?? "";
        const os = p.work_order?.os_number?.toLowerCase() ?? "";
        return (
          (canal === "todos" || p.payment_channel === canal) &&
          (status === "todos" || p.payment_status === status) &&
          (!termo || cliente.includes(termo) || os.includes(termo))
        );
      }),
    [query.data, canal, status, busca],
  );

  /** Chaves com mais de um pagamento ativo idêntico (mesma OS, data e valor). */
  const duplicadas = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of query.data ?? []) {
      if (!recebido(p)) continue;
      const key = `${p.work_order_id}|${p.payment_date}|${Number(p.gross_amount).toFixed(2)}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [query.data]);

  const isDuplicada = (p: PaymentRow) =>
    recebido(p) &&
    duplicadas.has(`${p.work_order_id}|${p.payment_date}|${Number(p.gross_amount).toFixed(2)}`);

  const pagos = lista.filter(recebido);
  const bruto = pagos.reduce((s, p) => s + Number(p.gross_amount), 0);
  const taxas = pagos.reduce((s, p) => s + Number(p.payment_fee_amount), 0);
  const liquido = pagos.reduce((s, p) => s + Number(p.net_amount), 0);

  function abrir(p: PaymentRow, mode: "registrar" | "reabrir") {
    setDialogo({ payment: p, mode });
  }

  return (
    <>
      <PageHeader
        title="Financeiro"
        description={`Recebidos · ${periodoLabel} · ${lista.length} lançamento(s) · ${pagos.length} pago(s)`}
      />
      <AbasDeRota
        abas={abasPermitidas(ABAS_DE_TELA.financeiro, papel, souNexa)}
        rotulo="Financeiro"
        className="mb-6"
      />

      <div className="mb-6 grid grid-cols-3 gap-2.5 sm:gap-4">
        <Card label="Total bruto recebido" value={brl(bruto)} />
        <Card label="Taxas de pagamento" value={brl(taxas)} />
        <Card label="Valor líquido" value={brl(liquido)} />
      </div>

      <Recolhido titulo="Filtros" className="mb-6">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label>Referência</Label>
            <Select
              value={referencia}
              onValueChange={(v) => setReferencia(v as "pagamento" | "servico")}
            >
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pagamento">Data do pagamento</SelectItem>
                <SelectItem value="servico">Mês do serviço</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Período</Label>
            <Select value={modo} onValueChange={(v) => setModo(v as Modo)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dia">Dia</SelectItem>
                <SelectItem value="semana">Semana</SelectItem>
                <SelectItem value="mes">Mês</SelectItem>
                <SelectItem value="personalizado">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {modo === "mes" ? (
            <div className="space-y-1">
              <Label htmlFor="mes">Mês</Label>
              <Input
                id="mes"
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                className="w-[170px]"
              />
            </div>
          ) : null}
          {modo === "dia" || modo === "semana" ? (
            <div className="space-y-1">
              <Label htmlFor="dia">{modo === "dia" ? "Data" : "Semana de"}</Label>
              <Input
                id="dia"
                type="date"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
                className="w-[170px]"
              />
            </div>
          ) : null}
          {modo === "personalizado" ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="de">De</Label>
                <Input
                  id="de"
                  type="date"
                  value={de}
                  onChange={(e) => setDe(e.target.value)}
                  className="w-[160px]"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ate">Até</Label>
                <Input
                  id="ate"
                  type="date"
                  value={ate}
                  onChange={(e) => setAte(e.target.value)}
                  className="w-[160px]"
                />
              </div>
            </>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="busca-pag">Buscar cliente ou OS</Label>
            <Input
              id="busca-pag"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome do cliente ou nº da OS"
              className="w-[240px]"
            />
          </div>
          <div className="space-y-1">
            <Label>Canal</Label>
            <Select value={canal} onValueChange={setCanal}>
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {PAYMENT_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {PAYMENT_STATUSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Recolhido>

      {lista.length === 0 ? (
        <EmptyState title="Nenhum pagamento no período" description="Ajuste o mês ou os filtros." />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Recebidos">
          {lista.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 rounded-card border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs font-bold text-muted-foreground">
                    {dateBR(p.payment_date)} · OS {p.work_order?.os_number}
                  </span>
                  <span className="truncate text-[15px] font-bold">
                    {p.work_order?.customer?.full_name ?? "Cliente"}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {p.payment_channel} · {p.payment_type}
                    {p.installments > 1 ? ` ${p.installments}x` : ""} · taxa{" "}
                    {brl(p.payment_fee_amount)} (
                    {Number(p.applied_rate).toFixed(2).replace(".", ",")}%)
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-titulo text-[17px]">{brl(p.gross_amount)}</span>
                  <span className="text-xs text-muted-foreground">líquido {brl(p.net_amount)}</span>
                  <StatusBadge status={p.payment_status} />
                </div>
              </div>
              {isDuplicada(p) ? (
                <p className="text-xs font-semibold text-problema-foreground">
                  Possível duplicidade: outro pagamento pago da mesma OS, mesma data e valor.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {p.payment_status !== "Pago" ? (
                  <Botao variante="contorno" onClick={() => abrir(p, "registrar")}>
                    {p.reopen_reason ? "Registrar novo pagamento" : "Marcar como pago"}
                  </Botao>
                ) : (
                  <>
                    <Botao variante="contorno" onClick={() => abrir(p, "registrar")}>
                      Editar
                    </Botao>
                    <Botao variante="neutro" onClick={() => abrir(p, "reabrir")}>
                      Reabrir
                    </Botao>
                  </>
                )}
                <Botao variante="neutro" onClick={() => setHistorico(p)}>
                  Histórico
                </Botao>
              </div>
            </li>
          ))}
          <li className="flex items-center justify-between px-1 text-sm font-bold">
            <span>
              Total · {periodoLabel} · {pagos.length} pago(s)
            </span>
            <span>
              {brl(bruto)}{" "}
              <span className="font-normal text-muted-foreground">(líquido {brl(liquido)})</span>
            </span>
          </li>
        </ul>
      )}

      <PaymentDialog
        open={dialogo !== null}
        onOpenChange={(v) => !v && setDialogo(null)}
        payment={(dialogo?.payment as unknown as PaymentFull) ?? null}
        mode={dialogo?.mode ?? "registrar"}
        onDone={() => query.refetch()}
      />

      <HistoryDialog payment={historico} onClose={() => setHistorico(null)} />
    </>
  );
}

function HistoryDialog({ payment, onClose }: { payment: PaymentRow | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["payment_history", payment?.id],
    queryFn: () => fetchPaymentHistory(payment!.id),
    enabled: !!payment,
  });

  return (
    <Dialog open={!!payment} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico do pagamento</DialogTitle>
          <DialogDescription>
            OS {payment?.work_order?.os_number} · {payment?.work_order?.customer?.full_name}
          </DialogDescription>
        </DialogHeader>
        {(query.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>
        ) : (
          <ul className="space-y-3">
            {(query.data ?? []).map((h) => (
              <li key={h.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="font-medium">
                  {h.event_type} · {dateTimeBR(h.changed_at)}
                </p>
                <p className="text-muted-foreground">
                  Antes: {h.previous_payment_channel} · {h.previous_payment_type} ·{" "}
                  {h.previous_installments}x · {brl(h.previous_gross_amount ?? 0)} · líquido{" "}
                  {brl(h.previous_net_amount ?? 0)}
                </p>
                {h.new_payment_status ? (
                  <p className="text-muted-foreground">
                    Depois: {h.new_payment_channel ?? "—"} · {h.new_payment_type ?? "—"} ·{" "}
                    {h.new_installments ?? "—"}x · {brl(h.new_gross_amount ?? 0)} · líquido{" "}
                    {brl(h.new_net_amount ?? 0)} · {h.new_payment_status}
                  </p>
                ) : null}
                {h.reason ? <p className="mt-1">Motivo: {h.reason}</p> : null}
                {h.notes ? <p className="text-muted-foreground">{h.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface p-3 sm:p-4">
      <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
      <p className="font-titulo mt-1 text-[15px] break-words sm:text-2xl">{value}</p>
    </div>
  );
}
