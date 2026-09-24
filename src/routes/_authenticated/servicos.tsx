import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { StatusBadge, VisitDialog } from "@/components/visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { VISIT_SELECT, type VisitRow } from "@/lib/os";
import { useSalespeople, useTechnicians } from "@/lib/data";
import { brl, currentMonth, dateBR, monthEnd, monthLabelPT, monthStart, timeBR } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/servicos")({
  head: () => ({
    meta: [
      { title: "Serviços realizados — Gestão Estofados" },
      { name: "description", content: "Histórico de serviços concluídos com valores, técnicos e vendedoras." },
      { property: "og:title", content: "Serviços realizados — Gestão Estofados" },
      { property: "og:description", content: "Histórico de serviços concluídos com valores, técnicos e vendedoras." },
    ],
  }),
  component: Servicos,
});

function Servicos() {
  const [mes, setMes] = useState(currentMonth());
  const [tecnico, setTecnico] = useState("todos");
  const [vendedora, setVendedora] = useState("todos");
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<VisitRow | null>(null);
  const { data: tecnicos } = useTechnicians(false);
  const { data: vendedoras } = useSalespeople(false);

  const query = useQuery({
    queryKey: ["servicos", mes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("status", "Concluído")
        .gte("completion_date", monthStart(mes))
        .lte("completion_date", monthEnd(mes))
        .order("completion_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (query.data ?? []).filter(
      (v) =>
        (tecnico === "todos" || v.technician?.id === tecnico) &&
        (vendedora === "todos" || v.work_order?.salesperson?.id === vendedora) &&
        (!termo ||
          v.work_order?.customer?.full_name.toLowerCase().includes(termo) ||
          v.work_order?.os_number.toLowerCase().includes(termo)),
    );
  }, [query.data, tecnico, vendedora, busca]);

  const total = lista.reduce((s, v) => s + Number(v.final_value ?? v.visit_value ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Serviços realizados"
        description={`${monthLabelPT(mes)} · ${lista.length} serviço(s) · ${brl(total)}`}
      />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="mes">Mês</Label>
          <Input id="mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-[170px]" />
        </div>
        <div className="space-y-1">
          <Label>Técnico</Label>
          <Select value={tecnico} onValueChange={setTecnico}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(tecnicos ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Vendedora</Label>
          <Select value={vendedora} onValueChange={setVendedora}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              {(vendedoras ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="busca">Buscar cliente ou OS</Label>
          <Input id="busca" value={busca} onChange={(e) => setBusca(e.target.value)} className="w-[220px]" />
        </div>
      </div>

      {lista.length === 0 ? (
        <EmptyState title="Nenhum serviço concluído" description="Ajuste o mês ou os filtros." />
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <Th>Conclusão</Th>
                <Th>OS</Th>
                <Th>Cliente</Th>
                <Th>Serviço</Th>
                <Th>Técnico</Th>
                <Th>Vendedora</Th>
                <Th>Valor</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {lista.map((v) => (
                <tr
                  key={v.id}
                  className="cursor-pointer border-t border-border hover:bg-accent"
                  onClick={() => setSelecionada(v)}
                >
                  <Td>
                    {dateBR(v.completion_date)} {timeBR(v.completion_time)}
                  </Td>
                  <Td>
                    <Link to="/os/$osNumber" params={{ osNumber: v.work_order?.os_number ?? "" }} className="text-primary underline">
                      {v.work_order?.os_number}
                    </Link>
                  </Td>
                  <Td>{v.work_order?.customer?.full_name}</Td>
                  <Td>
                    {v.service_type?.name} — {v.upholstery_description || v.upholstery_type?.name}
                  </Td>
                  <Td>{v.technician?.name ?? "—"}</Td>
                  <Td>{v.work_order?.salesperson?.name ?? "—"}</Td>
                  <Td>{brl(v.final_value ?? v.visit_value)}</Td>
                  <Td>
                    <StatusBadge status={v.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <VisitDialog
        visit={selecionada}
        open={!!selecionada}
        onOpenChange={(v) => !v && setSelecionada(null)}
        onChanged={() => query.refetch()}
      />
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
}
