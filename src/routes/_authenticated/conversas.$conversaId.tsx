import { useEffect, useLayoutEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TirarAlice } from "@/components/tirar-alice";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CabecalhoDeTela, Card } from "@/components/nexa";
import { AcoesConversa } from "@/components/conversas/acoes-conversa";
import { BotaoEncerrar } from "@/components/conversas/encerrar-conversa";
import { BarraResposta } from "@/components/conversas/barra-resposta";
import { FaixaColega } from "@/components/conversas/faixa-colega";
import { usePapel } from "@/lib/tenant";
import { Avatar, EtiquetasConversa } from "@/components/conversas/cartao-conversa";
import { lerConversa } from "@/lib/conversas.functions";
import { marcarLidaFn } from "@/lib/caixa-equipe.functions";
import { useTempoRealConversas } from "@/lib/conversas-tempo-real";
import { useAvisarPresenca, useColegasNaConversa } from "@/lib/presenca";
import { primeiroNome } from "@/lib/caixa-equipe";
import { useSession } from "@/lib/session";
import { casarEnvios, useEnviosLocais } from "@/lib/envios-locais";
import { MidiaLocal, BalaoEnvioLocal } from "@/components/conversas/balao-envio-local";
import { AudioMensagem, ImagemMensagem } from "@/components/conversas/anexo-mensagem";
import { ehAudio, ehImagem } from "@/lib/conversas";
import { dateTimeBR } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conversas/$conversaId")({
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
 * a pessoa já estava lá; se estava lendo mensagens antigas, não puxa a tela.
 */
function useRolarParaOFim(total: number | undefined) {
  const fimRef = useRef<HTMLDivElement>(null);
  const primeira = useRef(true);
  const noFim = useRef(true);
  const ultimoTotal = useRef<number | undefined>(undefined);
  useEffect(() => {
    const aoRolar = () => {
      const alturaDoc = document.documentElement.scrollHeight;
      noFim.current = window.innerHeight + window.scrollY >= alturaDoc - 160;
    };
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);
  useLayoutEffect(() => {
    if (total === undefined) return;
    const rolar = (suave: boolean) =>
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: suave ? "smooth" : "auto",
      });
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
  return fimRef;
}

const ETIQUETA_REMETENTE = { alice: "Alice", voce: "você", equipe: "equipe", cliente: "" } as const;

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
  const fimRef = useRolarParaOFim(c ? c.mensagens.length + soltos.length : undefined);
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
  const navigate = useNavigate();
  const { papel } = usePapel();
  const podeEncerrar = papel === "admin" || papel === "atendente";

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
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 overflow-x-clip">
      <CabecalhoDeTela voltarPara="/conversas" sobretitulo={NOME_GRUPO[c.grupo]} titulo={c.nome} />

      <Card className="gap-3">
        <div className="flex items-center gap-3">
          <Avatar nome={c.nome} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm text-muted-foreground">
              {c.telefone ?? "Sem telefone"}
            </span>
            {c.nomePerfil ? (
              <span className="truncate text-xs text-muted-foreground">
                Perfil no WhatsApp: {c.nomePerfil}
              </span>
            ) : null}
            <span className="flex flex-wrap gap-1.5">
              <EtiquetasConversa c={c} />
            </span>
          </div>
        </div>
        <FaixaColega c={c} colegas={colegas} />
        {c.passagem?.resumo ? (
          <div className="rounded-botao bg-atencao px-3 py-2.5 text-sm text-atencao-foreground">
            <p className="font-bold">A Alice passou para a equipe: {c.passagem.motivo}</p>
            <p className="mt-0.5">{c.passagem.resumo}</p>
          </div>
        ) : null}
        <AcoesConversa c={c} onMudou={mudou} />
        <div className="self-start">
          <TirarAlice conversaId={c.id} />
        </div>
        {podeEncerrar && c.grupo !== "finalizadas" ? (
          <BotaoEncerrar
            id={c.id}
            nome={c.nome}
            className="self-start"
            aoEncerrar={() => void navigate({ to: "/conversas", search: { aba: undefined } })}
          />
        ) : null}
      </Card>

      <section aria-label="Mensagens" className="flex flex-col gap-2">
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
        <div ref={fimRef} aria-hidden />
      </section>

      <BarraResposta
        conversaId={c.id}
        onEnviou={mudou}
        colega={c.posse === "outra" ? primeiroNome(c.responsavelNome) : null}
        onAssumiu={mudou}
      />
    </div>
  );
}
