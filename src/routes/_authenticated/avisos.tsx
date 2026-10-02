import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Bell, CheckCheck, ChevronRight, Clock } from "lucide-react";
import { BadgeAlerta, Botao, CabecalhoDeTela, Card } from "@/components/nexa";
import { WhatsappEquipe } from "@/components/avisos/whatsapp-equipe";
import type { Aviso } from "@/lib/avisos";
import { listarAvisos } from "@/lib/avisos.functions";
import { haQuanto } from "@/lib/conversas";
import { marcarAvisosLidosFn } from "@/lib/marketing.functions";
import { usePapel } from "@/lib/tenant";
import { cn } from "@/lib/utils";

export const CHAVE_AVISOS = ["avisos"] as const;

export const Route = createFileRoute("/_authenticated/avisos")({
  head: () => ({ meta: [{ title: "Avisos — Nexa OS" }] }),
  component: Avisos,
});

const ICONE = {
  problema: { Icone: AlertTriangle, cor: "bg-problema text-problema-foreground" },
  atencao: { Icone: Clock, cor: "bg-atencao text-atencao-foreground" },
  sucesso: { Icone: Bell, cor: "bg-marca-claro text-marca" },
  neutro: { Icone: Bell, cor: "bg-muted text-muted-foreground" },
} as const;

function Avisos() {
  const qc = useQueryClient();
  const { papel } = usePapel();
  const listarFn = useServerFn(listarAvisos);
  const lidosFn = useServerFn(marcarAvisosLidosFn);
  const q = useQuery({
    queryKey: CHAVE_AVISOS,
    queryFn: () => listarFn(),
    refetchInterval: 60_000,
  });
  const avisos = q.data ?? [];
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Avisos"
        descricao={
          papel === "tecnico"
            ? "Serviços atrasados, sem técnico ou reagendados."
            : "O que precisa da atenção da equipe."
        }
        acao={
          temMarketingNovo ? (
            <Botao variante="contorno" onClick={() => void marcarLidos()}>
              <CheckCheck /> Lidos
            </Botao>
          ) : null
        }
      />

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : q.error ? (
        <Card className="text-center text-sm">
          {q.error instanceof Error ? q.error.message : "Erro ao carregar os avisos."}
        </Card>
      ) : avisos.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-marca-claro text-marca">
            <CheckCheck className="size-6" aria-hidden />
          </span>
          <p className="text-[15px] font-bold">Tudo em dia</p>
          <p className="max-w-xs text-sm text-muted-foreground">Nenhum aviso agora.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {avisos.map((a) => (
            <LinhaAviso key={a.id} a={a} agora={agora} />
          ))}
        </ul>
      )}

      {papel === "admin" || papel === "atendente" ? <WhatsappEquipe /> : null}
    </div>
  );
}

function LinhaAviso({ a, agora }: { a: Aviso; agora: Date }) {
  const { Icone, cor } = ICONE[a.tom];
  return (
    <li>
      <Link
        to={a.link.to as never}
        params={a.link.params as never}
        search={(a.link.search ?? {}) as never}
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
