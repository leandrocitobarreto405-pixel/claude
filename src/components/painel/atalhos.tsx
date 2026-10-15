import { Link } from "@tanstack/react-router";
import { atalhosDoPapel } from "@/lib/painel";
import type { Papel } from "@/lib/tenant";

/** Grade de atalhos (4 por linha no celular), só com o que a pessoa pode abrir. */
export function Atalhos({ papel, souNexa = false }: { papel: Papel | null; souNexa?: boolean }) {
  const lista = atalhosDoPapel(papel, souNexa);
  if (lista.length === 0) return null;
  return (
    <nav aria-label="Atalhos">
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {lista.map((a) => (
          <li key={a.id}>
            <Link
              to={a.to as never}
              search={(a.search ?? {}) as never}
              className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-card border border-border bg-card px-1 py-2 text-center hover:border-marca/40"
            >
              <span className="grid size-11 place-items-center rounded-botao bg-marca-claro text-marca">
                <a.icone className="size-5" aria-hidden />
              </span>
              <span className="text-[11px] leading-tight font-bold">{a.rotulo}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
