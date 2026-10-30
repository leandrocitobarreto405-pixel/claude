// Barra de resposta da conversa (celular primeiro): texto dentro da janela de 24 h; fora dela, o
// seletor de modelos aprovados. Fica presa no rodapé, acima da barra de navegação. Se a conversa
// está com outra pessoa da equipe, qualquer toque na barra pergunta "Assumir mesmo assim?".
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, FileText, Image as ImagemIcone, Send, Zap } from "lucide-react";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MAX_TEXTO, classificarAnexo } from "@/lib/caixa";
import { prepararFoto } from "@/lib/imagem-heic";
import { marcarRespostaEmFoco, useRespostaEmFoco } from "@/lib/resposta-em-foco";
import { GravadorAudio } from "@/components/conversas/gravador-audio";
import { PainelRespostas } from "@/components/conversas/respostas-prontas";
import { listarRespostasFn } from "@/lib/respostas-prontas.functions";
import { filtrarRespostas, preencherResposta, type RespostaPronta } from "@/lib/respostas-prontas";
import { useContextoTenant } from "@/lib/tenant";
import { useProfile } from "@/lib/session";
import { iniciarEnvio } from "@/lib/envios-locais";
import { podeAvisarDigitando } from "@/lib/caixa-equipe";
import { assumirConversaFn, avisarDigitandoFn } from "@/lib/caixa-equipe.functions";
import {
  enviarAnexoFn,
  enviarModeloFn,
  enviarTextoFn,
  estadoRespostaFn,
  modelosParaResponderFn,
} from "@/lib/caixa.functions";
import { mensagemDeErro } from "@/lib/erros";
import { dateTimeBR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { intervalo } from "@/lib/ritmo";

export const CHAVE_ESTADO_RESPOSTA = (id: string) => ["conversas", "resposta", id] as const;

export function BarraResposta({
  conversaId,
  onEnviou,
  colega = null,
  onAssumiu,
}: {
  conversaId: string;
  onEnviou: () => void;
  /** Primeiro nome de quem está com a conversa, quando é outra pessoa da equipe. */
  colega?: string | null;
  onAssumiu?: () => void;
}) {
  const qc = useQueryClient();
  const estadoFn = useServerFn(estadoRespostaFn);
  const textoFn = useServerFn(enviarTextoFn);
  const modelosFn = useServerFn(modelosParaResponderFn);
  const modeloFn = useServerFn(enviarModeloFn);
  const anexoFn = useServerFn(enviarAnexoFn);
  const fotoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const estado = useQuery({
    queryKey: CHAVE_ESTADO_RESPOSTA(conversaId),
    queryFn: () => estadoFn({ data: { conversaId } }),
    refetchInterval: intervalo(60_000),
  });
  const e = estado.data;
  const foraDaJanela = Boolean(e && e.podeResponder && e.situacao.pode && !e.janela.aberta);
  const modelos = useQuery({
    queryKey: ["conversas", "modelos", conversaId],
    queryFn: () => modelosFn({ data: { conversaId } }),
    enabled: foraDaJanela,
    staleTime: 10 * 60_000,
  });

  const [texto, setTexto] = useState("");
  // Respostas prontas: "/" no começo do campo abre a lista filtrada; o botão abre com busca.
  const respostasFn = useServerFn(listarRespostasFn);
  const respostas = useQuery({
    queryKey: ["respostas-prontas"],
    queryFn: () => respostasFn(),
    staleTime: 5 * 60_000,
  });
  const { data: tenant } = useContextoTenant();
  const perfil = useProfile();
  const [painelBotao, setPainelBotao] = useState(false);
  const [buscaBotao, setBuscaBotao] = useState("");
  const [fechadoEm, setFechadoEm] = useState<string | null>(null);
  const comBarra = texto.startsWith("/") && !texto.includes("\n") && fechadoEm !== texto;
  const painelAberto = painelBotao || comBarra;
  function escolherResposta(r: RespostaPronta) {
    const pronto = preencherResposta(r.texto, {
      nome: e?.nomeCliente ?? null,
      empresa: tenant?.ativa?.empresa.nome ?? null,
      atendente: perfil?.full_name ? perfil.full_name.trim().split(/\s+/)[0]! : null,
    });
    // Pela barra, a resposta toma o lugar do "/atalho"; pelo botão, entra no fim do que já há.
    setTexto((atual) =>
      painelBotao && !atual.startsWith("/")
        ? atual.trim()
          ? `${atual.replace(/\s+$/, "")} ${pronto}`
          : pronto
        : pronto,
    );
    setPainelBotao(false);
    setBuscaBotao("");
    setTimeout(() => areaRef.current?.focus(), 30);
  }
  function fecharPainel() {
    setPainelBotao(false);
    setBuscaBotao("");
    if (comBarra) setFechadoEm(texto);
  }
  const [modelo, setModelo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const emFoco = useRespostaEmFoco();

  // Duas atendentes: com a conversa nas mãos de uma colega, a barra pergunta antes de qualquer
  // coisa (focar, gravar, anexar, enviar) e só libera depois de assumir.
  const assumirFn = useServerFn(assumirConversaFn);
  const [perguntando, setPerguntando] = useState(false);
  const [assumindo, setAssumindo] = useState(false);
  function comColega(): boolean {
    if (!colega) return false;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setPerguntando(true);
    return true;
  }
  async function assumirAgora() {
    setAssumindo(true);
    try {
      const r = await assumirFn({ data: { conversaId } });
      toast.success(`Agora a conversa é sua (estava com ${colega}).`);
      if (!r.noChatwoot)
        toast.info("No Chatwoot ela fica sem responsável (você não tem usuário lá).");
      setPerguntando(false);
      onAssumiu?.();
      setTimeout(() => areaRef.current?.focus(), 50);
    } catch (err) {
      toast.error(mensagemDeErro(err, "Não foi possível assumir.", "caixa"));
    } finally {
      setAssumindo(false);
    }
  }

  // Teclado aberto ou gravando: a navegação inferior some e a barra cola no teclado.
  useEffect(() => {
    if (gravando) marcarRespostaEmFoco(true);
    else if (!raizRef.current?.contains(document.activeElement)) marcarRespostaEmFoco(false);
  }, [gravando]);
  useEffect(() => () => marcarRespostaEmFoco(false), []);
  // "Digitando…" e lido na Meta: ao focar a barra ou começar a gravar, no máximo 1x a cada 20 s.
  const digitandoFn = useServerFn(avisarDigitandoFn);
  const ultimoDigitando = useRef<number | null>(null);
  const avisouFalha = useRef(false);
  function avisarDigitando() {
    const agora = Date.now();
    if (!podeAvisarDigitando(ultimoDigitando.current, agora)) return;
    ultimoDigitando.current = agora;
    void digitandoFn({ data: { conversaId } })
      .then((r) => {
        // Falha aparece uma vez por conversa, para a equipe saber o motivo (desligado não avisa).
        if (!r.ok && r.motivo !== "desligado" && !avisouFalha.current) {
          avisouFalha.current = true;
          toast.error(
            `"Digitando…" não foi: ${r.detalhe ?? r.motivo ?? "sem detalhe"}. Veja em Configurações › Mensagens.`,
          );
        }
      })
      .catch(() => undefined);
  }
  useEffect(() => {
    if (gravando) avisarDigitando();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gravando]);
  function focou() {
    if (comColega()) return;
    marcarRespostaEmFoco(true);
    avisarDigitando();
  }
  function desfocou() {
    // Espera o foco pousar: tocar num botão da própria barra não deve fazer a navegação piscar.
    setTimeout(() => {
      if (gravando) return;
      if (!raizRef.current?.contains(document.activeElement)) marcarRespostaEmFoco(false);
    }, 150);
  }

  // Cresce com o texto até ~5 linhas.
  useEffect(() => {
    const a = areaRef.current;
    if (!a) return;
    a.style.height = "auto";
    a.style.height = `${Math.min(a.scrollHeight, 140)}px`;
  }, [texto]);

  async function enviar(acao: () => Promise<unknown>) {
    if (comColega()) return;
    setEnviando(true);
    try {
      await acao();
      setTexto("");
      setModelo("");
      onEnviou();
      void qc.invalidateQueries({ queryKey: CHAVE_ESTADO_RESPOSTA(conversaId) });
    } catch (err) {
      toast.error(mensagemDeErro(err, "Não foi possível enviar.", "caixa"));
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Anexo (áudio, foto, documento): o balão aparece na conversa na hora, como "enviando", e o
   * envio corre por fora da barra (que continua livre). Confirmação e falha ficam no balão.
   */
  function enviarArquivo(tipo: "imagem" | "documento" | "audio", arquivo: File) {
    if (comColega()) return;
    iniciarEnvio({
      conversaId,
      tipo,
      arquivo,
      enviar: async (original) => {
        // Qualquer imagem vai como foto (HEIC convertido para JPG).
        const pronto = tipo === "imagem" ? await prepararFoto(original) : original;
        const fd = new FormData();
        fd.append("conversaId", conversaId);
        fd.append("tipo", tipo);
        fd.append("arquivo", pronto, pronto.name);
        return anexoFn({ data: fd });
      },
      aoTerminar: () => {
        onEnviou();
        void qc.invalidateQueries({ queryKey: CHAVE_ESTADO_RESPOSTA(conversaId) });
      },
    });
  }

  /** Imagem vai como foto; o resto, como documento. */
  function escolheuArquivo(arquivo: File) {
    const tipo = classificarAnexo(arquivo.name, arquivo.type);
    enviarArquivo(tipo === "documento" ? "documento" : "imagem", arquivo);
  }

  if (!e) return null;
  if (!e.podeResponder) return null;

  // A barra fica embaixo da tela da conversa (que só rola as mensagens): sem posição grudada,
  // sem margens negativas. No iPhone, respeita a área da barra de gestos.
  const base = cn(
    "border-t border-border bg-background px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] lg:px-6 lg:pb-3",
    emFoco && "pb-2",
  );

  if (!e.situacao.pode) {
    return (
      <div className={cn(base, "text-sm text-muted-foreground")}>
        A conversa está com a Alice. Toque em <strong>Assumir a conversa</strong> para responder.
      </div>
    );
  }

  if (!e.janela.aberta) {
    const lista = modelos.data ?? [];
    const escolhido = lista.find((m) => `${m.nome}|${m.idioma}` === modelo);
    return (
      <div className={cn(base, "flex flex-col gap-2")}>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          {e.janela.motivo === "passou_24h"
            ? "Passou 24 h desde a última mensagem do cliente: só modelo aprovado."
            : "O cliente ainda não escreveu: só modelo aprovado."}
        </p>
        {modelos.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando modelos…</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum modelo aprovado que sirva para esta conversa. Cadastre um em Configurações ›
            Modelos de mensagem.
          </p>
        ) : (
          <>
            <label className="sr-only" htmlFor="modelo-resposta">
              Modelo
            </label>
            <select
              id="modelo-resposta"
              className="min-h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
              value={modelo}
              onChange={(ev) => setModelo(ev.target.value)}
            >
              <option value="">Escolha o modelo…</option>
              {lista.map((m) => (
                <option key={`${m.nome}|${m.idioma}`} value={`${m.nome}|${m.idioma}`}>
                  {m.nome}
                </option>
              ))}
            </select>
            {escolhido ? (
              <p className="rounded-card border border-border bg-card px-3 py-2 text-sm whitespace-pre-wrap">
                {escolhido.texto}
              </p>
            ) : null}
            <Botao
              larguraTotal
              disabled={!escolhido || enviando}
              onClick={() =>
                escolhido &&
                void enviar(() =>
                  modeloFn({
                    data: { conversaId, nome: escolhido.nome, idioma: escolhido.idioma },
                  }),
                )
              }
            >
              <Send aria-hidden /> {enviando ? "Enviando…" : "Enviar modelo"}
            </Botao>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={raizRef}
      className={cn(base, "relative flex flex-col gap-1")}
      onFocusCapture={focou}
      onBlurCapture={desfocou}
    >
      {painelAberto ? (
        <PainelRespostas
          itens={respostas.data?.itens ?? []}
          carregando={respostas.isLoading}
          filtro={painelBotao ? buscaBotao : texto.slice(1)}
          comBusca={painelBotao}
          aoMudarBusca={setBuscaBotao}
          aoEscolher={escolherResposta}
          aoFechar={fecharPainel}
          podeEditar={tenant?.ativa?.papel === "admin"}
        />
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <input
          ref={fotoRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = "";
            if (f) escolheuArquivo(f);
          }}
        />
        <input
          ref={docRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,image/*,.heic,.heif"
          className="hidden"
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = "";
            if (f) escolheuArquivo(f);
          }}
        />
        <Botao
          variante="neutro"
          tamanho="icone"
          aria-label="Enviar foto"
          onClick={() => comColega() || fotoRef.current?.click()}
        >
          <ImagemIcone aria-hidden />
        </Botao>
        <Botao
          variante="neutro"
          tamanho="icone"
          aria-label="Enviar documento"
          onClick={() => comColega() || docRef.current?.click()}
        >
          <FileText aria-hidden />
        </Botao>
        <span
          className="contents"
          onClickCapture={(ev) => {
            if (!gravando && comColega()) ev.stopPropagation();
          }}
        >
          <GravadorAudio
            desabilitado={false}
            aoGravar={(f) => enviarArquivo("audio", f)}
            aoMudarGravacao={setGravando}
          />
        </span>
        <div className="relative flex min-w-0 flex-1">
          <button
            type="button"
            aria-label="Respostas prontas"
            title='Respostas prontas (ou digite "/")'
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => {
              if (comColega()) return;
              setPainelBotao((v) => !v);
            }}
            className="absolute bottom-0 left-0 z-10 grid size-11 place-items-center rounded-full text-muted-foreground hover:text-marca"
          >
            <Zap className="size-[18px]" aria-hidden />
          </button>
          <textarea
            ref={areaRef}
            aria-label="Mensagem"
            placeholder="Mensagem"
            rows={1}
            maxLength={MAX_TEXTO}
            value={texto}
            disabled={enviando}
            onChange={(ev) => setTexto(ev.target.value)}
            onKeyDown={(ev) => {
              // Enter no computador envia; no celular o teclado quebra linha e o botão envia.
              if (ev.key === "Escape" && painelAberto) {
                ev.preventDefault();
                fecharPainel();
                return;
              }
              if (
                ev.key === "Enter" &&
                !ev.shiftKey &&
                window.matchMedia("(min-width: 768px)").matches
              ) {
                if (comBarra) {
                  ev.preventDefault();
                  const primeira = filtrarRespostas(respostas.data?.itens ?? [], texto.slice(1))[0];
                  if (primeira) escolherResposta(primeira);
                  return;
                }
                ev.preventDefault();
                if (texto.trim()) void enviar(() => textoFn({ data: { conversaId, texto } }));
              }
            }}
            className="min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-input bg-card py-2.5 pr-4 pl-10 text-base leading-snug focus-visible:ring-2 focus-visible:ring-marca focus-visible:outline-none"
          />
        </div>
        <Botao
          tamanho="icone"
          aria-label="Enviar"
          disabled={!texto.trim() || enviando}
          onClick={() => void enviar(() => textoFn({ data: { conversaId, texto } }))}
        >
          <Send aria-hidden />
        </Botao>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {enviando ? "Enviando… " : ""}Janela aberta até {dateTimeBR(e.janela.fechaEm)}.
      </p>
      <AlertDialog
        open={perguntando}
        onOpenChange={(aberto) => !assumindo && setPerguntando(aberto)}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-card">
          <AlertDialogHeader>
            <AlertDialogTitle>A {colega} está nesta conversa.</AlertDialogTitle>
            <AlertDialogDescription>
              Assumir mesmo assim? A conversa passa para você e sai das "Minhas" de {colega}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="min-h-11" disabled={assumindo}>
              Só olhar
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-marca text-marca-foreground hover:bg-marca/90"
              disabled={assumindo}
              onClick={(ev) => {
                ev.preventDefault();
                void assumirAgora();
              }}
            >
              {assumindo ? "Assumindo…" : "Assumir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
