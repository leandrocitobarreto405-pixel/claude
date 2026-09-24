import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateFinanceQueries } from "@/lib/cache";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegerInput, MoneyInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAYMENT_CHANNELS, PAYMENT_TYPES, usePaymentRates } from "@/lib/data";
import { brl, dateBR, todayISO } from "@/lib/format";
import {
  PAYMENT_REOPEN_REASONS,
  computeFees,
  createPayment,
  registerPayment,
  reopenPayment,
  type PaymentFull,
  type PaymentFormValues,
} from "@/lib/payments";

type Mode = "registrar" | "reabrir" | "criar";

export type VisitOption = { id: string; label: string };

export function PaymentDialog({
  open,
  onOpenChange,
  payment,
  mode,
  onDone,
  workOrderId,
  visitOptions,
  suggestedAmount,
  osLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payment: PaymentFull | null;
  mode: Mode;
  onDone?: () => void;
  workOrderId?: string | null;
  visitOptions?: VisitOption[];
  suggestedAmount?: number;
  osLabel?: string;
}) {
  const { data: rates } = usePaymentRates();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState<string>(PAYMENT_REOPEN_REASONS[0]);
  const [reasonNotes, setReasonNotes] = useState("");
  const [values, setValues] = useState<PaymentFormValues>({
    payment_channel: PAYMENT_CHANNELS[0],
    payment_type: PAYMENT_TYPES[0],
    installments: 1,
    gross_amount: 0,
    payment_date: todayISO(),
    notes: null,
  });

  const isCreate = mode === "criar";
  const [visitId, setVisitId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setReason(PAYMENT_REOPEN_REASONS[0]);
    setReasonNotes("");
    if (isCreate) {
      setVisitId(visitOptions?.length === 1 ? visitOptions[0]!.id : "");
      setValues({
        payment_channel: PAYMENT_CHANNELS[0],
        payment_type: PAYMENT_TYPES[0],
        installments: 1,
        gross_amount: Math.max(0, Math.round(Number(suggestedAmount ?? 0) * 100) / 100),
        payment_date: todayISO(),
        notes: null,
      });
      return;
    }
    if (!payment) return;
    setValues({
      payment_channel: payment.payment_channel || PAYMENT_CHANNELS[0],
      payment_type: payment.payment_type || PAYMENT_TYPES[0],
      installments: payment.installments || 1,
      gross_amount: Number(payment.gross_amount ?? 0),
      payment_date: payment.payment_date ?? todayISO(),
      notes: payment.notes ?? null,
    });
  }, [open, payment, isCreate, suggestedAmount, visitOptions]);

  const preview = useMemo(() => computeFees(rates, values), [rates, values]);

  if (!payment && !isCreate) return null;

  const isCredit = values.payment_type === "Crédito";

  async function confirmar() {
    setSaving(true);
    try {
      if (isCreate) {
        if (!workOrderId) throw new Error("OS não identificada.");
        await createPayment({
          workOrderId,
          visitId: visitId || null,
          values,
          rates,
        });
        toast.success("Pagamento lançado com sucesso.");
      } else if (!payment) {
        return;
      } else if (mode === "reabrir") {
        await reopenPayment(payment, reason, reasonNotes.trim() || null);
        toast.success("Pagamento reaberto. Registre novamente informando a forma correta.");
      } else {
        await registerPayment(payment, values, rates, {
          reason: payment.reopen_reason ?? null,
        });
        toast.success("Pagamento registrado com a nova forma de pagamento.");
      }
      invalidateFinanceQueries(queryClient);
      onOpenChange(false);
      onDone?.();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "reabrir"
              ? "Reabrir pagamento"
              : isCreate
                ? "Lançar pagamento"
                : "Registrar pagamento"}
          </DialogTitle>
          <DialogDescription>
            {mode === "reabrir"
              ? "O pagamento sai do caixa e volta para “Não pago”. O registro anterior fica guardado no histórico."
              : isCreate
                ? `Registre um pagamento recebido depois da conclusão do serviço${osLabel ? ` · ${osLabel}` : ""}.`
                : "Escolha a forma de pagamento realmente utilizada. A taxa e o valor líquido são recalculados."}
          </DialogDescription>
        </DialogHeader>

        {payment && !isCreate ? (
          <div className="rounded-xl border border-border bg-secondary/50 p-3 text-sm">
            <p className="font-medium">Pagamento anterior</p>
            <p className="text-muted-foreground">
              {payment.payment_channel} · {payment.payment_type} · {payment.installments}x ·{" "}
              {brl(payment.gross_amount)} · taxa {brl(payment.payment_fee_amount)} · líquido{" "}
              {brl(payment.net_amount)}
              {payment.payment_date ? ` · ${dateBR(payment.payment_date)}` : ""}
            </p>
            {payment.reopen_reason ? (
              <p className="mt-1 text-muted-foreground">
                Reaberto por: {payment.reopen_reason}
              </p>
            ) : null}
          </div>
        ) : null}

        {isCreate && (visitOptions?.length ?? 0) > 1 ? (
          <div className="space-y-1">
            <Label htmlFor="visita-pagamento">Atendimento referente</Label>
            <select
              id="visita-pagamento"
              value={visitId}
              onChange={(e) => setVisitId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem atendimento específico</option>
              {(visitOptions ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}


        {mode === "reabrir" ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Motivo da reabertura</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_REOPEN_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reason-notes">Observação (opcional)</Label>
              <Textarea
                id="reason-notes"
                value={reasonNotes}
                onChange={(e) => setReasonNotes(e.target.value)}
                placeholder="Detalhe o que aconteceu"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Canal</Label>
                <Select
                  value={values.payment_channel}
                  onValueChange={(v) => setValues((s) => ({ ...s, payment_channel: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Forma de pagamento</Label>
                <Select
                  value={values.payment_type}
                  onValueChange={(v) =>
                    setValues((s) => ({
                      ...s,
                      payment_type: v,
                      installments: v === "Crédito" ? s.installments : 1,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="parcelas">Parcelas</Label>
                <IntegerInput
                  id="parcelas"
                  min={1}
                  max={18}
                  disabled={!isCredit}
                  value={values.installments}
                  onValueChange={(v) => setValues((s) => ({ ...s, installments: Math.max(1, v) }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="valor">Valor pago</Label>
                <MoneyInput
                  id="valor"
                  min={0}
                  value={values.gross_amount}
                  onValueChange={(v) => setValues((s) => ({ ...s, gross_amount: v }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="data-pag">Data do pagamento</Label>
                <Input
                  id="data-pag"
                  type="date"
                  value={values.payment_date ?? ""}
                  onChange={(e) => setValues((s) => ({ ...s, payment_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="rounded-xl border border-border p-3 text-sm">
              <p>
                Taxa aplicada: {preview.appliedRate.toFixed(2).replace(".", ",")}% ·{" "}
                {brl(preview.feeAmount)}
              </p>
              <p className="font-medium">Valor líquido: {brl(preview.netAmount)}</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="obs-pag">Observação</Label>
              <Textarea
                id="obs-pag"
                value={values.notes ?? ""}
                onChange={(e) => setValues((s) => ({ ...s, notes: e.target.value }))}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={saving}>
            {saving ? "Salvando..." : mode === "reabrir" ? "Reabrir pagamento" : "Confirmar pagamento"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
