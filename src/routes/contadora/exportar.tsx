import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileArchive, FileSpreadsheet, FileText } from "lucide-react";
import { CabecalhoDeTela, Card } from "@/components/nexa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportarMesFn } from "@/lib/contadora.functions";
import { baixarBase64, mesAtual, useEmpresasDaContadora } from "@/lib/contadora";

export const Route = createFileRoute("/contadora/exportar")({
  head: () => ({ meta: [{ title: "Exportar mês — Nexa OS" }] }),
  component: ExportarMes,
});

type Tipo = "notas_zip" | "os_xlsx" | "os_csv" | "despesas_csv";
const OPCOES: Array<{ tipo: Tipo; titulo: string; texto: string; icone: typeof FileText }> = [
  {
    tipo: "notas_zip",
    titulo: "Notas emitidas (zip)",
    texto: "PDF e XML das notas emitidas no mês, com a lista.",
    icone: FileArchive,
  },
  {
    tipo: "os_xlsx",
    titulo: "OS do mês (Excel)",
    texto: "OS realizadas com cliente, CPF/CNPJ, serviços, valores, pagamento e repasse.",
    icone: FileSpreadsheet,
  },
  { tipo: "os_csv", titulo: "OS do mês (CSV)", texto: "A mesma lista em CSV.", icone: FileText },
  {
    tipo: "despesas_csv",
    titulo: "Despesas (CSV)",
    texto: "Despesas do mês com o link do comprovante (vale 7 dias).",
    icone: FileText,
  },
];

function ExportarMes() {
  const { data: ctx } = useEmpresasDaContadora();
  const empresaId = ctx?.ativa?.empresa_id ?? "";
  const [mes, setMes] = useState(mesAtual());
  const [gerando, setGerando] = useState<Tipo | null>(null);
  const exportar = useServerFn(exportarMesFn);

  async function baixar(tipo: Tipo) {
    setGerando(tipo);
    try {
      const a = await exportar({ data: { empresaId, mes, tipo } });
      baixarBase64(a);
      toast.success(
        `${a.nome} baixado (${a.quantidade} ${tipo === "notas_zip" ? "arquivo(s)" : "linha(s)"}).`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível exportar.");
    } finally {
      setGerando(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela titulo="Exportar mês" descricao="Arquivos do mês para a contabilidade." />
      <div className="space-y-1">
        <Label htmlFor="mes-exp">Mês</Label>
        <Input
          id="mes-exp"
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="w-[170px]"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPCOES.map((o) => {
          const Icone = o.icone;
          return (
            <Card key={o.tipo}>
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-marca-claro text-marca">
                  <Icone className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{o.titulo}</h2>
                  <p className="text-sm text-muted-foreground">{o.texto}</p>
                </div>
              </div>
              <Button onClick={() => baixar(o.tipo)} disabled={gerando !== null || !empresaId}>
                {gerando === o.tipo ? "Gerando…" : "Baixar"}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
