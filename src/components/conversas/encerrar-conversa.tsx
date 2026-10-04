import { Archive } from "lucide-react";
import { Botao, type BotaoProps } from "@/components/nexa";
import { useEncerrarConversas } from "@/lib/conversas-encerrar";

/** Botão "Encerrar" de uma conversa (com confirmação). */
export function BotaoEncerrar({
  id,
  nome,
  aoEncerrar,
  ...props
}: { id: string; nome: string; aoEncerrar?: () => void } & Omit<BotaoProps, "onClick">) {
  const { encerrar, encerrando } = useEncerrarConversas();
  return (
    <Botao
      variante="neutro"
      disabled={encerrando}
      onClick={() => void encerrar([id], nome).then((ok) => ok && aoEncerrar?.())}
      {...props}
    >
      <Archive /> {encerrando ? "Encerrando…" : "Encerrar"}
    </Botao>
  );
}
