// Barra de resposta da conversa (celular primeiro): texto dentro da janela de 24 h; fora dela, o
// seletor de modelos aprovados. Fica presa no rodapé, acima da barra de navegação.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, FileText, Image as ImagemIcone, Send } from "lucide-react";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import { MAX_TEXTO, classificarAnexo } from "@/lib/caixa";
import { prepararFoto } from "@/lib/imagem-heic";
import { marcarRespostaEmFoco, useRespostaEmFoco } from "@/lib/resposta-em-foco";
import { GravadorAudio } from "@/components/conversas/gravador-audio";
import { iniciarEnvio } from "@/lib/envios-locais";
import { podeAvisarDigitando } from "@/lib/caixa-equipe";
import { avisarDigitandoFn } from "@/lib/caixa-equipe.functions";
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

export const CHAVE_ESTADO_RESPOSTA = (id: string) => ["conversas", "resposta", id] as const;

export function BarraResposta({
  conversaId,
  onEnviou,
}: {
  conversaId: string;
  onEnviou: () => void;
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
    refetchInterval: 60_000,
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
  const [modelo, setModelo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const emFoco = useRespostaEmFoco();

  // Teclado aberto ou gravando: a navegação inferior some e a barra cola no teclado.
  useEffect(() => {
    if (gravando) marcarRespostaEmFoco(true);
    else if (!raizRef.current?.contains(document.activeElement)) marcarRespostaEmFoco(false);
  }, [gravando]);
  useEffect(() => () => marcarRespostaEmFoco(false), []);
  // "Digitando…" e lido na Meta: ao focar a barra ou começar a gravar, no máximo 1x a cada 20 s.
  const digitandoFn = useServerFn(avisarDigitandoFn);
  const ultimoDigitando = useRef<number | null>(null);
  function avisarDigitando() {
    const agora = Date.now();
    if (!podeAvisarDigitando(ultimoDigitando.current, agora)) return;
    ultimoDigitando.current = agora;
    void digitandoFn({ data: { conversaId } }).catch(() => undefined);
  }
  useEffect(() => {
    if (gravando) avisarDigitando();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gravando]);
  function focou() {
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

  const base = cn(
    "sticky z-10 -mx-4 border-t border-border bg-background px-4 pt-2 pb-2 lg:static lg:mx-0 lg:rounded-card lg:border lg:p-3",
    emFoco
      ? "bottom-0 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
      : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]",
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
      className={cn(base, "flex flex-col gap-1")}
      onFocusCapture={focou}
      onBlurCapture={desfocou}
    >
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
          onClick={() => fotoRef.current?.click()}
        >
          <ImagemIcone aria-hidden />
        </Botao>
        <Botao
          variante="neutro"
          tamanho="icone"
          aria-label="Enviar documento"
          onClick={() => docRef.current?.click()}
        >
          <FileText aria-hidden />
        </Botao>
        <GravadorAudio
          desabilitado={false}
          aoGravar={(f) => enviarArquivo("audio", f)}
          aoMudarGravacao={setGravando}
        />
        <textarea
          ref={areaRef}
          aria-label="Mensagem"
          placeholder="Escreva a resposta…"
          rows={1}
          maxLength={MAX_TEXTO}
          value={texto}
          disabled={enviando}
          onChange={(ev) => setTexto(ev.target.value)}
          onKeyDown={(ev) => {
            // Enter no computador envia; no celular o teclado quebra linha e o botão envia.
            if (
              ev.key === "Enter" &&
              !ev.shiftKey &&
              window.matchMedia("(min-width: 768px)").matches
            ) {
              ev.preventDefault();
              if (texto.trim()) void enviar(() => textoFn({ data: { conversaId, texto } }));
            }
          }}
          className="min-h-11 flex-1 resize-none rounded-[22px] border border-input bg-card px-4 py-2.5 text-[15px] leading-snug focus-visible:ring-2 focus-visible:ring-marca focus-visible:outline-none"
        />
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
    </div>
  );
}
