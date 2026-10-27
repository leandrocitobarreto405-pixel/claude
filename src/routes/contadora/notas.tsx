import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, FileCode2, ExternalLink } from "lucide-react";
import { CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { brl, dateBR } from "@/lib/format";
import { ROTULO_STATUS, type AcaoNota } from "@/lib/contabil";
import {
  anexarArquivoNotaFn,
  linkArquivoContabilFn,
  marcarNotaFn,
  notasContabilFn,
  type NotaContabil,
} from "@/lib/contadora.functions";
import { mesAtual, useEmpresasDaContadora } from "@/lib/contadora";

export const Route = createFileRoute("/contadora/notas")({
  head: () => ({ meta: [{ title: "Notas fiscais — Nexa OS" }] }),
  component: NotasContadora,
});

const TOM: Record<string, "atencao" | "sucesso" | "problema" | "neutro"> = {
  Pendente: "atencao",
  Solicitada: "atencao",
  Emitida: "sucesso",
  Cancelada: "problema",
  "Não emitir": "neutro",
};

function NotasContadora() {
  const { data: ctx } = useEmpresasDaContadora();
  const empresaId = ctx?.ativa?.empresa_id ?? "";
  const [filtro, setFiltro] = useState<"para_emitir" | "todas">("para_emitir");
  const [mes, setMes] = useState(mesAtual());
  const listar = useServerFn(notasContabilFn);
  const { data: notas, isLoading } = useQuery({
    queryKey: ["contadora", "notas", empresaId, filtro, filtro === "todas" ? mes : null],
    enabled: Boolean(empresaId),
    queryFn: () => listar({ data: { empresaId, filtro, ...(filtro === "todas" ? { mes } : {}) } }),
  });
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Notas fiscais"
        descricao="Para emitir: as mais antigas primeiro. Anexe o PDF e o XML e marque como emitida."
      />
      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={filtro} onValueChange={(v) => setFiltro(v as never)}>
          <TabsList>
            <TabsTrigger value="para_emitir">Para emitir</TabsTrigger>
            <TabsTrigger value="todas">Todas do mês</TabsTrigger>
          </TabsList>
        </Tabs>
        {filtro === "todas" ? (
          <div className="space-y-1">
            <Label htmlFor="mes-notas">Mês</Label>
            <Input
              id="mes-notas"
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="w-[170px]"
            />
          </div>
        ) : null}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !notas?.length ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {filtro === "para_emitir"
              ? "Nenhuma nota esperando emissão."
              : "Nenhuma nota neste mês."}
          </p>
        </Card>
      ) : (
        notas.map((n) => <CartaoNota key={n.id} nota={n} empresaId={empresaId} />)
      )}
    </div>
  );
}

