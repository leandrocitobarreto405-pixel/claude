import { CheckCircle2, FileText } from "lucide-react";
import { Botao } from "@/components/nexa";
import type { NovaOs } from "@/lib/nova-os/useNovaOs";
import { BotaoPdfDaOs } from "@/components/os/pdf-da-os";
import { useModoDocumentos, usePodeBaixarOs } from "@/lib/documentos-hooks";

export function Sucesso({
  n,
  aoVerOs,
  aoNova,
}: {
  n: NovaOs;
  aoVerOs: () => void;
  aoNova: () => void;
}) {
  const c = n.criada;
  const { data: modo } = useModoDocumentos();
  const podeBaixar = usePodeBaixarOs();
  if (!c) return null;
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-10 text-center" role="status">
      <CheckCircle2 className="size-14 text-dado" aria-hidden />
      <h2 className="font-titulo text-[26px] leading-tight">OS {c.os_number} criada</h2>
      <p className="text-sm text-muted-foreground">
        {n.estado.visitas.length} atendimento(s) agendado(s)
        {n.estado.ehTeste ? " · OS de teste" : ""}.
      </p>
      {c.documento ? (
        <p className="flex items-center gap-1.5 text-sm">
          <FileText className="size-4" aria-hidden /> Documento {c.documento} gerado.
        </p>
      ) : null}
      <div className="mt-2 flex w-full max-w-sm flex-col gap-2.5">
        {modo === "pdf" ? (
          podeBaixar ? (
            <BotaoPdfDaOs workOrderId={c.id} />
          ) : null
        ) : modo === "drive" && !c.documento ? (
          <Botao
            variante="contorno"
            larguraTotal
            onClick={() => void n.gerarDocumentoDaCriada()}
            disabled={n.gerandoDoc}
          >
            {n.gerandoDoc ? "Gerando…" : "Gerar documento"}
          </Botao>
        ) : null}
        <Botao larguraTotal tamanho="grande" onClick={aoVerOs}>
          Ver OS
        </Botao>
        <Botao variante="neutro" larguraTotal onClick={aoNova}>
          Nova
        </Botao>
      </div>
    </div>
  );
}
