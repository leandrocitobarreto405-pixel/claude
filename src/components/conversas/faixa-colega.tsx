import { Users } from "lucide-react";
import { primeiroNome, type Presenca } from "@/lib/caixa-equipe";
import type { ConversaResumo } from "@/lib/conversas.functions";
import { cn } from "@/lib/utils";

/** "14:32" no fuso de São Paulo. */
function hora(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nomes(lista: Presenca[]): string {
  const n = lista.map((p) => primeiroNome(p.nome));
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} e ${n[n.length - 1]}`;
}

/**
 * Duas atendentes na mesma conversa: faixa "Com Maria desde 14:32" quando outra pessoa está com
 * ela, e quem está com a conversa aberta na tela agora (presença pelo Realtime).
 */
export function FaixaColega({ c, colegas }: { c: ConversaResumo; colegas: Presenca[] }) {
  const comOutra = c.posse === "outra";
  if (!comOutra && colegas.length === 0) return null;
  const quem = primeiroNome(c.responsavelNome);
  const desde = c.assumidaPor ? hora(c.assumidaEm) : null;
  const presentes = nomes(colegas);
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-botao px-3 py-2.5 text-sm",
        comOutra ? "bg-atencao text-atencao-foreground" : "bg-marca-claro text-foreground",
      )}
    >
      <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {comOutra ? (
          <p className="font-bold">
            Com {quem}
            {desde ? ` desde ${desde}` : ""}
          </p>
        ) : null}
        {colegas.length > 0 ? (
          <p>
            {presentes} {colegas.length === 1 ? "está" : "estão"} com esta conversa aberta agora.
          </p>
        ) : null}
        {comOutra ? (
          <p className="mt-0.5 text-xs">Para responder, toque em "Assumir para mim".</p>
        ) : null}
      </div>
    </div>
  );
}
