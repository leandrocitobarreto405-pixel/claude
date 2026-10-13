import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BotOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marcarAliceNoCliente } from "@/lib/alice.functions";
import { clienteDaAlice } from "@/lib/pos-atendimento.functions";

/**
 * "Tirar a Alice desta cliente": a Alice fica totalmente fora (não responde, não confirma, não
 * manda pós-venda nem avaliação). A equipe pode religar depois. Usa a marcação "IA desligada".
 */
export function TirarAlice(props: { workOrderId?: string; conversaId?: string }) {
  const qc = useQueryClient();
  const lerFn = useServerFn(clienteDaAlice);
  const marcarFn = useServerFn(marcarAliceNoCliente);
  const chave = ["tirar_alice", props.workOrderId ?? props.conversaId];
  const q = useQuery({
    queryKey: chave,
    queryFn: () =>
      lerFn({
        data: props.workOrderId
          ? { workOrderId: props.workOrderId }
          : { conversaId: props.conversaId! },
      }),
  });
  const [ocupado, setOcupado] = useState(false);
  const c = q.data;
  if (!c) return null;

  async function alternar() {
    if (!c) return;
    const desligar = !c.ia_desligada;
    if (
      desligar &&
      !window.confirm(
        "Tirar a Alice desta cliente? Ela não responde, não confirma, não manda pós-venda nem pede avaliação.",
      )
    )
      return;
    setOcupado(true);
    try {
      await marcarFn({ data: { contatoId: c.id, ia_desligada: desligar } });
      toast.success(desligar ? "A Alice saiu desta cliente." : "A Alice voltou para esta cliente.");
      await qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Button
      variant="outline"
      className="min-h-11"
      disabled={ocupado}
      onClick={() => void alternar()}
      title={c.ia_desligada ? "A Alice está fora desta cliente" : undefined}
    >
      <BotOff className="mr-2 size-4" />
      {c.ia_desligada ? "Devolver a Alice a esta cliente" : "Tirar a Alice desta cliente"}
    </Button>
  );
}
