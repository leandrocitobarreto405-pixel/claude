import * as React from "react";
import { Switch as SwitchBase } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchBase>;

/** Chave liga/desliga de 56×32 px (marca quando ligada). */
export const Switch = React.forwardRef<React.ElementRef<typeof SwitchBase>, SwitchProps>(
  ({ className, ...props }, ref) => (
    <SwitchBase
      ref={ref}
      className={cn(
        "h-8 w-14 border-0 p-0.5 shadow-none data-[state=checked]:bg-marca data-[state=unchecked]:bg-desligado",
        // Bolinha de 28 px.
        "[&>span]:size-7 [&>span]:bg-card [&>span]:shadow-none [&>span]:data-[state=checked]:translate-x-6",
        className,
      )}
      {...props}
    />
  ),
);
Switch.displayName = "Switch";

/** Linha com título, descrição e a chave à direita; a linha inteira tem pelo menos 44 px. */
export function LinhaSwitch({
  id,
  titulo,
  descricao,
  icone,
  className,
  ...props
}: SwitchProps & {
  id: string;
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  icone?: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-11 items-center gap-3", className)}>
      {icone}
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5">
        <span className="text-[15px] font-bold">{titulo}</span>
        {descricao ? (
          <span className="text-[13px] leading-snug text-muted-foreground">{descricao}</span>
        ) : null}
      </label>
      <Switch id={id} {...props} />
    </div>
  );
}
