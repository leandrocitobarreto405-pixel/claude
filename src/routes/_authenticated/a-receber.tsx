import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { AbasDeRota, Botao } from "@/components/nexa";
import { ABAS_DE_TELA, abasPermitidas } from "@/lib/menu";
import { useContextoTenant } from "@/lib/tenant";

import { PaymentDialog } from "@/components/payment-dialog";
import { DiscountDialog } from "@/components/discount-dialog";
import { useReceivables, type ReceivableItem } from "@/lib/receivables";
import { brl, dateBR } from "@/lib/format";

const ABAS = [
  { key: "concluido", label: "Concluídos e não pagos" },
  { key: "agendado", label: "Agendados e não pagos" },
] as const;

type AbaKey = (typeof ABAS)[number]["key"];

export const Route = createFileRoute("/_authenticated/a-receber")({
  validateSearch: (search: Record<string, unknown>) => ({
    aba: search["aba"] === "agendado" ? ("agendado" as const) : ("concluido" as const),
  }),
  head: () => ({
    meta: [
      { title: "Recebimentos: a receber — Nexa OS" },
      {
        name: "description",
        content: "Serviços agendados e concluídos que ainda não foram pagos, com saldo por OS.",
      },
      { property: "og:title", content: "Recebimentos: a receber — Nexa OS" },
      {
        property: "og:description",
        content: "Serviços agendados e concluídos que ainda não foram pagos, com saldo por OS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AReceber,
});

function AReceber() {
  const { aba: abaInicial } = Route.useSearch();
  const [aba, setAba] = useState<AbaKey>(abaInicial);
  const [busca, setBusca] = useState("");
  const [pagamento, setPagamento] = useState<ReceivableItem | null>(null);
  const [desconto, setDesconto] = useState<ReceivableItem | null>(null);
  const { data, isLoading, refetch } = useReceivables();
  const { data: tenant } = useContextoTenant();
  const papel = tenant?.ativa?.papel ?? null;
  const souNexa = tenant?.souNexa === true;

  const items = useMemo<ReceivableItem[]>(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        i.kind === aba &&
        (!termo ||
          i.customer.toLowerCase().includes(termo) ||
          i.osNumber.toLowerCase().includes(termo)),
    );
  }, [data, aba, busca]);

  const totalAba = items.reduce((s, i) => s + i.balance, 0);

  return (
    <>
      <PageHeader
        title="Financeiro"
        description={
          data
            ? `Total ${brl(data.total)} · concluídos ${brl(data.completed)} · agendados ${brl(data.scheduled)}`
            : "Carregando..."
        }
      />
      <AbasDeRota
        abas={abasPermitidas(ABAS_DE_TELA.financeiro, papel, souNexa)}
        rotulo="Financeiro"
        className="mb-6"
      />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {ABAS.map((a) => (
            <Button
              key={a.key}
              size="sm"
              variant={aba === a.key ? "default" : "outline"}
              onClick={() => setAba(a.key)}
            >
              {a.label}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="busca">Buscar cliente ou OS</Label>
          <Input
            id="busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-[220px]"
          />
        </div>
      </div>

      {isLoading ? (
        <EmptyState title="Carregando" description="Buscando os serviços em aberto." />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nada a receber aqui"
          description="Nenhum serviço nesta situação com saldo em aberto."
        />
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="A receber">
          {items.map((i) => (
            <li
              key={i.visitId}
              className="flex flex-col gap-2 rounded-card border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  to="/os/$osNumber"
                  params={{ osNumber: i.osNumber }}
                  className="flex min-h-11 min-w-0 flex-col gap-0.5"
                  aria-label={`Abrir OS ${i.osNumber}`}
                >
                  <span className="text-xs font-bold text-muted-foreground">
                    {dateBR(
                      aba === "concluido" ? (i.completionDate ?? i.scheduledDate) : i.scheduledDate,
                    )}
                    {" · "}
                    <span className="underline">OS {i.osNumber}</span>
                  </span>
                  <span className="truncate text-[15px] font-bold">{i.customer}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {[i.serviceLabel || null, i.technician].filter(Boolean).join(" · ")}
                  </span>
                </Link>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="font-titulo text-[17px]">{brl(i.balance)}</span>
                  <span className="text-xs text-muted-foreground">
                    de {brl(i.value)}
                    {i.paid > 0 ? ` · pago ${brl(i.paid)}` : ""}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Botao variante="neutro" onClick={() => setDesconto(i)}>
                  Dispensar saldo
                </Botao>
                <Botao onClick={() => setPagamento(i)}>Registrar recebimento</Botao>
              </div>
            </li>
          ))}
          <li className="flex items-center justify-between px-1 text-sm font-bold">
            <span>Total</span>
            <span>{brl(totalAba)}</span>
          </li>
        </ul>
      )}

      <PaymentDialog
        open={pagamento !== null}
        onOpenChange={(v) => !v && setPagamento(null)}
        payment={null}
        mode="criar"
        workOrderId={pagamento?.workOrderId ?? null}
        visitOptions={
          pagamento
            ? [{ id: pagamento.visitId, label: pagamento.serviceLabel || "Atendimento" }]
            : []
        }
        suggestedAmount={pagamento?.balance ?? 0}
        osLabel={pagamento ? `OS ${pagamento.osNumber} · ${pagamento.customer}` : ""}
        onDone={() => void refetch()}
      />

      <DiscountDialog
        open={desconto !== null}
        onOpenChange={(v) => !v && setDesconto(null)}
        visitId={desconto?.visitId ?? null}
        workOrderId={desconto?.workOrderId ?? null}
        balance={desconto?.balance ?? 0}
        label={desconto ? `OS ${desconto.osNumber} · ${desconto.customer}` : undefined}
        onDone={() => void refetch()}
      />
    </>
  );
}
