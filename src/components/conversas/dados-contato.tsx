// Dados do contato (toque no nome, na barra da conversa): nome, telefone, nome do perfil (só
// referência), etiquetas,
// por que a Alice passou para a equipe e o lead no CRM.
import { Link } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Botao } from "@/components/nexa";
import { Avatar, EtiquetasConversa } from "@/components/conversas/cartao-conversa";
import type { ConversaCompleta } from "@/lib/conversas.functions";

export function DadosContato({
  c,
  aberto,
  aoMudar,
}: {
  c: ConversaCompleta;
  aberto: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <Sheet open={aberto} onOpenChange={aoMudar}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-card pb-[max(env(safe-area-inset-bottom),1rem)] lg:mx-auto lg:max-w-lg"
      >
        <SheetHeader className="items-center text-center">
          <Avatar nome={c.nome} className="size-16 text-lg" />
          <SheetTitle className="text-lg">{c.nome}</SheetTitle>
          <SheetDescription>{c.telefone ?? "Sem telefone"}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 grid gap-3">
          {c.nomePerfil ? (
            <p className="text-center text-sm text-muted-foreground">
              Perfil no WhatsApp: {c.nomePerfil}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-1.5">
            <EtiquetasConversa c={c} />
          </div>
          {c.passagem?.resumo ? (
            <div className="rounded-botao bg-atencao px-3 py-2.5 text-sm text-atencao-foreground">
              <p className="font-bold">A Alice passou para a equipe: {c.passagem.motivo}</p>
              <p className="mt-0.5">{c.passagem.resumo}</p>
            </div>
          ) : null}
          {c.leadId ? (
            <Botao asChild variante="contorno" larguraTotal>
              <Link to="/crm/lead/$leadId" params={{ leadId: c.leadId }}>
                Ver o lead no CRM
              </Link>
            </Botao>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
