import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { IntegerInput } from "@/components/ui/numeric-input";
import { lerQuantidade, type Unidade } from "@/lib/unidade";

const formatar = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);

/**
 * Quantidade do item: peças (inteiro) ou m² (com vírgula). No m² também aceita as medidas,
 * "1,6 x 2,3" vira 3,68 ao sair do campo.
 */
export function QuantidadeInput({
  value,
  unidade,
  onValueChange,
  id,
  className,
}: {
  value: number;
  unidade: Unidade;
  onValueChange: (v: number) => void;
  id?: string;
  className?: string;
}) {
  const [texto, setTexto] = useState(() => formatar(value));
  const [foco, setFoco] = useState(false);
  useEffect(() => {
    if (!foco) setTexto(formatar(value));
  }, [value, foco]);

  if (unidade !== "m2")
    return (
      <IntegerInput
        id={id}
        className={className}
        value={value}
        min={1}
        onValueChange={(v) => onValueChange(Math.max(1, v))}
      />
    );

  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          className={`pr-10 ${className ?? ""}`}
          value={texto}
          onFocus={() => setFoco(true)}
          onChange={(e) => {
            setTexto(e.target.value);
            const n = lerQuantidade(e.target.value);
            if (n !== null) onValueChange(n);
          }}
          onBlur={() => {
            setFoco(false);
            const n = lerQuantidade(texto);
            setTexto(formatar(n ?? value));
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          m²
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">ou as medidas: 1,6 x 2,3</p>
    </div>
  );
}
