import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { AliceAgora } from "@/components/alice-agora";
import { CabecalhoDeTela, Card } from "@/components/nexa";

// Versão provisória da aba Conversas: por enquanto mostra as conversas que a Alice está
// atendendo (o mesmo bloco do Início). A lista completa chega na etapa "Conversas".
export const Route = createFileRoute("/_authenticated/conversas")({
  head: () => ({ meta: [{ title: "Conversas — Nexa OS" }] }),
  component: Conversas,
});

function Conversas() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <CabecalhoDeTela
        titulo="Conversas"
        descricao="Conversas do WhatsApp que a Alice está atendendo agora."
      />
      <AliceAgora
        vazio={
          <Card className="items-center py-8 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-marca-claro text-marca">
              <MessageCircle className="size-6" aria-hidden />
            </span>
            <p className="text-[15px] font-bold">Nenhuma conversa com a Alice agora</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Quando um cliente escrever no WhatsApp, a conversa aparece aqui.
            </p>
          </Card>
        }
      />
    </div>
  );
}
