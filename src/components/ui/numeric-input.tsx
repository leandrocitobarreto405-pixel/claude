import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/** Converte texto digitado (pt-BR ou en) em número. Vazio = null. */
export function parseNumberBR(text: string): number | null {
  let clean = text.replace(/\s/g, "");
  if (clean.includes(",")) {
    // Vírgula é o separador decimal: pontos são milhares.
    clean = clean.replace(/\./g, "").replace(",", ".");
  }
  if (!clean || clean === "-" || clean === "." || clean === "-.") return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function formatBR(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "";
  return decimals > 0 ? value.toFixed(decimals).replace(".", ",") : String(Math.round(value));
}

type BaseProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Casas decimais usadas ao reformatar o campo (0 desativa decimais). */
  decimals?: number;
  min?: number;
  max?: number;
};

/**
 * Campo numérico amigável: mantém o texto digitado (permitindo campo vazio,
 * vírgula ou ponto como separador) e só converte para número ao avisar o pai.
 * Evita o "zero preso" dos inputs type="number" controlados por número.
 */
export const NumericInput = forwardRef<HTMLInputElement, BaseProps>(function NumericInput(
  { value, onValueChange, decimals = 2, min, max, onBlur, inputMode, ...rest },
  ref,
) {
  const [text, setText] = useState(() => (value === null ? "" : formatBR(value, decimals)));
  const [focused, setFocused] = useState(false);

  // Sincroniza quando o valor muda de fora (reset de formulário, sugestão etc.).
  useEffect(() => {
    if (focused) return;
    const current = parseNumberBR(text);
    if (value === null) {
      if (text !== "") setText("");
      return;
    }
    if (current === null || Math.abs(current - value) > 0.0001) {
      setText(formatBR(value, decimals));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals, focused]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw !== "" && !/^-?[\d.,]*$/.test(raw)) return;
    setText(raw);
    const parsed = parseNumberBR(raw);
    onValueChange(parsed);
  }

  return (
    <Input
      {...rest}
      ref={ref}
      type="text"
      inputMode={inputMode ?? (decimals > 0 ? "decimal" : "numeric")}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onChange={handleChange}
      onBlur={(e) => {
        setFocused(false);
        let parsed = parseNumberBR(text);
        if (parsed !== null) {
          if (typeof min === "number" && parsed < min) parsed = min;
          if (typeof max === "number" && parsed > max) parsed = max;
          setText(formatBR(parsed, decimals));
          onValueChange(parsed);
        } else {
          setText("");
          onValueChange(null);
        }
        onBlur?.(e);
      }}
    />
  );
});

/** Valor em reais: aceita vírgula e ponto, campo vazio vira 0 no pai. */
export function MoneyInput({
  value,
  onValueChange,
  ...rest
}: Omit<BaseProps, "value" | "onValueChange" | "decimals"> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <NumericInput
      {...rest}
      decimals={2}
      value={value}
      onValueChange={(v) => onValueChange(v ?? 0)}
    />
  );
}

/** Quantidade/parcelas: campo pode ficar vazio enquanto digita. */
export function IntegerInput({
  value,
  onValueChange,
  emptyValue = 1,
  ...rest
}: Omit<BaseProps, "value" | "onValueChange" | "decimals"> & {
  value: number;
  onValueChange: (value: number) => void;
  emptyValue?: number;
}) {
  return (
    <NumericInput
      {...rest}
      decimals={0}
      value={value}
      onValueChange={(v) => onValueChange(v === null ? emptyValue : Math.round(v))}
    />
  );
}

/** Decimal genérico (km, percentual) com casas configuráveis. */
export function DecimalInput({
  value,
  onValueChange,
  decimals = 1,
  ...rest
}: Omit<BaseProps, "value" | "onValueChange"> & {
  value: number;
  onValueChange: (value: number) => void;
  decimals?: number;
}) {
  return (
    <NumericInput
      {...rest}
      decimals={decimals}
      value={value}
      onValueChange={(v) => onValueChange(v ?? 0)}
    />
  );
}
