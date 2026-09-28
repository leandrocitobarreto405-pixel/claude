import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/app-shell";
import {
  AcoesNota,
  NOTAS_QUERY_KEY,
  SituacaoNota,
  copiarTexto,
  useModeloNota,
} from "@/components/nota-fiscal";
import { supabase } from "@/integrations/supabase/client";
import { INVOICE_STATUSES } from "@/lib/data";
import { brl, dateBR } from "@/lib/format";
import {
  TAREFA_NOTA_SELECT,
  dadosDaNota,
  montarMensagemNota,
  type TarefaNota,
} from "@/lib/nota-fiscal";

export const Route = createFileRoute("/_authenticated/notas")({
  head: () => ({
    meta: [
      { title: "Notas fiscais a emitir — Nexa OS" },
      {
        name: "description",
        content:
          "Mensagem pronta para pedir a emissão, situação e arquivo das notas fiscais por OS.",
      },
    ],
  }),
  component: Notas,
});

function Notas() {
  const qc = useQueryClient();
  const modelo = useModeloNota();
  const [status, setStatus] = useState("Pendente");

  const query = useQuery({
    queryKey: [NOTAS_QUERY_KEY, "lista", status],
    queryFn: async () => {
      let q = supabase
        .from("invoice_tasks")
        .select(TAREFA_NOTA_SELECT)
        .order("service_date", { ascending: false });
      if (status !== "todos") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as TarefaNota[];
    },
  });

  const lista = query.data ?? [];
  const total = lista.reduce((s, t) => s + Number(t.invoice_amount ?? 0), 0);
  const atualizar = () => void qc.invalidateQueries({ queryKey: [NOTAS_QUERY_KEY] });

  return (
    <>
      <PageHeader
        title="Notas fiscais"
        description={`${lista.length} nota(s) · ${brl(total)} em serviços. Copie a mensagem e cole no grupo que emite as notas.`}
      />

      <div className="card-surface mb-6 flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="space-y-1">
          <Label>Situação</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {lista.length > 1 ? (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() =>
              void copiarTexto(
                lista.map((t) => montarMensagemNota(modelo, dadosDaNota(t))).join("\n\n———\n\n"),
                `${lista.length} mensagens copiadas.`,
              )
            }
          >
            <Copy className="size-4" /> Copiar todas ({lista.length})
          </Button>
        ) : null}
      </div>

      {lista.length === 0 ? (
        <EmptyState title="Nenhuma nota neste filtro" description="Tudo em ordem por aqui." />
      ) : (
        <div className="space-y-3">
          {lista.map((t) => (
            <section key={t.id} className="card-surface grid gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {t.work_order ? (
                      <Link
                        to="/os/$osNumber"
                        params={{ osNumber: t.work_order.os_number }}
                        className="hover:underline"
                      >
                        OS {t.work_order.os_number}
                      </Link>
                    ) : (
                      "OS —"
                    )}{" "}
                    · {t.work_order?.customer?.full_name ?? "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Serviço em {dateBR(t.service_date)} · {brl(t.invoice_amount)}
                    {t.invoice_number
                      ? ` · nota ${t.invoice_number} emitida em ${dateBR(t.issue_date)}`
                      : ""}
                  </p>
                </div>
                <SituacaoNota status={t.status} />
              </div>
              <AcoesNota tarefa={t} onChange={atualizar} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
