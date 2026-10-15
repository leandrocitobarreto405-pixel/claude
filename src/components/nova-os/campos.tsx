import type { ReactNode, SelectHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Rótulo + campo, empilhados (celular primeiro). */
export function Campo({
  id,
  rotulo,
  children,
  dica,
  className,
}: {
  id: string;
  rotulo: ReactNode;
  children: ReactNode;
  dica?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-[13px] font-bold">
        {rotulo}
      </Label>
      {children}
      {dica ? <p className="text-xs text-muted-foreground">{dica}</p> : null}
    </div>
  );
}

/** Campo de texto com rótulo. */
export function CampoTexto({
  id,
  rotulo,
  valor,
  aoMudar,
  className,
  dica,
  ...props
}: {
  id: string;
  rotulo: ReactNode;
  valor: string;
  aoMudar: (v: string) => void;
  className?: string | undefined;
  dica?: ReactNode | undefined;
} & Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange" | "className">) {
  return (
    <Campo id={id} rotulo={rotulo} className={className} dica={dica}>
      <Input id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} {...props} />
    </Campo>
  );
}

/** Select nativo com a altura mínima de toque (44 px). */
export function Seletor({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-11 w-full rounded-lg border border-input bg-card px-3 text-base text-foreground md:text-sm",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/** Bloco com título dentro do passo. */
export function Secao({
  titulo,
  acao,
  children,
}: {
  titulo: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}
