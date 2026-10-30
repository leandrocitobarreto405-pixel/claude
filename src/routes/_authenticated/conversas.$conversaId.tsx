import { useEffect, useLayoutEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarraResposta } from "@/components/conversas/barra-resposta";
import { CabecalhoConversa } from "@/components/conversas/cabecalho-conversa";
import { useVoltarParaLista } from "@/components/conversas/voltar-para-lista";
import { FaixaColega } from "@/components/conversas/faixa-colega";
import { lerConversa } from "@/lib/conversas.functions";
import { marcarLidaFn } from "@/lib/caixa-equipe.functions";
import { useTempoRealConversas } from "@/lib/conversas-tempo-real";
import { useAvisarPresenca, useColegasNaConversa } from "@/lib/presenca";
import { primeiroNome } from "@/lib/caixa-equipe";
import { useSession } from "@/lib/session";
import { useAreaVisivel, useEhPc } from "@/lib/conversas-tela";
import { casarEnvios, useEnviosLocais } from "@/lib/envios-locais";
import { MidiaLocal, BalaoEnvioLocal } from "@/components/conversas/balao-envio-local";
import { AudioMensagem, ImagemMensagem } from "@/components/conversas/anexo-mensagem";
import { ehAudio, ehImagem } from "@/lib/conversas";
import { dateTimeBR } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conversas/$conversaId")({
  validateSearch: (search: Record<string, unknown>): { texto?: string } =>
    typeof search["texto"] === "string"
      ? { texto: (search["texto"] as string).slice(0, 1000) }
      : {},
  head: () => ({ meta: [{ title: "Conversa — Nexa OS" }] }),
  component: Conversa,
});

/** "✓ enviada", "✓✓ entregue", "✓✓ lida" ou "falhou" (vazio quando o Chatwoot não informa). */
function StatusEnvio({ status, minha }: { status: string | null; minha: boolean }) {
  const texto =
    status === "enviada"
      ? "✓ enviada"
      : status === "entregue"
        ? "✓✓ entregue"
        : status === "lida"
          ? "✓✓ lida"
          : status === "falhou"
            ? "falhou"
            : null;
  if (!texto && !minha) return null;
  return (
    <span className={cn("ml-2", status === "falhou" && "font-semibold text-problema-foreground")}>
      {minha ? "você" : ""}
      {minha && texto ? " · " : ""}
      {texto}
    </span>
  );
}

/**
 * Abre a conversa já no fim (última mensagem) e, quando chega mensagem nova, rola para o fim se
 * a pessoa já estava lá; se estava lendo mensagens antigas, não puxa a tela. Só a área das
 * mensagens rola (a barra de cima e a de resposta ficam paradas).
 */
function useRolarParaOFim(total: number | undefined) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const primeira = useRef(true);
  const noFim = useRef(true);
  const ultimoTotal = useRef<number | undefined>(undefined);
  const carregou = total !== undefined;
  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const aoRolar = () => {
      noFim.current = caixa.scrollTop + caixa.clientHeight >= caixa.scrollHeight - 160;
    };
    caixa.addEventListener("scroll", aoRolar, { passive: true });
    return () => caixa.removeEventListener("scroll", aoRolar);
  }, [carregou]);
  useLayoutEffect(() => {
    const caixa = caixaRef.current;
    if (total === undefined || !caixa) return;
    const rolar = (suave: boolean) =>
      caixa.scrollTo({ top: caixa.scrollHeight, behavior: suave ? "smooth" : "auto" });
    if (primeira.current) {
      primeira.current = false;
      rolar(false);
      // Imagens e fontes ainda carregando mudam a altura: repete logo depois.
      const t = setTimeout(() => rolar(false), 250);
      ultimoTotal.current = total;
      return () => clearTimeout(t);
    }
    if (ultimoTotal.current !== undefined && total > ultimoTotal.current && noFim.current)
      rolar(true);
    ultimoTotal.current = total;
    return undefined;
  }, [total]);
  return caixaRef;
}

const ETIQUETA_REMETENTE = { alice: "Alice", voce: "você", equipe: "equipe", cliente: "" } as const;

