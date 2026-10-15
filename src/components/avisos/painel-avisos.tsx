import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Bell, CheckCheck, ChevronRight, Clock } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { BadgeAlerta, Botao, Card } from "@/components/nexa";
import { temAvisoImportante, type Aviso } from "@/lib/avisos";
import { CHAVE_AVISOS, useAvisos } from "@/lib/avisos-painel";
import { haQuanto } from "@/lib/conversas";
import { marcarAvisosLidosFn } from "@/lib/marketing.functions";
import { cn } from "@/lib/utils";

const ICONE = {
  problema: { Icone: AlertTriangle, cor: "bg-problema text-problema-foreground" },
  atencao: { Icone: Clock, cor: "bg-atencao text-atencao-foreground" },
  sucesso: { Icone: Bell, cor: "bg-marca-claro text-marca" },
  neutro: { Icone: Bell, cor: "bg-muted text-muted-foreground" },
} as const;

/**
 * Sininho do topo: ponto quando há aviso importante; abre o painel com os avisos de hoje.
 * `/inicio?avisos=1` (links antigos de /avisos e notificações) abre o painel sozinho.
 */
export function SinoDeAvisos({ ligado }: { ligado: boolean }) {
  const [aberto, setAberto] = useState(false);
  const navigate = useNavigate();
  const abrirPelaUrl = useRouterState({
    select: (s) => (s.location.search as { avisos?: string }).avisos === "1",
  });
  const q = useAvisos(ligado);
  const ponto = temAvisoImportante(q.data ?? []);

  useEffect(() => {
    if (!abrirPelaUrl) return;
    setAberto(true);
    // Tira o parâmetro da barra para o painel não reabrir ao navegar de volta.
    void navigate({
      to: ".",
      search: (s: Record<string, unknown>) => ({ ...s, avisos: undefined }),
      replace: true,
    } as never);
  }, [abrirPelaUrl, navigate]);

  if (!ligado) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={ponto ? "Avisos: há novidades" : "Avisos"}
        className="relative grid size-11 shrink-0 place-items-center rounded-botao text-foreground hover:bg-muted"
      >
        <Bell className="size-[22px]" aria-hidden />
        {ponto ? <BadgeAlerta ponto className="absolute right-2 top-2" rotulo="Novidades" /> : null}
      </button>
      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent
          side="right"
          className="flex w-[92vw] max-w-md flex-col gap-3 overflow-y-auto pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+1rem)]"
        >
          <SheetTitle className="font-titulo text-2xl">Avisos de hoje</SheetTitle>
          <SheetDescription className="sr-only">
            O que precisa da atenção da equipe.
          </SheetDescription>
          <ListaDeAvisos
            avisos={q.data ?? []}
            carregando={q.isLoading}
            erro={q.error}
            aoNavegar={() => setAberto(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

export function ListaDeAvisos({
  avisos,
  carregando,
  erro,
  aoNavegar,
}: {
  avisos: Aviso[];
  carregando: boolean;
  erro: unknown;
  aoNavegar?: (() => void) | undefined;
}) {
  const qc = useQueryClient();
  const lidosFn = useServerFn(marcarAvisosLidosFn);
  const agora = new Date();
  const temMarketingNovo = avisos.some((a) => a.novo && a.id.startsWith("mkt-"));

  async function marcarLidos() {
    try {
      await lidosFn();
      await qc.invalidateQueries({ queryKey: CHAVE_AVISOS });
      toast.success("Avisos das campanhas marcados como lidos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível marcar como lidos.");
    }
  }

  if (carregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (erro)
    return (
      <Card className="text-center text-sm">
        {erro instanceof Error ? erro.message : "Erro ao carregar os avisos."}
      </Card>
    );
  if (avisos.length === 0)
    return (
      <Card className="items-center py-8 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-marca-claro text-marca">
          <CheckCheck className="size-6" aria-hidden />
        </span>
        <p className="text-[15px] font-bold">Tudo em dia</p>
        <p className="max-w-xs text-sm text-muted-foreground">Nenhum aviso agora.</p>
      </Card>
    );
  return (
    <div className="flex flex-col gap-2.5">
      {temMarketingNovo ? (
        <Botao variante="contorno" onClick={() => void marcarLidos()} className="self-end">
          <CheckCheck /> Marcar lidos
        </Botao>
      ) : null}
      <ul className="flex flex-col gap-2.5">
        {avisos.map((a) => (
          <LinhaAviso key={a.id} a={a} agora={agora} aoNavegar={aoNavegar} />
        ))}
      </ul>
    </div>
  );
}

function LinhaAviso({
  a,
  agora,
  aoNavegar,
}: {
  a: Aviso;
  agora: Date;
  aoNavegar?: (() => void) | undefined;
}) {
  const { Icone, cor } = ICONE[a.tom];
  return (
    <li>
      <Link
        to={a.link.to as never}
        params={a.link.params as never}
        search={(a.link.search ?? {}) as never}
        onClick={aoNavegar}
        className={cn(
          "flex min-h-11 items-start gap-3 rounded-card border bg-card p-4 hover:border-marca/40",
          a.tom === "problema" ? "border-problema-foreground/30" : "border-border",
        )}
      >
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", cor)}>
          <Icone className="size-5" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-start justify-between gap-2">
            <span className="text-[15px] font-bold leading-snug">{a.titulo}</span>
            {a.novo ? <BadgeAlerta ponto className="mt-1.5 shrink-0" rotulo="Novo" /> : null}
          </span>
          <span className="line-clamp-3 text-sm text-muted-foreground">{a.texto}</span>
          {a.quando ? (
            <span className="text-xs text-muted-foreground">{haQuanto(a.quando, agora)}</span>
          ) : null}
        </span>
        <ChevronRight className="mt-2.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}
