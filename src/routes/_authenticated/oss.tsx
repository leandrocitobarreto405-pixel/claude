import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, onlyDigits } from "@/lib/format";
import { OS_STATUSES } from "@/lib/data";
import { useSalespeople, useTechnicians } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/oss")({
  head: () => ({
    meta: [
      { title: "OSs criadas — Nexa OS" },
      {
        name: "description",
        content:
          "Lista completa das ordens de serviço criadas, com busca por cliente, número e estofado.",
      },
      { property: "og:title", content: "OSs criadas — Nexa OS" },
      {
        property: "og:description",
        content:
          "Lista completa das ordens de serviço criadas, com busca por cliente, número e estofado.",
      },
    ],
  }),
  component: OssCriadas,
  errorComponent: () => (
    <div className="card-surface p-6 text-center">
      <p className="font-medium">Não foi possível carregar as OSs.</p>
    </div>
  ),
});

type Row = {
  id: string;
  os_number: string;
  sale_date: string;
  status: string;
  total_gross_value: number;
  items_sum: number | null;
  negotiated_payment_method: string | null;
  negotiated_installments: number | null;
  cancelled_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  salesperson_id: string | null;
  customer: { full_name: string; phone: string | null } | null;
  visits: Array<{
    status: string;
    scheduled_date: string;
    technician_id: string | null;
    upholstery_description: string | null;
    service_type: { name: string } | null;
    service_items: Array<{ description: string | null; active: boolean }>;
  }>;
  work_order_documents: Array<{ is_active: boolean; generation_status: string }>;
};

const SELECT = `
  id, os_number, sale_date, status, total_gross_value, items_sum, negotiated_payment_method,
  negotiated_installments, cancelled_at, deleted_at, created_at, updated_at, salesperson_id,
  customer:customer_id ( full_name, phone ),
  visits!visits_work_order_id_fkey ( status, scheduled_date, technician_id, upholstery_description,
    service_type:service_type_id ( name ), service_items ( description, active ) ),
  work_order_documents ( is_active, generation_status )
`;

function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  return (
    <select
      {...rest}
      className={`h-10 w-full rounded-md border border-input bg-background px-3 text-sm ${className ?? ""}`}
    />
  );
}

