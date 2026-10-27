// Logo da Nexa (arquivos em public/brand). "sobre" diz a cor do fundo: "claro" usa o azul-marinho,
// "escuro" usa o branco e "auto" troca sozinho com o tema do aparelho.
import { cn } from "@/lib/utils";

const ARQUIVO = {
  simbolo: "nexa-simbolo",
  logo: "nexa-logo",
  completo: "nexa-logo-completo",
} as const;

export function LogoNexa({
  variante = "logo",
  sobre = "auto",
  className,
  alt = "Nexa",
}: {
  variante?: keyof typeof ARQUIVO;
  sobre?: "claro" | "escuro" | "auto";
  className?: string;
  alt?: string;
}) {
  const base = `/brand/${ARQUIVO[variante]}`;
  if (sobre !== "auto")
    return (
      <img
        src={`${base}${sobre === "escuro" ? "-escuro" : ""}.svg`}
        alt={alt}
        className={cn("w-auto shrink-0", className)}
      />
    );
  return (
    <>
      <img src={`${base}.svg`} alt={alt} className={cn("w-auto shrink-0 dark:hidden", className)} />
      <img
        src={`${base}-escuro.svg`}
        alt={alt}
        className={cn("hidden w-auto shrink-0 dark:block", className)}
      />
    </>
  );
}
