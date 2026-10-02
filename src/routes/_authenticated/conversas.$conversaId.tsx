import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CabecalhoDeTela, Card } from "@/components/nexa";
import { AcoesConversa } from "@/components/conversas/acoes-conversa";
import { Avatar, EtiquetasConversa } from "@/components/conversas/cartao-conversa";
import { lerConversa } from "@/lib/conversas.functions";
import { dateTimeBR } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conversas/$conversaId")({
  head: () => ({ meta: [{ title: "Conversa — Nexa OS" }] }),
  component: Conversa,
});

const NOME_GRUPO = {
  precisam: "Esperando a equipe",
  alice: "Com a Alice",
  equipe: "Com a equipe",
  finalizadas: "Finalizada",
} as const;

function Conversa() {
  const { conversaId } = Route.useParams();
  const qc = useQueryClient();
  const lerFn = useServerFn(lerConversa);
  const q = useQuery({
    queryKey: ["conversas", "uma", conversaId],
    queryFn: () => lerFn({ data: { conversaId } }),
    refetchInterval: 20_000,
  });
  const c = q.data;

  function mudou() {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ["conversas", "lista"] });
    void qc.invalidateQueries({ queryKey: ["alice_resumo_hoje"] });
  }

  if (!c) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <CabecalhoDeTela voltarPara="/conversas" titulo="Conversa" />
        <p className="text-sm text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "Carregando…"}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela voltarPara="/conversas" sobretitulo={NOME_GRUPO[c.grupo]} titulo={c.nome} />

      <Card className="gap-3">
        <div className="flex items-center gap-3">
          <Avatar nome={c.nome} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm text-muted-foreground">
              {c.telefone ?? "Sem telefone"}
            </span>
            <span className="flex flex-wrap gap-1.5">
              <EtiquetasConversa c={c} />
            </span>
          </div>
        </div>
        {c.passagem?.resumo ? (
          <div className="rounded-botao bg-atencao px-3 py-2.5 text-sm text-atencao-foreground">
            <p className="font-bold">A Alice passou para a equipe: {c.passagem.motivo}</p>
            <p className="mt-0.5">{c.passagem.resumo}</p>
          </div>
        ) : null}
        <AcoesConversa c={c} onMudou={mudou} />
      </Card>

      <section aria-label="Mensagens" className="flex flex-col gap-2">
        {c.mensagens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mensagem registrada ainda.</p>
        ) : (
          c.mensagens.map((m) => (
            <div key={m.id} className={cn("flex", m.doCliente ? "justify-start" : "justify-end")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-card px-3.5 py-2.5 text-[15px] leading-snug",
                  m.doCliente
                    ? "rounded-bl-md border border-border bg-card"
                    : "rounded-br-md bg-marca-claro text-foreground",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {dateTimeBR(m.em)}
                </p>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
