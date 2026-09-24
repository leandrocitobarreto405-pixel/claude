import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/ui/numeric-input";
import { invalidateFinanceQueries } from "@/lib/cache";
import { applyVisitDiscount, DISCOUNT_REASONS } from "@/lib/discounts";
import { brl } from "@/lib/format";
import { useSession } from "@/lib/session";

export function DiscountDialog({
  open,
  onOpenChange,
  visitId,
  workOrderId,
  balance,
  label,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  visitId: string | null;
  workOrderId: string | null;
  balance: number;
  label?: string | undefined;
  onDone?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [valor, setValor] = useState(balance);
  const [motivo, setMotivo] = useState<string>(DISCOUNT_REASONS[0]);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValor(Math.max(0, Math.round(balance * 100) / 100));
    setMotivo(DISCOUNT_REASONS[0]);
    setObs("");
  }, [open, balance]);

  async function confirmar() {
    if (!visitId || !workOrderId) return;
    setSalvando(true);
    try {
      await applyVisitDiscount({
        visitId,
        workOrderId,
        amount: valor,
        reason: motivo,
        notes: obs,
        userId,
      });
      toast.success("Saldo dispensado. O valor saiu de A receber.");
      invalidateFinanceQueries(queryClient);
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível dispensar o saldo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dispensar saldo</DialogTitle>
          <DialogDescription>
            O valor dispensado sai de “A receber” e o atendimento fica quitado. Não entra como
            receita nem despesa.{label ? ` · ${label}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Saldo pendente atual: <strong>{brl(balance)}</strong>
          </p>
          <div className="space-y-1">
            <Label htmlFor="valor-desconto">Valor a dispensar</Label>
            <MoneyInput
              id="valor-desconto"
              value={valor}
              onValueChange={setValor}
              min={0}
              max={balance}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="motivo-desconto">Motivo</Label>
            <select
              id="motivo-desconto"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {DISCOUNT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="obs-desconto">Observação (opcional)</Label>
            <Textarea id="obs-desconto" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvando || valor <= 0}>
            {salvando ? "Salvando..." : "Dispensar saldo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
