// Aviso da assinatura no topo do app (decisão F): inadimplente na carência mostra os dias até o
// somente leitura; depois, o app fica só para consulta; cancelada ou desativada não abre (a Nexa
// continua entrando). As mensagens que chegam continuam sendo guardadas em todos os casos.
import { textoAvisoAssinatura, type SituacaoAssinatura } from "@/lib/assinatura-situacao";

export function AvisoAssinatura({ situacao }: { situacao: SituacaoAssinatura | undefined }) {
  const texto = textoAvisoAssinatura(situacao);
  if (!texto) return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-md bg-atencao px-4 py-3 text-sm text-atencao-foreground"
    >
      {texto}
    </div>
  );
}

export function EmpresaBloqueada({ nome }: { nome: string }) {
  return (
    <div className="card-surface mx-auto max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold text-navy">Acesso suspenso</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        O acesso de {nome} ao Nexa OS está suspenso. Fale com a Nexa para reativar.
      </p>
    </div>
  );
}
