// Configurações › Alice › Responder em áudio: provedor (Google | ElevenLabs), vozes (ouvir e
// escolher), limites, teste de envio para a equipe, botão Ativar e o custo de hoje/do mês.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pause, Play, Send } from "lucide-react";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import { FRASE_EXEMPLO, type Voz } from "@/lib/alice/voz";
import { ProvedorAudio, VozesEleven } from "@/components/configuracoes/alice-audio-eleven";
import {
  CHAVE_AUDIO_ALICE,
  ativarAudioAlice,
  contatosTesteAudio,
  enviarTesteAudioAlice,
  ouvirVozAlice,
  salvarAudioAlice,
  situacaoAudioAlice,
  vozesAlice,
  type ConfigAudioForm,
} from "@/lib/alice-audio.functions";

const reais = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");

type ChaveNumero = "max_caracteres" | "max_segundos" | "limite_diario_reais" | "cotacao_dolar";
const NUMEROS: Array<{ chave: ChaveNumero; rotulo: string; passo: string }> = [
  { chave: "max_caracteres", rotulo: "Máximo de caracteres falados", passo: "10" },
  { chave: "max_segundos", rotulo: "Máximo de segundos", passo: "1" },
  { chave: "limite_diario_reais", rotulo: "Limite por dia (R$)", passo: "0.5" },
  { chave: "cotacao_dolar", rotulo: "Cotação do dólar (R$)", passo: "0.05" },
];