function CartaoNota({ nota, empresaId }: { nota: NotaContabil; empresaId: string }) {
  const qc = useQueryClient();
  const anexar = useServerFn(anexarArquivoNotaFn);
  const marcar = useServerFn(marcarNotaFn);
  const link = useServerFn(linkArquivoContabilFn);
  const [acao, setAcao] = useState<AcaoNota | null>(null);
  const [numero, setNumero] = useState(nota.numero ?? "");
  const [data, setData] = useState(nota.data_emissao ?? new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const pdf = useRef<HTMLInputElement>(null);
  const xml = useRef<HTMLInputElement>(null);
  const aberta = nota.status === "Pendente" || nota.status === "Solicitada";

  const recarregar = () => qc.invalidateQueries({ queryKey: ["contadora", "notas"] });

  async function enviarArquivo(tipo: "pdf" | "xml", arquivo: File | undefined) {
    if (!arquivo) return;
    const f = new FormData();
    f.set("empresaId", empresaId);
    f.set("notaId", nota.id);
    f.set("tipo", tipo);
    f.set("arquivo", arquivo);
    setOcupado(true);
    try {
      await anexar({ data: f });
      toast.success(tipo === "xml" ? "XML anexado." : "PDF anexado.");
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível anexar.");
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    if (!acao) return;
    setOcupado(true);
    try {
      const r = await marcar({ data: { empresaId, notaId: nota.id, acao, numero, data, motivo } });
      toast.success(
        acao === "emitida"
          ? r.drive === "copiada"
            ? "Nota emitida e copiada para o Drive. A empresa foi avisada."
            : r.drive === "pendente"
              ? "Nota emitida. A cópia para o Drive falhou e será refeita sozinha."
              : "Nota emitida. A empresa foi avisada."
          : acao === "cancelada"
            ? "Nota marcada como cancelada."
            : "Nota marcada como não necessária.",
      );
      setAcao(null);
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  async function abrir(caminho: string) {
    try {
      window.open(await link({ data: { empresaId, caminho } }), "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir.");
    }
  }

  return (
    <Card as="article" aria-label={`Nota da OS ${nota.os}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            OS {nota.os} · {nota.cliente ?? "Cliente sem nome"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {nota.documento ? `CPF/CNPJ ${nota.documento}` : "CPF/CNPJ não informado"}
            {nota.email ? ` · ${nota.email}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tom={TOM[nota.status] ?? "neutro"}>
            {ROTULO_STATUS[nota.status] ?? nota.status}
          </Chip>
          {nota.drive === "pendente" || nota.drive === "erro" ? (
            <Chip tom="atencao">Drive pendente</Chip>
          ) : null}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Valor</dt>
          <dd className="font-semibold">{nota.valor !== null ? brl(Number(nota.valor)) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Serviço em</dt>
          <dd>{nota.data_servico ? dateBR(nota.data_servico) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Nº da nota</dt>
          <dd>{nota.numero ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Emissão</dt>
          <dd>{nota.data_emissao ? dateBR(nota.data_emissao) : "—"}</dd>
        </div>
        {nota.endereco ? (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-muted-foreground">Endereço</dt>
            <dd>{nota.endereco}</dd>
          </div>
        ) : null}
        {nota.motivo_cancelamento ? (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-muted-foreground">Motivo do cancelamento</dt>
            <dd>{nota.motivo_cancelamento}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {nota.arquivo_path ? (
          <Button variant="outline" size="sm" onClick={() => abrir(nota.arquivo_path!)}>
            <FileText className="size-4" /> Ver PDF
          </Button>
        ) : null}
        {nota.xml_path ? (
          <Button variant="outline" size="sm" onClick={() => abrir(nota.xml_path!)}>
            <FileCode2 className="size-4" /> Ver XML
          </Button>
        ) : null}
        {nota.drive_url && nota.drive === "copiada" ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={nota.drive_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" /> No Drive
            </a>
          </Button>
        ) : null}
        <input
          ref={pdf}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="hidden"
          onChange={(e) => enviarArquivo("pdf", e.target.files?.[0])}
        />
        <input
          ref={xml}
          type="file"
          accept=".xml,application/xml,text/xml"
          className="hidden"
          onChange={(e) => enviarArquivo("xml", e.target.files?.[0])}
        />
        <Button variant="outline" size="sm" disabled={ocupado} onClick={() => pdf.current?.click()}>
          {nota.arquivo_path ? "Trocar PDF" : "Anexar PDF"}
        </Button>
        <Button variant="outline" size="sm" disabled={ocupado} onClick={() => xml.current?.click()}>
          {nota.xml_path ? "Trocar XML" : "Anexar XML"}
        </Button>
      </div>
      {aberta && !acao ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" onClick={() => setAcao("emitida")}>
            Marcar emitida
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAcao("cancelada")}>
            Cancelada
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAcao("nao_necessaria")}>
            Não necessária
          </Button>
        </div>
      ) : null}
      {acao ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3">
          {acao === "emitida" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`num-${nota.id}`}>Número da nota</Label>
                <Input
                  id={`num-${nota.id}`}
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`data-${nota.id}`}>Data de emissão</Label>
                <Input
                  id={`data-${nota.id}`}
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor={`mot-${nota.id}`}>
                {acao === "cancelada" ? "Motivo do cancelamento" : "Motivo (opcional)"}
              </Label>
              <Input
                id={`mot-${nota.id}`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={ocupado} onClick={confirmar}>
              {ocupado ? "Salvando…" : "Confirmar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAcao(null)}>
              Voltar
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
