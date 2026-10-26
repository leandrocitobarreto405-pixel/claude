// Configurações › Alice › Responder em áudio: provedor (Google | ElevenLabs), vozes da ElevenLabs em
// português do Brasil (prévia grátis e ouvir com a frase, que gera custo) e o modelo (Flash v2.5,
// mais barato | v4, melhor qualidade), com o custo de cada um comparado ao Google.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pause, Play, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import { cn } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import {
  CHAVE_AUDIO_ALICE,
  ouvirVozElevenAlice,
  vozesElevenAlice,
  type ConfigAudioForm,
} from "@/lib/alice-audio.functions";
import { custoElevenReais, custoReais, type ModeloEleven } from "@/lib/alice/voz";

const reais = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 3 });

/** Referência de custo: um áudio de 300 caracteres (~20 s). */
const CARACTERES_REF = 300;

const MODELOS: Array<{ id: ModeloEleven; nome: string; detalhe: string }> = [
  { id: "eleven_flash_v2_5", nome: "Flash v2.5", detalhe: "Mais barato e mais rápido" },
  { id: "eleven_v4", nome: "v4", detalhe: "Melhor qualidade (o dobro de créditos)" },
];

export function ProvedorAudio({
  c,
  aoMudar,
  configurada,
}: {
  c: ConfigAudioForm;
  aoMudar: (c: ConfigAudioForm) => void;
  configurada: boolean;
}) {
  return (
    <section className="card-surface space-y-3 p-5">
      <div>
        <h2 className="text-base font-semibold">Provedor da voz</h2>
        <p className="text-xs text-muted-foreground">
          O padrão é o Google. Com a ElevenLabs, se ela recusar um áudio (muitos pedidos seguidos ou
          limite do plano), aquele áudio sai pelo Google e fica registrado.
        </p>
      </div>
      <div role="radiogroup" aria-label="Provedor da voz" className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["google", "Google (Chirp 3 HD)"],
            ["elevenlabs", "ElevenLabs"],
          ] as const
        ).map(([id, nome]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={c.provedor === id}
            disabled={id === "elevenlabs" && !configurada}
            onClick={() => aoMudar({ ...c, provedor: id })}
            className={cn(
              "min-h-11 rounded-lg border px-3 text-left text-sm font-semibold disabled:opacity-50",
              c.provedor === id ? "border-marca bg-marca-claro" : "border-border bg-card",
            )}
          >
            {nome}
          </button>
        ))}
      </div>
      {!configurada ? (
        <p className="text-xs text-muted-foreground">
          A chave da ElevenLabs ainda não está no servidor: o provedor fica no Google.
        </p>
      ) : null}
    </section>
  );
}

