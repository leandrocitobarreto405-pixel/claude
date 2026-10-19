// PDF da OS e termo de garantia gerados no app (Configurações › Documentos › PDF direto no app).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Share2 } from "lucide-react";
import { Botao } from "@/components/nexa";
import { usePdfCompartilhavel } from "@/lib/compartilhar-pdf";
import { usePodeBaixarOs } from "@/lib/documentos-hooks";
import { pdfDaOsFn, termoDisponivelFn, termoPdfFn } from "@/lib/documentos.functions";

function BotaoCompartilharPronto({ p }: { p: ReturnType<typeof usePdfCompartilhavel> }) {
  if (!p.pronto) return null;
  return (
    <Botao variante="primario" larguraTotal onClick={() => void p.compartilharPronto()}>
      <Share2 aria-hidden /> Compartilhar PDF
    </Botao>
  );
}

export function BotaoPdfDaOs({
  workOrderId,
  variante = "contorno",
}: {
  workOrderId: string;
  variante?: "primario" | "contorno";
}) {
  const gerar = useServerFn(pdfDaOsFn);
  const p = usePdfCompartilhavel();
  return (
    <>
      <Botao
        variante={variante}
        larguraTotal
        disabled={p.gerando}
        onClick={() => void p.gerar(() => gerar({ data: { workOrderId } }))}
      >
        <Download aria-hidden /> {p.gerando ? "Gerando PDF…" : "Baixar PDF"}
      </Botao>
      <BotaoCompartilharPronto p={p} />
    </>
  );
}

function BotaoTermo({ workOrderId }: { workOrderId: string }) {
  const disponivelFn = useServerFn(termoDisponivelFn);
  const gerar = useServerFn(termoPdfFn);
  const p = usePdfCompartilhavel();
  const q = useQuery({
    queryKey: ["termo-pdf-disponivel", workOrderId],
    queryFn: () => disponivelFn({ data: { workOrderId } }),
  });
  if (!q.data?.disponivel) return null;
  return (
    <>
      <Botao
        variante="contorno"
        larguraTotal
        disabled={p.gerando}
        onClick={() => void p.gerar(() => gerar({ data: { workOrderId } }))}
      >
        <Download aria-hidden /> {p.gerando ? "Gerando termo…" : "Baixar termo de garantia"}
      </Botao>
      <BotaoCompartilharPronto p={p} />
    </>
  );
}

/** Cartão "Documento da OS" da tela da OS no modo PDF. */
export function CartaoPdfDaOs({ workOrderId }: { workOrderId: string }) {
  const podeOs = usePodeBaixarOs();
  return (
    <section className="card-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Documento da OS</h2>
      </div>
      <div className="flex flex-col gap-2">
        {podeOs ? <BotaoPdfDaOs workOrderId={workOrderId} /> : null}
        <BotaoTermo workOrderId={workOrderId} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        O PDF é gerado na hora com os dados atuais da OS e não fica salvo. No celular abre o
        compartilhar (WhatsApp, Arquivos…). O termo de garantia aparece depois de uma visita de
        impermeabilização concluída.
      </p>
    </section>
  );
}