export function AliceAudio() {
  const qc = useQueryClient();
  const ler = useServerFn(situacaoAudioAlice);
  const lerVozes = useServerFn(vozesAlice);
  const ouvirFn = useServerFn(ouvirVozAlice);
  const salvarFn = useServerFn(salvarAudioAlice);
  const ativarFn = useServerFn(ativarAudioAlice);
  const lerContatos = useServerFn(contatosTesteAudio);
  const testeFn = useServerFn(enviarTesteAudioAlice);

  const q = useQuery({ queryKey: [...CHAVE_AUDIO_ALICE], queryFn: () => ler() });
  const vozes = useQuery({
    queryKey: [...CHAVE_AUDIO_ALICE, "vozes"],
    queryFn: () => lerVozes(),
    staleTime: 3600_000,
  });
  const contatos = useQuery({
    queryKey: [...CHAVE_AUDIO_ALICE, "contatos"],
    queryFn: () => lerContatos(),
    retry: false,
  });

  const [c, setC] = useState<ConfigAudioForm | null>(null);
  const [frase, setFrase] = useState(FRASE_EXEMPLO);
  const [tocando, setTocando] = useState<string | null>(null);
  const [gerando, setGerando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [contatoTeste, setContatoTeste] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<string, string>());

  useEffect(() => {
    if (q.data) setC(q.data.config);
  }, [q.data]);
  useEffect(
    () => () => {
      audioRef.current?.pause();
      for (const url of cache.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  if (!c || !q.data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const { ativo, uso } = q.data;
  const salvo = q.data.config;
  const mudou = JSON.stringify(c) !== JSON.stringify(salvo);
  const eleven = c.provedor === "elevenlabs";
  const vozSalva = salvo.provedor === "elevenlabs" ? salvo.eleven_voz : salvo.voz;
  const atualizar = () => qc.invalidateQueries({ queryKey: [...CHAVE_AUDIO_ALICE] });

  async function ouvir(v: Voz) {
    if (tocando === v.nome) {
      audioRef.current?.pause();
      setTocando(null);
      return;
    }
    audioRef.current?.pause();
    const chave = `${v.nome}|${frase}`;
    let url = cache.current.get(chave);
    if (!url) {
      setGerando(v.nome);
      try {
        const { base64 } = await ouvirFn({ data: { voz: v.nome, frase } });
        const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: "audio/ogg" }));
        cache.current.set(chave, url);
        void atualizar();
      } catch (e) {
        toast.error(mensagemDeErro(e, "Não foi possível gerar o áudio.", "ouvir voz"));
        return;
      } finally {
        setGerando(null);
      }
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setTocando(null);
    setTocando(v.nome);
    audio.play().catch(() => {
      setTocando(null);
      toast.error("O navegador não tocou o áudio. Tente de novo.");
    });
  }

  async function executar(acao: () => Promise<unknown>, aviso: string) {
    setOcupado(true);
    try {
      await acao();
      await atualizar();
      toast.success(aviso);
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível concluir.", "áudio da Alice"));
    } finally {
      setOcupado(false);
    }
  }

  const lista = vozes.data?.vozes ?? [];
  const grupos: Array<[string, Voz[]]> = [
    ["Femininas", lista.filter((v) => v.genero === "feminina")],
    ["Masculinas", lista.filter((v) => v.genero === "masculina")],
  ];

  return (
    <div className="grid gap-5">
      <section className="card-surface space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Responder em áudio</h2>
            <p className="text-xs text-muted-foreground">
              Só quando o cliente mandou áudio, em respostas curtas e conversadas. Valores,
              orçamento, endereço, data e hora, links, Pix e listas vão sempre por escrito. O texto
              de cada áudio fica numa nota privada na conversa.
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold",
              ativo ? "bg-marca text-marca-foreground" : "bg-secondary text-muted-foreground",
            )}
          >
            {ativo ? "Ligado" : "Desligado"}
          </span>
        </div>
        <Botao
          variante={ativo ? "contorno" : "primario"}
          disabled={ocupado || (!ativo && (!vozSalva || mudou))}
          onClick={() =>
            void executar(
              () => ativarFn({ data: { ativo: !ativo } }),
              ativo ? "Resposta em áudio desligada." : "Resposta em áudio ativada.",
            )
          }
        >
          {ativo ? "Desativar" : "Ativar"}
        </Botao>
        {!ativo && (!vozSalva || mudou) ? (
          <p className="text-xs text-muted-foreground">
            Escolha a voz e salve antes de ativar. Faça o teste de envio para a equipe primeiro.
          </p>
        ) : null}
      </section>

      <section className="card-surface space-y-3 p-5">
        <h2 className="text-base font-semibold">Custo dos áudios</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Numero rotulo="Hoje" valor={reais(uso.hojeReais)} />
          <Numero rotulo="No mês" valor={reais(uso.mesReais)} />
          <Numero rotulo="Por conversa (mês)" valor={reais(uso.mediaPorConversaReais)} />
          <Numero
            rotulo="Áudios no mês"
            valor={`${uso.audiosMes} · ${uso.minutosMes.toLocaleString("pt-BR")} min`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Estimativa: Google US$ 30 por milhão de caracteres (vozes Chirp 3 HD), sem descontar a
          cota grátis; ElevenLabs pelos créditos do modelo e o preço do plano. Inclui os testes
          desta tela.
          {uso.falhasMes ? ` ${uso.falhasMes} falha(s) no mês: nesses casos foi o texto.` : ""}
        </p>
      </section>

      <ProvedorAudio c={c} aoMudar={setC} configurada={q.data.eleven.configurada} />

      {eleven ? (
        <VozesEleven
          c={c}
          aoMudar={setC}
          salvo={salvo}
          frase={frase}
          usdPorMilCreditos={q.data.eleven.usdPorMilCreditos}
          aoGastar={() => void atualizar()}
        />
      ) : null}

      <section className="card-surface space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">
            {eleven ? "Voz do Google (reserva)" : "Voz da Alice"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Vozes Chirp 3 HD em português do Brasil. Cada vez que você ouve uma voz nova custa cerca
            de {reais(0.02)}.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="audio-frase">Frase de exemplo</Label>
          <Textarea
            id="audio-frase"
            rows={2}
            maxLength={300}
            value={frase}
            onChange={(e) => setFrase(e.target.value)}
          />
        </div>
        {vozes.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando vozes…</p>
        ) : null}
        {vozes.data?.erro ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {vozes.data.erro} Mostrando a lista conhecida.
          </p>
        ) : null}
        {grupos.map(([titulo, vs]) =>
          vs.length ? (
            <div key={titulo} className="space-y-2">
              <h3 className="text-sm font-semibold">{titulo}</h3>
              <div
                role="radiogroup"
                aria-label={`Vozes ${titulo.toLowerCase()}`}
                className="grid gap-2 sm:grid-cols-2"
              >
                {vs.map((v) => {
                  const escolhida = c.voz === v.nome;
                  return (
                    <div
                      key={v.nome}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-lg border p-1.5 pl-3",
                        escolhida ? "border-marca bg-marca-claro" : "border-border bg-card",
                      )}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={escolhida}
                        className="min-h-11 flex-1 text-left text-sm font-semibold"
                        onClick={() => setC({ ...c, voz: v.nome })}
                      >
                        {v.rotulo}
                        {salvo.voz === v.nome ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            (salva)
                          </span>
                        ) : null}
                      </button>
                      <Botao
                        variante="neutro"
                        tamanho="icone"
                        aria-label={tocando === v.nome ? `Parar ${v.rotulo}` : `Ouvir ${v.rotulo}`}
                        disabled={gerando !== null && gerando !== v.nome}
                        onClick={() => void ouvir(v)}
                      >
                        {gerando === v.nome ? (
                          <span className="text-xs">…</span>
                        ) : tocando === v.nome ? (
                          <Pause aria-hidden />
                        ) : (
                          <Play aria-hidden />
                        )}
                      </Botao>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null,
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {NUMEROS.map((n) => (
            <div key={n.chave} className="space-y-2">
              <Label htmlFor={`audio-${n.chave}`}>{n.rotulo}</Label>
              <Input
                id={`audio-${n.chave}`}
                type="number"
                inputMode="decimal"
                step={n.passo}
                min={0}
                className="min-h-11"
                value={String(c[n.chave])}
                onChange={(e) => setC({ ...c, [n.chave]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Ao passar do limite do dia, a Alice volta a responder só por escrito até o dia seguinte e
          avisa a equipe no sininho do app.
        </p>
        <Botao
          disabled={ocupado || !mudou}
          onClick={() => void executar(() => salvarFn({ data: c }), "Resposta em áudio salva.")}
        >
          {ocupado ? "Salvando…" : "Salvar"}
        </Botao>
      </section>

      <section className="card-surface space-y-3 p-5">
        <div>
          <h2 className="text-base font-semibold">Teste de envio (só equipe)</h2>
          <p className="text-xs text-muted-foreground">
            Manda a frase de exemplo, na voz salva, para a conversa de um contato interno da equipe,
            pelo mesmo caminho das respostas. O número precisa ter escrito para a empresa nas
            últimas 24 horas.
          </p>
        </div>
        {contatos.isError ? (
          <p className="text-xs text-muted-foreground">Só o administrador faz o teste.</p>
        ) : !contatos.data?.length ? (
          <p className="text-xs text-muted-foreground">
            Cadastre o celular da equipe em Configurações › Agenda › Contatos internos da equipe
            para testar.
          </p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="audio-contato">Contato da equipe</Label>
            <select
              id="audio-contato"
              className="min-h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
              value={contatoTeste}
              onChange={(e) => setContatoTeste(e.target.value)}
            >
              <option value="">Escolha…</option>
              {contatos.data.map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.nome} · final {ct.final}
                  {ct.temConversa ? "" : " (sem conversa ainda)"}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Botao
            variante="contorno"
            disabled={ocupado || !contatoTeste || !salvo.voz}
            onClick={() =>
              void executar(
                () => testeFn({ data: { contatoId: contatoTeste, frase, provedor: "google" } }),
                "Áudio de teste (Google) enviado. Confira no celular se chegou como mensagem de voz.",
              )
            }
          >
            <Send aria-hidden /> Teste com o Google
          </Botao>
          <Botao
            variante="contorno"
            disabled={ocupado || !contatoTeste || !salvo.eleven_voz || !q.data.eleven.configurada}
            onClick={() =>
              void executar(
                () => testeFn({ data: { contatoId: contatoTeste, frase, provedor: "elevenlabs" } }),
                "Áudio de teste (ElevenLabs) enviado. Confira no celular se chegou como mensagem de voz.",
              )
            }
          >
            <Send aria-hidden /> Teste com a ElevenLabs
          </Botao>
        </div>
        <p className="text-xs text-muted-foreground">
          Os dois testes usam a voz salva de cada provedor (ElevenLabs no modelo salvo), para
          comparar no celular antes de trocar o provedor.
        </p>
      </section>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-background p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-base font-bold">{valor}</p>
    </div>
  );
}
