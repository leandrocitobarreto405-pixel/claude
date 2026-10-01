import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const botaoVariants = cva(
  "rounded-botao font-bold shadow-none transition-colors [&_svg]:size-[18px] disabled:opacity-50",
  {
    variants: {
      variante: {
        /** Ação principal: verde-escuro da marca, texto branco. */
        primario: "bg-marca text-marca-foreground hover:bg-marca/90 active:bg-marca-fundo",
        /** Ação secundária: borda da marca sobre o cartão. */
        contorno:
          "border-[1.5px] border-marca bg-card text-marca hover:bg-marca-claro active:bg-marca-claro",
        /** Ação de apoio (WhatsApp, Ligar, Detalhes): fundo do app, sem borda. */
        neutro: "bg-background text-foreground font-semibold hover:bg-muted active:bg-muted",
        /** Sobre o CardEscuro: botão branco com texto da marca. */
        claro: "bg-card text-marca hover:bg-marca-claro",
      },
      tamanho: {
        /** 44 px: o mínimo para toque. */
        padrao: "h-auto min-h-11 px-4 text-sm",
        /** 48 px: ação principal da tela. */
        grande: "h-auto min-h-12 px-5 text-[15px]",
        /** Quadrado de 44 px, só ícone (use aria-label). */
        icone: "size-11 p-0",
      },
      larguraTotal: { true: "w-full", false: "" },
    },
    defaultVariants: { variante: "primario", tamanho: "padrao", larguraTotal: false },
  },
);

export type BotaoProps = Omit<React.ComponentProps<typeof Button>, "variant" | "size"> &
  VariantProps<typeof botaoVariants>;

/** Botão do Nexa (primário escuro, contorno ou neutro), sempre com pelo menos 44 px de altura. */
export const Botao = React.forwardRef<HTMLButtonElement, BotaoProps>(
  ({ variante, tamanho, larguraTotal, className, ...props }, ref) => (
    <Button
      ref={ref}
      // Sem a cor do botão base: a variante do Nexa define tudo.
      variant="ghost"
      className={cn(botaoVariants({ variante, tamanho, larguraTotal }), className)}
      {...props}
    />
  ),
);
Botao.displayName = "Botao";
