import { BotOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTirarAlice } from "@/components/tirar-alice-estado";

/**
 * "Tirar a Alice desta cliente": a Alice fica totalmente fora (não responde, não confirma, não
 * manda pós-venda nem avaliação). A equipe pode religar depois. Usa a marcação "IA desligada".
 */
export function TirarAlice(props: { workOrderId?: string; conversaId?: string }) {
  const { c, ocupado, alternar } = useTirarAlice(props);
  if (!c) return null;
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
