import { TriangleAlert } from "lucide-react";

/** Aviso para a equipe: impermeabilização de colchão não é recomendada. */
export function AvisoColchao({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      className={`flex items-start gap-2 rounded-md bg-atencao px-3 py-2 text-xs font-medium text-atencao-foreground ${className}`}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      Impermeabilização de colchão: não recomendada, fazer só se o cliente fizer questão.
    </p>
  );
}