export function VozesEleven({
  c,
  aoMudar,
  salvo,
  frase,
  usdPorMilCreditos,
  aoGastar,
}: {
  c: ConfigAudioForm;
  aoMudar: (c: ConfigAudioForm) => void;
  salvo: ConfigAudioForm;
  frase: string;
  usdPorMilCreditos: number;
  aoGastar: () => void;
}) {
  const lerVozes = useServerFn(vozesElevenAlice);
  const ouvirFn = useServerFn(ouvirVozElevenAlice);
  const vozes = useQuery({
    queryKey: [...CHAVE_AUDIO_ALICE, "vozes-eleven"],
    queryFn: () => lerVozes(),
    staleTime: 3600_000,
  });
  const [tocando, setTocando] = useState<string | null>(null);
  const [gerando, setGerando] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<string, string>());

  function tocar(chave: string, url: string) {
    audioRef.current?.pause();
    if (tocando === chave) {
      setTocando(null);
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setTocando(null);
    setTocando(chave);
    audio.play().catch(() => {
      setTocando(null);
      toast.error("O navegador não tocou o áudio. Tente de novo.");
    });
  }

  async function ouvirFrase(voz: string) {
    const chave = `${voz}|${c.eleven_modelo}|${frase}`;
    let url = cache.current.get(chave);
    if (!url) {
      setGerando(voz);
      try {
        const r = await ouvirFn({ data: { voz, modelo: c.eleven_modelo, frase } });
        const bytes = Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: r.tipo }));
        cache.current.set(chave, url);
        aoGastar();
      } catch (e) {
        toast.error(mensagemDeErro(e, "Não foi possível gerar o áudio.", "ouvir voz ElevenLabs"));
        return;
      } finally {
        setGerando(null);
      }
    }
    tocar(chave, url);
  }

  const cotacao = c.cotacao_dolar;
  const google = custoReais(CARACTERES_REF, cotacao);
  const lista = vozes.data?.vozes ?? [];

  return (
    <section className="card-surface space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">Voz da ElevenLabs</h2>
        <p className="text-xs text-muted-foreground">
          Vozes da conta da Nexa em português do Brasil. ▶ toca a prévia da voz (grátis); “Ouvir a
          frase” gera a frase de exemplo no modelo escolhido (gasta créditos).
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Modelo</h3>
        <div
          role="radiogroup"
          aria-label="Modelo da ElevenLabs"
          className="grid gap-2 sm:grid-cols-2"
        >
          {MODELOS.map((m) => {
            const custo = custoElevenReais(CARACTERES_REF, m.id, usdPorMilCreditos, cotacao);
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={c.eleven_modelo === m.id}
                onClick={() => aoMudar({ ...c, eleven_modelo: m.id })}
                className={cn(
                  "grid min-h-11 gap-0.5 rounded-lg border px-3 py-2 text-left text-sm",
                  c.eleven_modelo === m.id
                    ? "border-marca bg-marca-claro"
                    : "border-border bg-card",
                )}
              >
                <span className="font-semibold">{m.nome}</span>
                <span className="text-xs text-muted-foreground">
                  {m.detalhe} · {reais(custo)} por áudio de ~20 s ({(custo / google).toFixed(1)}× o
                  Google)
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Referência: áudio de {CARACTERES_REF} caracteres. Google: {reais(google)}. Preço da
          ElevenLabs: US$ {usdPorMilCreditos.toLocaleString("pt-BR")} por mil créditos (plano da
          conta; a Nexa ajusta).
        </p>
      </div>

      {vozes.isLoading ? <p className="text-sm text-muted-foreground">Carregando vozes…</p> : null}
      {vozes.data?.erro ? (
        <p className="rounded-md bg-atencao px-3 py-2 text-xs text-atencao-foreground">
          {vozes.data.erro}
        </p>
      ) : null}
      {!vozes.isLoading && !vozes.data?.erro && !lista.length ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma voz em português do Brasil na conta. Adicione pela biblioteca da ElevenLabs.
        </p>
      ) : null}
      <div role="radiogroup" aria-label="Vozes da ElevenLabs" className="grid gap-2">
        {lista.map((v) => {
          const escolhida = c.eleven_voz === v.id;
          return (
            <div
              key={v.id}
              className={cn(
                "flex min-h-11 flex-wrap items-center gap-2 rounded-lg border p-1.5 pl-3",
                escolhida ? "border-marca bg-marca-claro" : "border-border bg-card",
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={escolhida}
                className="min-h-11 min-w-0 flex-1 text-left text-sm"
                onClick={() => aoMudar({ ...c, eleven_voz: v.id })}
              >
                <span className="font-semibold">{v.nome}</span>
                {salvo.eleven_voz === v.id ? (
                  <span className="ml-2 text-xs text-muted-foreground">(salva)</span>
                ) : null}
                {v.descricao ? (
                  <span className="block text-xs text-muted-foreground">{v.descricao}</span>
                ) : null}
              </button>
              {v.previa ? (
                <Botao
                  variante="neutro"
                  tamanho="icone"
                  aria-label={
                    tocando === `previa|${v.id}` ? `Parar ${v.nome}` : `Prévia de ${v.nome}`
                  }
                  onClick={() => tocar(`previa|${v.id}`, v.previa!)}
                >
                  {tocando === `previa|${v.id}` ? <Pause aria-hidden /> : <Play aria-hidden />}
                </Botao>
              ) : null}
              <Botao
                variante="neutro"
                disabled={gerando !== null && gerando !== v.id}
                onClick={() => void ouvirFrase(v.id)}
              >
                <Volume2 aria-hidden />
                {gerando === v.id ? "Gerando…" : "Ouvir a frase"}
              </Botao>
            </div>
          );
        })}
      </div>
    </section>
  );
}
