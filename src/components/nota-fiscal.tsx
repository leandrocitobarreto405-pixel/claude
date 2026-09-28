import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, Eye, Paperclip, Receipt } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useSetting } from "@/lib/data";
import { dateBR, dateTimeBR, todayISO } from "@/lib/format";
import {
  DEFAULT_NOTA_TEMPLATE,
  TAREFA_NOTA_SELECT,
  anexarNota,
  camposFaltando,
  dadosDaNota,
  linkArquivoNota,
  marcarSolicitada,
  montarMensagemNota,
  type TarefaNota,
} from "@/lib/nota-fiscal";

export const NOTAS_QUERY_KEY = "notas_fiscais";

export function useModeloNota() {
  const { data } = useSetting<unknown>("invoice_message_template", DEFAULT_NOTA_TEMPLATE);
  return typeof data === "string" && data.trim() ? data : DEFAULT_NOTA_TEMPLATE;
}

const CLASSE_STATUS: Record<string, string> = {
  Pendente: "bg-amber-100 text-amber-900",
  Solicitada: "bg-primary/10 text-primary",
  Emitida: "bg-emerald-100 text-emerald-800",
  Cancelada: "bg-secondary text-muted-foreground",
  "Não necessária": "bg-secondary text-muted-foreground",
};

export function SituacaoNota({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASSE_STATUS[status] ?? "bg-secondary"}`}
    >
      {status}
    </span>
  );
}

export async function copiarTexto(texto: string, aviso: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(aviso);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
  }
}

/** Botões da nota de uma OS: copiar mensagem, solicitada, emitida, anexar e ver o arquivo. */
export function AcoesNota({ tarefa, onChange }: { tarefa: TarefaNota; onChange: () => void }) {
  const modelo = useModeloNota();
  const dados = dadosDaNota(tarefa);
  const faltando = camposFaltando(dados);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [emitindo, setEmitindo] = useState(false);
  const [numero, setNumero] = useState("");
  const [dataEmissao, setDataEmissao] = useState(todayISO());
  const [ocupado, setOcupado] = useState(false);

  async function executar(acao: () => Promise<void>, sucesso: string) {
    setOcupado(true);
    try {
      await acao();
      toast.success(sucesso);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
    } finally {
      setOcupado(false);
    }
  }

  async function abrirArquivo(baixar: boolean) {
    if (!tarefa.arquivo_path) return;
    try {
      const url = await linkArquivoNota(tarefa.arquivo_path, baixar);
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error("Não foi possível abrir o arquivo da nota.");
    }
  }

  return (
    <div className="grid gap-2">
      {faltando.length ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Falta no cadastro: {faltando.join(", ")}. A mensagem sai com “não informado”.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() =>
            void copiarTexto(montarMensagemNota(modelo, dados), "Mensagem da nota copiada.")
          }
        >
          <Copy className="size-4" /> Copiar mensagem
        </Button>
        {tarefa.status === "Pendente" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              void executar(() => marcarSolicitada(tarefa.id), "Nota marcada como solicitada.")
            }
          >
            Nota solicitada
          </Button>
        ) : null}
        {tarefa.status !== "Emitida" ? (
          <Button
            size="sm"
            disabled={ocupado}
            onClick={() => {
              setNumero(tarefa.invoice_number ?? "");
              setDataEmissao(todayISO());
              setEmitindo(true);
            }}
          >
            Nota emitida
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={ocupado}
          onClick={() => arquivoRef.current?.click()}
        >
          <Paperclip className="size-4" /> {tarefa.arquivo_path ? "Trocar arquivo" : "Anexar nota"}
        </Button>
        {tarefa.arquivo_path ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => void abrirArquivo(false)}
            >
              <Eye className="size-4" /> Ver nota
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => void abrirArquivo(true)}
            >
              <Download className="size-4" /> Baixar
            </Button>
          </>
        ) : null}
        <input
          ref={arquivoRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = "";
            if (!arquivo) return;
            if (arquivo.size > 10 * 1024 * 1024) {
              toast.error("O arquivo pode ter no máximo 10 MB.");
              return;
            }
            void executar(() => anexarNota(tarefa, arquivo), "Arquivo da nota anexado.");
          }}
        />
      </div>

      <Dialog open={emitindo} onOpenChange={setEmitindo}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar nota fiscal emitida</DialogTitle>
            <DialogDescription>Informe o número e a data de emissão.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`nf-numero-${tarefa.id}`}>Número da nota</Label>
              <Input
                id={`nf-numero-${tarefa.id}`}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`nf-data-${tarefa.id}`}>Data de emissão</Label>
              <Input
                id={`nf-data-${tarefa.id}`}
                type="date"
                value={dataEmissao}
                onChange={(e) => setDataEmissao(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEmitindo(false)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado}
              onClick={() => {
                if (!numero.trim()) {
                  toast.error("Informe o número da nota fiscal.");
                  return;
                }
                void executar(async () => {
                  const { error } = await supabase
                    .from("invoice_tasks")
                    .update({
                      status: "Emitida",
                      invoice_number: numero.trim(),
                      issue_date: dataEmissao,
                    })
                    .eq("id", tarefa.id);
                  if (error) throw error;
                  setEmitindo(false);
                }, "Nota registrada como emitida.");
              }}
            >
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Área "Emissão de nota fiscal" da OS. */
export function NotaFiscalDaOs({
  workOrderId,
  customerId,
  documento,
  valor,
  dataServico,
}: {
  workOrderId: string;
  customerId: string | null;
  documento: string | null;
  valor: number;
  dataServico: string | null;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [NOTAS_QUERY_KEY, "os", workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_tasks")
        .select(TAREFA_NOTA_SELECT)
        .eq("work_order_id", workOrderId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as TarefaNota | null;
    },
  });
  const atualizar = () => void qc.invalidateQueries({ queryKey: [NOTAS_QUERY_KEY] });
  const tarefa = query.data;

  async function criarPedido() {
    const { error } = await supabase.from("invoice_tasks").insert({
      work_order_id: workOrderId,
      customer_id: customerId,
      document_number: documento,
      service_date: dataServico ?? todayISO(),
      invoice_amount: valor,
      status: "Pendente",
    } as never);
    if (error) {
      toast.error("Não foi possível criar o pedido de nota.");
      return;
    }
    toast.success("Pedido de nota criado.");
    atualizar();
  }

  return (
    <section className="card-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Receipt className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">Emissão de nota fiscal</h2>
        </div>
        {tarefa ? <SituacaoNota status={tarefa.status} /> : null}
      </div>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : tarefa ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Serviço em {tarefa.service_date ? dateBR(tarefa.service_date) : "—"}
            {tarefa.solicitada_em ? ` · solicitada em ${dateTimeBR(tarefa.solicitada_em)}` : ""}
            {tarefa.invoice_number
              ? ` · nota ${tarefa.invoice_number} emitida em ${dateBR(tarefa.issue_date)}`
              : ""}
          </p>
          <AcoesNota tarefa={tarefa} onChange={atualizar} />
        </>
      ) : (
        <div className="grid gap-2 text-sm">
          <p className="text-muted-foreground">
            Nenhum pedido de nota para esta OS. Ele é criado ao concluir o serviço marcando “precisa
            de nota”, ou aqui.
          </p>
          <div>
            <Button size="sm" variant="outline" onClick={() => void criarPedido()}>
              Criar pedido de nota
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