function Conversa() {
  const { conversaId } = Route.useParams();
  const { texto: textoDaTarefa } = Route.useSearch();
  const qc = useQueryClient();
  const lerFn = useServerFn(lerConversa);
  const q = useQuery({
    queryKey: ["conversas", "uma", conversaId],
    queryFn: () => lerFn({ data: { conversaId } }),
    // Tempo real pelo Realtime; o refetch é só garantia (e para quem tem várias empresas).
    refetchInterval: 30_000,
  });
  useTempoRealConversas();
  const c = q.data;
  // Duas atendentes: aviso que estou aqui e vejo quem mais está (item 4).
  useAvisarPresenca(c?.id);
  const { user } = useSession();
  const colegas = useColegasNaConversa(conversaId, user?.id ?? null);
  // Anexos que esta pessoa acabou de mandar: balão na hora ("enviando"), mídia local dentro do
  // balão quando o servidor confirma, "falhou" com tentar de novo.
  const locais = useEnviosLocais(conversaId);
  const { porChatwootId, soltos } = casarEnvios(
    locais,
    (c?.mensagens ?? []).map((m) => m.chatwootId),
  );
  const caixaRef = useRolarParaOFim(c ? c.mensagens.length + soltos.length : undefined);
  // Abrir (e cada mensagem nova enquanto aberta) marca a conversa como lida para mim.
  const marcarLida = useServerFn(marcarLidaFn);
  const totalMensagens = c?.mensagens.length ?? 0;
  useEffect(() => {
    if (!c) return;
    void marcarLida({ data: { conversaId } })
      .then(() => qc.invalidateQueries({ queryKey: ["conversas", "lista"] }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaId, totalMensagens, Boolean(c)]);
  const ehPc = useEhPc();
  const area = useAreaVisivel();
  const voltar = useVoltarParaLista();

  function mudou() {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ["conversas", "lista"] });
    void qc.invalidateQueries({ queryKey: ["alice_resumo_hoje"] });
  }

  // Celular: a conversa ocupa a área visível (com o teclado aberto, encolhe junto) e só as
  // mensagens rolam. PC: ocupa a coluna da direita.
  const estiloTela =
    !ehPc && area.altura !== null ? { top: area.topo, height: area.altura } : undefined;
  const classeTela =
    "fixed inset-x-0 top-0 z-30 flex h-dvh flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] lg:static lg:z-auto lg:h-full lg:pt-0";

  if (!c) {
    return (
      <div className={classeTela} style={estiloTela}>
        <div className="flex min-h-14 items-center gap-1 border-b border-border bg-card px-1">
          <button
            type="button"
            onClick={voltar}
            aria-label="Voltar para a lista"
            className="grid size-11 place-items-center rounded-full hover:bg-muted lg:hidden"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <span className="text-[15px] font-bold">Conversa</span>
        </div>
        <p className="p-4 text-sm text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "Carregando…"}
        </p>
      </div>
    );
  }

  return (
    <div className={classeTela} style={estiloTela}>
      <div className="shrink-0">
        <CabecalhoConversa c={c} onMudou={mudou} />
        {colegas.length > 0 || c.posse === "outra" ? (
          <div className="border-b border-border bg-background px-3 py-2">
            <FaixaColega c={c} colegas={colegas} />
          </div>
        ) : null}
      </div>

      <section
        ref={caixaRef}
        aria-label="Mensagens"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3 lg:px-6"
      >
        {c.passagem?.resumo ? (
          <div className="rounded-botao bg-atencao px-3 py-2.5 text-sm text-atencao-foreground">
            <p className="font-bold">A Alice passou para a equipe: {c.passagem.motivo}</p>
            <p className="mt-0.5">{c.passagem.resumo}</p>
          </div>
        ) : null}
        {c.mensagens.length === 0 && soltos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mensagem registrada ainda.</p>
        ) : (
          c.mensagens.map((m) => (
            <div
              key={m.id}
              className={cn("flex w-full", m.doCliente ? "justify-start pr-8" : "justify-end pl-8")}
            >
              <div
                className={cn(
                  "min-w-0 max-w-[85%] rounded-card px-3.5 py-2.5 text-[15px] leading-snug",
                  m.doCliente
                    ? "mr-auto rounded-bl-md border border-border bg-card"
                    : "ml-auto rounded-br-md bg-marca-claro text-foreground",
                )}
              >
                {m.doCliente ? null : (
                  <p className="mb-0.5 text-[11px] font-semibold text-marca">
                    {ETIQUETA_REMETENTE[m.remetente]}
                  </p>
                )}
                {m.chatwootId != null && porChatwootId.has(m.chatwootId) ? (
                  <MidiaLocal envio={porChatwootId.get(m.chatwootId)!} />
                ) : ehAudio(m.tipo) ? (
                  <AudioMensagem mensagemId={m.id} transcricao={m.texto} />
                ) : ehImagem(m.tipo) ? (
                  <ImagemMensagem mensagemId={m.id} legenda={m.texto} />
                ) : (
                  <p className="break-words whitespace-pre-wrap">{m.texto}</p>
                )}
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {dateTimeBR(m.em)}
                  {m.doCliente ? null : <StatusEnvio status={m.status} minha={false} />}
                </p>
                {m.status === "falhou" && m.erro ? (
                  <p className="mt-0.5 text-[11px] text-problema-foreground">{m.erro}</p>
                ) : null}
              </div>
            </div>
          ))
        )}
        {soltos.map((e) => (
          <BalaoEnvioLocal key={e.id} envio={e} />
        ))}
      </section>

      <div className="shrink-0">
        <BarraResposta
          conversaId={c.id}
          onEnviou={mudou}
          colega={c.posse === "outra" ? primeiroNome(c.responsavelNome) : null}
          onAssumiu={mudou}
          textoInicial={textoDaTarefa ?? ""}
        />
      </div>
    </div>
  );
}
