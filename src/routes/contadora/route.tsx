import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Download, Droplets, FileText, LogOut, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BarraDeNavegacaoInferior, type ItemDeNavegacao } from "@/components/nexa";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { guardarEmpresa, useEmpresasDaContadora } from "@/lib/contadora";
import { cn } from "@/lib/utils";

/** Área da contadora: só Notas fiscais, OS realizadas, Despesas e Exportar mês. */
export const Route = createFileRoute("/contadora")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  component: ShellContadora,
});

const ITENS: ItemDeNavegacao[] = [
  { to: "/contadora/notas", rotulo: "Notas fiscais", icone: FileText },
  { to: "/contadora/os", rotulo: "OS realizadas", icone: ClipboardCheck },
  { to: "/contadora/despesas", rotulo: "Despesas", icone: Receipt },
  { to: "/contadora/exportar", rotulo: "Exportar mês", icone: Download },
];

function ShellContadora() {
  const { data, isLoading } = useEmpresasDaContadora();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function sair() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const empresa = data?.ativa ?? null;
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col bg-navy-deep lg:flex">
        <div className="border-b border-navy-foreground/10 px-4 py-4">
          <p className="text-sm font-semibold text-navy-foreground">Nexa OS</p>
          <p className="mt-1 text-xs text-navy-foreground/60">Contabilidade</p>
        </div>
        <nav className="flex flex-col gap-1 p-3" aria-label="Menu da contadora">
          {ITENS.map((item) => {
            const ativo = pathname.startsWith(item.to);
            const Icone = item.icone;
            return (
              <Link
                key={item.to}
                to={item.to as never}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium",
                  ativo
                    ? "bg-navy-foreground/12 text-navy-foreground"
                    : "text-navy-foreground/70 hover:bg-navy-foreground/8 hover:text-navy-foreground",
                )}
              >
                {ativo ? (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-destaque"
                  />
                ) : null}
                <Icone className={cn("size-4", ativo && "text-destaque")} />
                {item.rotulo}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={sair}
          className="mt-auto flex min-h-11 items-center gap-3 border-t border-navy-foreground/10 px-6 text-sm text-navy-foreground/80 hover:text-navy-foreground"
        >
          <LogOut className="size-4" /> Sair
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 px-4 py-2.5">
            <span className="grid size-[34px] shrink-0 place-items-center rounded-xl bg-destaque text-marca lg:hidden">
              <Droplets className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">{empresa?.nome ?? "Contabilidade"}</p>
              <p className="truncate text-xs text-muted-foreground">Contadora · Nexa OS</p>
            </div>
            {data && data.lista.length > 1 ? (
              <Select
                value={empresa?.empresa_id ?? ""}
                onValueChange={(id) => {
                  guardarEmpresa(id);
                  void queryClient.invalidateQueries({ queryKey: ["contadora"] });
                }}
              >
                <SelectTrigger className="w-[200px]" aria-label="Empresa">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.lista.map((e) => (
                    <SelectItem key={e.empresa_id} value={e.empresa_id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={sair}
              className="gap-2 lg:hidden"
              aria-label="Sair"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 pb-28 pt-4 lg:px-8 lg:pb-10">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : !empresa ? (
            <div className="card-surface mx-auto max-w-md p-6 text-center">
              <h1 className="text-lg font-semibold">Nenhuma empresa ligada a este e-mail</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Peça à empresa para convidar este e-mail em Configurações › Equipe › Contadora e
                entre de novo.
              </p>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
        <BarraDeNavegacaoInferior itens={ITENS} className="lg:hidden" />
      </div>
    </div>
  );
}
