import { Bot } from "lucide-react";
import type { ConversaCompleta } from "@/lib/conversas.functions";
import { cn } from "@/lib/utils";

function hora(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const data = d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return data === hoje ? "hoje" : `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

/**
 * Resumo da Alice no topo da conversa que ela transferiu: por que passou, o que já sabe do cliente
 * e o prazo que disse a ele, para a equipe não repetir pergunta já respondida. Vermelho enquanto
 * ninguém respondeu.
 */
export function ResumoAlice({ t }: { t: NonNullable<ConversaCompleta["transferencia"]> }) {
  const esperando = !t.respondidaEm;
  const prazo = t.prazoEm
    ? t.foraDoHorario
      ? `logo cedo (${dia(t.prazoEm)} às ${hora(t.prazoEm)})`
      : `até ${hora(t.prazoEm)}`
    : null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-botao px-3 py-2.5 text-sm",
        esperando ? "bg-problema text-problema-foreground" : "bg-marca-claro text-foreground",
      )}
    >
      <Bot aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">
          A Alice transferiu {dia(t.criadaEm)} às {hora(t.criadaEm)}: {t.motivo}
        </p>
        {t.resumo ? <p className="mt-0.5 whitespace-pre-line text-foreground">{t.resumo}</p> : null}
        <p className="mt-1 text-xs">
          {prazo ? `Ela disse ao cliente que a resposta vem ${prazo}. ` : ""}
          {esperando
            ? "Ninguém respondeu ainda."
            : `A equipe respondeu às ${hora(t.respondidaEm)}.`}
        </p>
      </div>
    </div>
  );
}
