import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/app-shell";
import { useMonthSummary } from "@/lib/reports";
import { brl, currentMonth, dateBR, monthLabelPT, monthSlug } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/exportacoes")({
  head: () => ({
    meta: [
      { title: "Exportações — Gestão Estofados" },
      { name: "description", content: "Baixe planilhas de serviços, pagamentos, despesas e DRE do mês." },
      { property: "og:title", content: "Exportações — Gestão Estofados" },
      { property: "og:description", content: "Baixe planilhas de serviços, pagamentos, despesas e DRE do mês." },
    ],
  }),
  component: Exportacoes,
});

function Exportacoes() {
  const [mes, setMes] = useState(currentMonth());
  const { data: r } = useMonthSummary(mes);

  function baixar(nome: string, rows: Record<string, unknown>[], planilha: string) {
    if (!rows.length) {
      toast.error("Não há dados para exportar neste mês.");
      return;
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), planilha);
    XLSX.writeFile(wb, `${nome}-${monthSlug(mes)}.xlsx`);
    toast.success("Planilha gerada com sucesso.");
  }

  const servicos = (r?.completed ?? []).map((v) => ({
    "Data de conclusão": dateBR(v.completion_date),
    OS: v.work_order?.os_number ?? "",
    Cliente: v.work_order?.customer?.full_name ?? "",
    "CPF/CNPJ": v.work_order?.customer?.document_number ?? "",
    Serviço: v.service_type?.name ?? "",
    Estofado: v.upholstery_description || v.upholstery_type?.name || "",
    Técnico: v.technician?.name ?? "",
    Vendedora: v.work_order?.salesperson?.name ?? "",
    Origem: v.work_order?.sales_origin?.name ?? "",
    "Valor (R$)": Number(v.final_value ?? v.visit_value ?? 0),
    "Custo de deslocamento (R$)": Number(v.mileage_cost_allocated ?? 0),
  }));

  const pagamentos = (r?.payments ?? []).map((p) => ({
    "Data do pagamento": dateBR(p.payment_date),
    OS: p.work_order?.os_number ?? "",
    Cliente: p.work_order?.customer?.full_name ?? "",
    Canal: p.payment_channel,
    Forma: p.payment_type,
    Parcelas: p.installments,
    "Valor bruto (R$)": Number(p.gross_amount),
    "Taxa (%)": Number(p.applied_rate),
    "Taxa (R$)": Number(p.payment_fee_amount),
    "Valor líquido (R$)": Number(p.net_amount),
    Status: p.payment_status,
  }));

  const despesas = (r?.expenses ?? []).map((e) => ({
    Descrição: e.description,
    Categoria: e.category,
    Competência: dateBR(e.competence_date),
    Vencimento: dateBR(e.due_date),
    "Valor previsto (R$)": Number(e.expected_amount),
    "Valor pago (R$)": Number(e.actual_amount ?? 0),
    "Data do pagamento": dateBR(e.payment_date),
    Status: e.status,
  }));

  const dre = [
    { Linha: "Vendas fechadas no mês", "Valor (R$)": r?.soldGross ?? 0 },
    { Linha: "Receita de serviços realizados", "Valor (R$)": r?.revenue ?? 0 },
    { Linha: "Taxas de pagamento", "Valor (R$)": -(r?.fees ?? 0) },
    { Linha: "Comissões de vendas", "Valor (R$)": -(r?.commissions ?? 0) },
    { Linha: "Custo de deslocamento", "Valor (R$)": -(r?.mileage ?? 0) },
    { Linha: "Custos e despesas fixas", "Valor (R$)": -(r?.fixedCosts ?? 0) },
    { Linha: "Lucro líquido do mês", "Valor (R$)": r?.netProfit ?? 0 },
  ];

  return (
    <>
      <PageHeader
        title="Exportações"
        description={`Planilhas de ${monthLabelPT(mes)} em formato Excel (.xlsx)`}
      />

      <div className="card-surface mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="mes">Mês</Label>
          <Input id="mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-[170px]" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Bloco
          titulo="Serviços realizados"
          descricao={`${servicos.length} registro(s) · ${brl(r?.revenue)}`}
          onClick={() => baixar("servicos", servicos, "Serviços")}
        />
        <Bloco
          titulo="Pagamentos recebidos"
          descricao={`${pagamentos.length} registro(s) · ${brl(r?.received)}`}
          onClick={() => baixar("pagamentos", pagamentos, "Pagamentos")}
        />
        <Bloco
          titulo="Custos e despesas"
          descricao={`${despesas.length} registro(s) · ${brl(r?.fixedCosts)}`}
          onClick={() => baixar("despesas", despesas, "Despesas")}
        />
        <Bloco
          titulo="DRE gerencial"
          descricao={`Lucro líquido de ${brl(r?.netProfit)}`}
          onClick={() => baixar("dre", dre, "DRE")}
        />
      </div>
    </>
  );
}

function Bloco({
  titulo,
  descricao,
  onClick,
}: {
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <section className="card-surface flex flex-wrap items-center justify-between gap-3 p-5">
      <div>
        <p className="font-medium">{titulo}</p>
        <p className="text-sm text-muted-foreground">{descricao}</p>
      </div>
      <Button onClick={onClick}>Baixar planilha</Button>
    </section>
  );
}
