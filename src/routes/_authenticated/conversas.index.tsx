import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle } from "lucide-react";
import { BadgeAlerta, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { CartaoConversa } from "@/components/conversas/cartao-conversa";
import { EncerrarParadas } from "@/components/conversas/encerrar-paradas";
import { usePapel } from "@/lib/tenant";
import { resumoAliceHoje } from "@/lib/alice.functions";
import type { GrupoConversa } from "@/lib/conversas";
import { listarConversas, type ConversaResumo } from "@/lib/conversas.functions";
import { cn } from "@/lib/utils";

export const CHAVE_CONVERSAS = ["conversas", "lista"] as const;

const ABAS: { id: GrupoConversa; rotulo: string; vazio: string }[] = [
  {
    id: "precisam",
    rotulo: "Precisam",
    vazio: "Nenhum cliente esperando a equipe. A Alice está dando conta.",
  },
  { id: "alice", rotulo: "Com a Alice", vazio: "Nenhuma conversa com a Alice agora." },
  { id: "equipe", rotulo: "Equipe", vazio: "Nenhuma conversa com a equipe nos últimos 7 dias." },
  {
    id: "finalizadas",
    rotulo: "Finalizadas",
    vazio: "Nenhuma conversa finalizada nos últimos 7 dias.",
  },
];

export const Route = createFileRoute("/_authenticated/conversas/")({
  validateSearch: (search: Record<string, unknown>) => {
    const aba = String(search["aba"] ?? "");
    return {
      aba: ABAS.some((a) => a.id === aba) ? (aba as GrupoConversa) : undefined,
    };
  },
  head: () => ({ meta: [{ title: "Conversas — Nexa OS" }] }),
  component: Conversas,
});

function Conversas() {
  const search = Route.useSearch();
  const listarFn = useServerFn(listarConversas);
  const resumoFn = useServerFn(resumoAliceHoje);
  const q = useQuery({
    queryKey: CHAVE_CONVERSAS,
    queryFn: () => listarFn(),
    refetchInterval: 30_000,
  });
  const alice = useQuery({
    queryKey: ["alice_resumo_hoje"],
    queryFn: () => resumoFn(),
    refetchInterval: 60_000,
  });
  const porGrupo = useMemo(() => {
    const m = new Map<GrupoConversa, ConversaResumo[]>();
    for (const c of q.data ?? []) m.set(c.grupo, [...(m.get(c.grupo) ?? []), c]);
    // Quem espera há mais tempo primeiro.
    m.set(
      "precisam",
      (m.get("precisam") ?? []).sort((a, b) =>
        (a.esperandoDesde ?? "").localeCompare(b.esperandoDesde ?? ""),
      ),
    );
    return m;
  }, [q.data]);

  const precisam = porGrupo.get("precisam")?.length ?? 0;
  const [aba, setAba] = useState<GrupoConversa>(
    search.aba ?? (precisam > 0 || !q.data ? "precisam" : "alice"),
  );
  const atual = ABAS.find((a) => a.id === aba)!;
  const itens = porGrupo.get(aba) ?? [];
  const agora = new Date();
  const { papel } = usePapel();
  const a = alice.data;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Conversas"
        descricao="Para responder, abra no WhatsApp ou no Chatwoot."
        acao={
          a ? (
            <Chip tom={a.ligada ? "sucesso" : "neutro"}>
              <span
                aria-hidden
                className={cn("size-2 rounded-full", a.ligada ? "bg-dado" : "bg-desligado")}
              />
              {a.ligada ? "Alice ligada" : "Alice desligada"}
            </Chip>
          ) : null
        }
      />

      {a ? (
        <p className="text-sm text-muted-foreground">
          Hoje: {a.respostasHoje} {a.respostasHoje === 1 ? "resposta" : "respostas"} da Alice ·{" "}
          {a.passagensHoje} {a.passagensHoje === 1 ? "passada" : "passadas"} para a equipe
        </p>
      ) : null}

      {papel === "admin" ? <EncerrarParadas /> : null}

      <div
        role="tablist"
        aria-label="Conversas"
        className="grid grid-cols-4 gap-1 rounded-botao bg-muted p-1"
      >
        {ABAS.map((t) => {
          const sel = t.id === aba;
          const n = porGrupo.get(t.id)?.length ?? 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => setAba(t.id)}
              className={cn(
                "relative flex min-h-11 items-center justify-center gap-1 rounded-[0.625rem] px-1 text-[13px] leading-tight",
                sel
                  ? "bg-card font-bold text-marca shadow-sm"
                  : "font-medium text-muted-foreground",
              )}
            >
              {t.rotulo}
              {t.id === "precisam" && n > 0 ? <BadgeAlerta numero={n} /> : null}
            </button>
          );
        })}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : q.error ? (
        <Card className="text-center">
          <p className="text-sm">
            {q.error instanceof Error ? q.error.message : "Erro ao carregar."}
          </p>
        </Card>
      ) : itens.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-marca-claro text-marca">
            <MessageCircle className="size-6" aria-hidden />
          </span>
          <p className="max-w-xs text-sm text-muted-foreground">{atual.vazio}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label={atual.rotulo}>
          {itens.map((c) => (
            <CartaoConversa key={c.id} c={c} agora={agora} />
          ))}
        </ul>
      )}
    </div>
  );
}
