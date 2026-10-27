// Avatar da empresa: a logo (quadrada, cantos arredondados) ou as iniciais do nome.
import { useLogoEmpresa } from "@/lib/empresa-logo";
import { iniciaisDaEmpresa } from "@/lib/iniciais-empresa";
import { cn } from "@/lib/utils";

export function AvatarEmpresa({
  empresaId,
  nome,
  tamanho = 38,
  className,
}: {
  empresaId: string | null | undefined;
  nome: string;
  /** Lado em px. */
  tamanho?: number;
  className?: string;
}) {
  const logo = useLogoEmpresa(empresaId);
  const estilo = { width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.42) };
  if (logo.data)
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white",
          className,
        )}
        style={estilo}
        aria-hidden
      >
        <img src={logo.data} alt="" className="size-full object-contain p-[2px]" />
      </span>
    );
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-navy-deep font-titulo text-destaque ring-1 ring-inset ring-navy-foreground/15",
        className,
      )}
      style={estilo}
      aria-hidden
    >
      {iniciaisDaEmpresa(nome)}
    </span>
  );
}
