import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Droplets } from "lucide-react";

/** Layout das páginas públicas de Política de Privacidade e Termos de Serviço. */
export function PaginaLegal({
  titulo,
  atualizadaEm,
  children,
}: {
  titulo: string;
  atualizadaEm: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-linear-to-b from-navy-deep to-navy px-4 py-6 text-navy-foreground">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Droplets className="size-5" />
          </span>
          <span className="text-lg font-semibold">Nexa OS</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-navy">{titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Atualizada em {atualizadaEm}.</p>
        <div className="mt-6 space-y-4 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-navy [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
          {children}
        </div>
        <footer className="mt-12 flex flex-wrap gap-4 border-t border-border pt-4 text-sm text-muted-foreground">
          <Link to="/auth" className="hover:underline">
            Entrar no Nexa OS
          </Link>
          <Link to="/privacidade" className="hover:underline">
            Política de Privacidade
          </Link>
          <Link to="/termos" className="hover:underline">
            Termos de Serviço
          </Link>
        </footer>
      </main>
    </div>
  );
}
