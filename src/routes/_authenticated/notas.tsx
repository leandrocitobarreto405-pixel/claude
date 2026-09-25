import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { copiar, StatusBadge } from "@/components/visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { INVOICE_STATUSES } from "@/lib/data";
import { brl, dateBR, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/notas")({
  head: () => ({
    meta: [
      { title: "Notas fiscais a emitir — Gestão Estofados" },
      {
        name: "description",
        content: "Controle das notas fiscais pendentes e emitidas por ordem de serviço.",
      },
      { property: "og:title", content: "Notas fiscais a emitir — Gestão Estofados" },
      {
        property: "og:description",
        content: "Controle das notas fiscais pendentes e emitidas por ordem de serviço.",
      },
    ],
  }),
  component: Notas,
});

type Task = {
  id: string;
  status: string;
  invoice_amount: number;
  invoice_number: string | null;
  issue_date: string | null;
  service_date: string | null;
  document_number: string | null;
  notes: string | null;
  work_order: {
    os_number: string;
    customer: { full_name: string; document_number: string | null } | null;
  } | null;
};

function Notas() {
  const [status, setStatus] = useState("Pendente");
  const [editando, setEditando] = useState<Task | null>(null);
  const [numero, setNumero] = useState("");
  const [dataEmissao, setDataEmissao] = useState(todayISO());

  const query = useQuery({
    queryKey: ["notas", status],
    queryFn: async () => {
      let q = supabase
        .from("invoice_tasks")
        .select(
          `id, status, invoice_amount, invoice_number, issue_date, service_date, document_number, notes,
           work_order:work_order_id ( os_number, customer:customer_id ( full_name, document_number ) )`,
        )
        .order("service_date", { ascending: false });
      if (status !== "todos") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Task[];
    },
  });

  const lista = query.data ?? [];
  const total = lista.reduce((s, t) => s + Number(t.invoice_amount ?? 0), 0);

  async function emitir() {
    if (!editando) return;
    if (!numero.trim()) {
      toast.error("Informe o número da nota fiscal.");
      return;
    }
    const { error } = await supabase
      .from("invoice_tasks")
      .update({ status: "Emitida", invoice_number: numero.trim(), issue_date: dataEmissao })
      .eq("id", editando.id);
    if (error) {
      toast.error("Não foi possível registrar a nota fiscal.");
      return;
    }
    toast.success("Nota fiscal registrada como emitida.");
    setEditando(null);
    query.refetch();
  }

  return (
    <>
      <PageHeader
        title="Notas fiscais"
        description={`${lista.length} nota(s) · ${brl(total)} em serviços`}
      />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {lista.length === 0 ? (
        <EmptyState title="Nenhuma nota neste filtro" description="Tudo em ordem por aqui." />
      ) : (
        <div className="space-y-3">
          {lista.map((t) => (
            <section
              key={t.id}
              className="card-surface flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <p className="font-medium">
                  OS {t.work_order?.os_number} · {t.work_order?.customer?.full_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  Serviço em {dateBR(t.service_date)} · {brl(t.invoice_amount)} · CPF/CNPJ:{" "}
                  {t.document_number || t.work_order?.customer?.document_number || "não informado"}
                </p>
                {t.invoice_number ? (
                  <p className="text-sm text-muted-foreground">
                    Nota {t.invoice_number} emitida em {dateBR(t.issue_date)}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={t.status} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copiar(
                      `${t.work_order?.customer?.full_name} — CPF/CNPJ ${
                        t.document_number ||
                        t.work_order?.customer?.document_number ||
                        "não informado"
                      } — ${brl(t.invoice_amount)} — serviço em ${dateBR(t.service_date)}`,
                      "Dados da nota copiados!",
                    )
                  }
                >
                  Copiar dados
                </Button>
                {t.status !== "Emitida" ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditando(t);
                      setNumero(t.invoice_number ?? "");
                      setDataEmissao(todayISO());
                    }}
                  >
                    Registrar emissão
                  </Button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!editando} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar nota fiscal</DialogTitle>
            <DialogDescription>Informe o número e a data de emissão da nota.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="numero-nf">Número da nota</Label>
              <Input id="numero-nf" value={numero} onChange={(e) => setNumero(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="data-nf">Data de emissão</Label>
              <Input
                id="data-nf"
                type="date"
                value={dataEmissao}
                onChange={(e) => setDataEmissao(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={emitir}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