function OssCriadas() {
  const [busca, setBusca] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [statusOs, setStatusOs] = useState("");
  const [situacao, setSituacao] = useState("ativas");
  const [vendedora, setVendedora] = useState("");
  const [tecnico, setTecnico] = useState("");
  const [documento, setDocumento] = useState("");

  const { data: vendedoras } = useSalespeople(false);
  const { data: tecnicos } = useTechnicians(false);

  const listaQuery = useQuery({
    queryKey: ["oss_criadas", de, ate],
    queryFn: async () => {
      let q = supabase.from("work_orders").select(SELECT).order("created_at", { ascending: false });
      if (de) q = q.gte("sale_date", de);
      if (ate) q = q.lte("sale_date", ate);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = onlyDigits(busca);
    return (listaQuery.data ?? []).filter((r) => {
      if (situacao === "ativas" && (r.deleted_at || r.cancelled_at)) return false;
      if (situacao === "canceladas" && !r.cancelled_at) return false;
      if (situacao === "excluidas" && !r.deleted_at) return false;
      if (statusOs && r.status !== statusOs) return false;
      if (vendedora && r.salesperson_id !== vendedora) return false;
      if (tecnico && !r.visits.some((v) => v.technician_id === tecnico)) return false;
      const temDoc = r.work_order_documents.some(
        (d) => d.is_active && d.generation_status === "Gerado",
      );
      if (documento === "gerado" && !temDoc) return false;
      if (documento === "pendente" && temDoc) return false;
      if (!termo) return true;
      const estofados = r.visits
        .flatMap((v) => [
          v.upholstery_description ?? "",
          ...v.service_items.filter((i) => i.active !== false).map((i) => i.description ?? ""),
        ])
        .join(" ");
      const alvo = `${r.os_number} ${r.customer?.full_name ?? ""} ${estofados}`.toLowerCase();
      const telefone = onlyDigits(r.customer?.phone ?? "");
      return alvo.includes(termo) || (digitos.length >= 4 && telefone.includes(digitos));
    });
  }, [listaQuery.data, busca, situacao, statusOs, vendedora, tecnico, documento]);

  function servicos(r: Row) {
    const nomes = [...new Set(r.visits.map((v) => v.service_type?.name).filter(Boolean))];
    return nomes.join(" + ") || "—";
  }
  function datas(r: Row) {
    const ds = [...new Set(r.visits.map((v) => v.scheduled_date))].sort();
    if (!ds.length) return "—";
    return ds.length === 1 ? dateBR(ds[0]) : `${dateBR(ds[0])} → ${dateBR(ds[ds.length - 1])}`;
  }
  function situacaoOs(r: Row) {
    if (r.deleted_at) return "Excluída";
    if (r.cancelled_at) return "Cancelada";
    return r.status;
  }
  function statusDoc(r: Row) {
    const ativo = r.work_order_documents.find((d) => d.is_active);
    return ativo ? ativo.generation_status : "Não gerado";
  }

  return (
    <>
      <PageHeader
        title="OSs criadas"
        description="Todas as ordens de serviço registradas, independentemente da agenda."
        actions={
          <Button asChild>
            <Link to="/nova-os">
              <ClipboardPlus className="mr-2 size-4" /> Nova OS
            </Link>
          </Button>
        }
      />

      <section className="card-surface mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Label htmlFor="busca">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                id="busca"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Número da OS, cliente, telefone ou estofado"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="de">Venda de</Label>
            <Input id="de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ate">Venda até</Label>
            <Input id="ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="situacao">Situação</Label>
            <NativeSelect
              id="situacao"
              value={situacao}
              onChange={(e) => setSituacao(e.target.value)}
            >
              <option value="ativas">Ativas</option>
              <option value="canceladas">Canceladas</option>
              <option value="excluidas">Excluídas</option>
              <option value="todas">Todas</option>
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="statusOs">Status da OS</Label>
            <NativeSelect
              id="statusOs"
              value={statusOs}
              onChange={(e) => setStatusOs(e.target.value)}
            >
              <option value="">Todos</option>
              {OS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="vendedora">Vendedora</Label>
            <NativeSelect
              id="vendedora"
              value={vendedora}
              onChange={(e) => setVendedora(e.target.value)}
            >
              <option value="">Todas</option>
              {(vendedoras ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="tecnico">Técnico</Label>
            <NativeSelect id="tecnico" value={tecnico} onChange={(e) => setTecnico(e.target.value)}>
              <option value="">Todos</option>
              {(tecnicos ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="documento">Documento</Label>
            <NativeSelect
              id="documento"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="gerado">Gerado</option>
              <option value="pendente">Pendente</option>
            </NativeSelect>
          </div>
        </div>
      </section>

      {listaQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando OSs...</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhuma OS encontrada"
          description="Ajuste a busca ou os filtros para ver outras ordens de serviço."
        />
      ) : (
        <>
          <div className="card-surface hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-secondary text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">OS</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Serviços</th>
                  <th className="px-3 py-2 font-medium">Datas</th>
                  <th className="px-3 py-2 font-medium">Valor combinado</th>
                  <th className="px-3 py-2 font-medium">Forma combinada</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Documento</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link
                        to="/os/$osNumber"
                        params={{ osNumber: r.os_number }}
                        className="font-medium text-primary underline"
                      >
                        {r.os_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {r.customer?.full_name ?? "—"}
                      <span className="block text-xs text-muted-foreground">
                        {r.customer?.phone ?? ""}
                      </span>
                    </td>
                    <td className="px-3 py-2">{servicos(r)}</td>
                    <td className="px-3 py-2">{datas(r)}</td>
                    <td className="px-3 py-2">{brl(Number(r.total_gross_value ?? 0))}</td>
                    <td className="px-3 py-2">
                      {r.negotiated_payment_method ?? "—"}
                      {Number(r.negotiated_installments ?? 1) > 1
                        ? ` ${r.negotiated_installments}x`
                        : ""}
                    </td>
                    <td className="px-3 py-2">{situacaoOs(r)}</td>
                    <td className="px-3 py-2">{statusDoc(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {rows.map((r) => (
              <Link
                key={r.id}
                to="/os/$osNumber"
                params={{ osNumber: r.os_number }}
                className="card-surface block p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">OS {r.os_number}</span>
                  <span className="text-xs text-muted-foreground">{situacaoOs(r)}</span>
                </div>
                <p className="mt-1 text-sm">{r.customer?.full_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{r.customer?.phone ?? ""}</p>
                <p className="mt-2 text-sm">{servicos(r)}</p>
                <p className="text-xs text-muted-foreground">{datas(r)}</p>
                <p className="mt-2 text-sm font-medium">{brl(Number(r.total_gross_value ?? 0))}</p>
                <p className="text-xs text-muted-foreground">Documento: {statusDoc(r)}</p>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{rows.length} OS(s) listada(s).</p>
        </>
      )}
    </>
  );
}
