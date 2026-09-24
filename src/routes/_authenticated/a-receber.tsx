import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader } from "@/components/app-shell";
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
      { title: "A receber — Turbine Clean" },
      {
        name: "description",
        content: "Serviços agendados e concluídos que ainda não foram pagos, com saldo por OS.",
      },
      { property: "og:title", content: "A receber — Turbine Clean" },
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
        title="A receber"
        description={
          data
            ? `Total ${brl(data.total)} · concluídos ${brl(data.completed)} · agendados ${brl(data.scheduled)}`
            : "Carregando..."
        }
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
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <Th>{aba === "concluido" ? "Conclusão" : "Agendado para"}</Th>
                <Th>OS</Th>
                <Th>Cliente</Th>
                <Th>Serviço</Th>
                <Th>Técnico</Th>
                <Th>Valor</Th>
                <Th>Pago</Th>
                <Th>Saldo</Th>
                <Th>Ação</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.visitId} className="border-t border-border hover:bg-accent">
                  <Td>{dateBR(aba === "concluido" ? (i.completionDate ?? i.scheduledDate) : i.scheduledDate)}</Td>
                  <Td>
                    <Link
                      to="/os/$osNumber"
                      params={{ osNumber: i.osNumber }}
                      className="text-primary underline"
                    >
                      {i.osNumber}
                    </Link>
                  </Td>
                  <Td>{i.customer}</Td>
                  <Td>{i.serviceLabel || "—"}</Td>
                  <Td>{i.technician ?? "—"}</Td>
                  <Td>{brl(i.value)}</Td>
                  <Td>{brl(i.paid)}</Td>
                  <Td className="font-semibold">{brl(i.balance)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setPagamento(i)}>
                        Registrar pagamento
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDesconto(i)}>
                        Dispensar saldo
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
              <tr className="border-t border-border bg-secondary/60 font-semibold">
                <Td>Total</Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td>{brl(totalAba)}</Td>
                <Td>—</Td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <PaymentDialog
        open={pagamento !== null}
        onOpenChange={(v) => !v && setPagamento(null)}
        payment={null}
        mode="criar"
        workOrderId={pagamento?.workOrderId ?? null}
        visitOptions={
          pagamento ? [{ id: pagamento.visitId, label: pagamento.serviceLabel || "Atendimento" }] : []
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className ?? ""}`}>{children}</td>;
}
