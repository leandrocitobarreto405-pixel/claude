import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Paperclip, ExternalLink } from "lucide-react";
import { CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { brl, dateBR } from "@/lib/format";
import {
  anexarComprovanteFn,
  despesasContabilFn,
  linkArquivoContabilFn,
  type DespesaContabil,
} from "@/lib/contadora.functions";
import { mesAtual, useEmpresasDaContadora } from "@/lib/contadora";

export const Route = createFileRoute("/contadora/despesas")({
  head: () => ({ meta: [{ title: "Despesas — Nexa OS" }] }),
  component: DespesasContadora,
});

function DespesasContadora() {
  const { data: ctx } = useEmpresasDaContadora();
  const empresaId = ctx?.ativa?.empresa_id ?? "";
  const [mes, setMes] = useState(mesAtual());
  const [semNota, setSemNota] = useState(false);
  const listar = useServerFn(despesasContabilFn);
  const { data, isLoading } = useQuery({
    queryKey: ["contadora", "despesas", empresaId, mes],
    enabled: Boolean(empresaId),
    queryFn: () => listar({ data: { empresaId, mes } }),
  });
  const lista = (data ?? []).filter((d) => !semNota || !d.comprovante_path);
  const semComprovante = (data ?? []).filter((d) => !d.comprovante_path).length;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Despesas"
        descricao="Anexe a nota ou o comprovante de cada despesa (PDF, imagem ou XML)."
      />
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="mes-desp">Mês</Label>
          <Input
            id="mes-desp"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="w-[170px]"
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch checked={semNota} onCheckedChange={setSemNota} />
          Só sem nota anexada ({semComprovante})
        </label>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !lista.length ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhuma despesa neste filtro.</p>
        </Card>
      ) : (
        <Card espaco="nenhum">
          <ul className="divide-y divide-border">
            {lista.map((d) => (
              <LinhaDespesa key={d.id} d={d} empresaId={empresaId} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function LinhaDespesa({ d, empresaId }: { d: DespesaContabil; empresaId: string }) {
  const qc = useQueryClient();
  const anexar = useServerFn(anexarComprovanteFn);
  const link = useServerFn(linkArquivoContabilFn);
  const entrada = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return;
    const f = new FormData();
    f.set("empresaId", empresaId);
    f.set("despesaId", d.id);
    f.set("arquivo", arquivo);
    setOcupado(true);
    try {
      const r = await anexar({ data: f });
      toast.success(
        r.drive === "copiada"
          ? "Comprovante anexado e copiado para o Drive."
          : r.drive === "pendente"
            ? "Comprovante anexado. A cópia para o Drive será refeita sozinha."
            : "Comprovante anexado.",
      );
      await qc.invalidateQueries({ queryKey: ["contadora", "despesas"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível anexar.");
    } finally {
      setOcupado(false);
    }
  }

  async function abrir() {
    try {
      window.open(
        await link({ data: { empresaId, caminho: d.comprovante_path! } }),
        "_blank",
        "noopener",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir.");
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
      <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
        <p className="font-medium">{d.descricao ?? "Despesa"}</p>
        <p className="text-sm text-muted-foreground">
          {[d.fornecedor, d.categoria, d.data ? dateBR(d.data) : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      <span className="font-semibold tabular-nums">
        {d.valor !== null ? brl(Number(d.valor)) : "—"}
      </span>
      <Chip tom={d.status === "Pago" ? "sucesso" : "atencao"}>{d.status ?? "—"}</Chip>
      {d.comprovante_path ? (
        <>
          <Button variant="outline" size="sm" onClick={abrir}>
            <Paperclip className="size-4" /> Ver
          </Button>
          {d.drive === "pendente" || d.drive === "erro" ? (
            <Chip tom="atencao">Drive pendente</Chip>
          ) : null}
          {d.drive === "copiada" && d.drive_url ? (
            <Button variant="ghost" size="sm" asChild>
              <a
                href={d.drive_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir no Drive"
              >
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : null}
        </>
      ) : (
        <Chip tom="neutro">Sem comprovante</Chip>
      )}
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/png,image/jpeg,.xml,application/xml,text/xml"
        className="hidden"
        onChange={(e) => enviar(e.target.files?.[0])}
      />
      <Button
        size="sm"
        variant={d.comprovante_path ? "ghost" : "default"}
        disabled={ocupado}
        onClick={() => entrada.current?.click()}
      >
        {ocupado ? "Enviando…" : d.comprovante_path ? "Trocar" : "Anexar"}
      </Button>
    </li>
  );
}
