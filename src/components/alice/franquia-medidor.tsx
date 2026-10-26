// Configurações › Alice: medidor da franquia ("Alice: X de 150 conversas este mês").
import { Card } from "@/components/nexa";
import { brl } from "@/lib/format";
import { useUsoAlice } from "@/lib/alice/uso-alice";
import { nivelFranquia, percentualUsado, textoMedidor, type UsoAlice } from "@/lib/alice/franquia";

export function MedidorFranquia({ uso }: { uso: UsoAlice }) {
  const p = percentualUsado(uso);
  const nivel = nivelFranquia(uso);
  const cor =
    nivel === "esgotada" && uso.trava
      ? "bg-destructive"
      : nivel === "atencao" && uso.trava
        ? "bg-atencao-foreground"
        : "bg-primary";
  return (
    <div className="mt-4 grid gap-2 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">{textoMedidor(uso)}</p>
      {p !== null ? (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={p}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Conversas da Alice usadas no mês"
        >
          <div className={`h-full ${cor}`} style={{ width: `${p}%` }} />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Conta cada conversa em que a Alice respondeu pelo menos uma vez no mês.
        {uso.trava
          ? uso.excedentes > 0
            ? ` Excedente: ${uso.excedentes} conversa(s), ${brl(uso.valor_excedente)} na próxima fatura.`
            : ""
          : " Seu plano não tem limite: é só acompanhamento."}
      </p>
    </div>
  );
}

/** Início (admin): o medidor da Alice, quando o plano tem franquia. */
export function ResumoFranquiaAlice() {
  const { data: uso } = useUsoAlice();
  if (!uso?.franquia) return null;
  return (
    <Card className="gap-0">
      <MedidorFranquia uso={uso} />
    </Card>
  );
}
