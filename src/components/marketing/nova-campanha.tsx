import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Snowflake } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Botao, Chip } from "@/components/nexa";
import {
  contagemListasNovaFn,
  criarCampanhaFn,
  modelosAprovadosFn,
} from "@/lib/marketing.functions";
import {
  diasTexto,
  listaFria,
  modeloSugerido,
  previaDoModelo,
  OPCOES_LISTAS,
  ordemDosLotes,
  proximasDatas,
  quantidadeDaFracao,
  validarNovaCampanha,
  type InicialNovaCampanha,
  type ModeloAprovado,
  type QuemResponde,
} from "@/lib/campanha-nova";
import { dateBR, weekdayPT } from "@/lib/format";
import { fetchDireto } from "@/lib/enderecos";
import { cn } from "@/lib/utils";
import { CHAVE_MKT } from "./campanha-card";

type Quanto = "todas" | "1/3" | "2/3" | "numero";
type Escolha = { modelo: string; faixa: string; quanto: Quanto; numero: string };

/** Para "Mandar para quem ficou de fora": a campanha nova já vem preenchida. */
export type { InicialNovaCampanha };

const QUANTOS: Array<{ valor: Quanto; rotulo: string }> = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "1/3", rotulo: "1/3" },
  { valor: "2/3", rotulo: "2/3" },
  { valor: "numero", rotulo: "Número" },
];

/** "Nova campanha" (só admin): listas com o modelo de cada uma, condição, datas e quem responde. */
export function NovaCampanha({
  aberto,
  aoFechar,
  aoCriar,
  hoje,
  config,
  inicial,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoCriar: (id: string) => void;
  hoje: string;
  config: {
    dias_disparo?: number[] | null;
    hora_disparo?: number | null;
    modelos?: unknown;
  } | null;
  inicial?: InicialNovaCampanha | null;
}) {
  const qc = useQueryClient();
  const criarFn = useServerFn(criarCampanhaFn);
  const contarFn = useServerFn(contagemListasNovaFn);
  const dias = (config?.dias_disparo ?? [2, 3, 4]).map(Number);
  const horaConfig = `${String(config?.hora_disparo ?? 10).padStart(2, "0")}:00`;
  const [nome, setNome] = useState("");
  const [escolhidas, setEscolhidas] = useState<Record<string, Escolha>>({});
  const [semCondicao, setSemCondicao] = useState(false);
  const [texto, setTexto] = useState("");
  const [pct, setPct] = useState("");
  const [proprio, setProprio] = useState(false);
  const [hora, setHora] = useState(horaConfig);
  const [datas, setDatas] = useState<string[]>([]);
  const [quem, setQuem] = useState<QuemResponde>("alice");
  const [enviando, setEnviando] = useState(false);

  // Abrindo com uma campanha de base ("quem ficou de fora"), o formulário vem preenchido.
  useEffect(() => {
    if (!aberto) return;
    if (!inicial) return;
    setNome(inicial.nome);
    setEscolhidas(
      Object.fromEntries(
        inicial.listas.map((l) => {
          const op = OPCOES_LISTAS.find((o) => o.grupo === l.grupo);
          return [
            l.grupo,
            {
              modelo: l.modelo,
              faixa: l.faixa ?? op?.faixaPadrao ?? "",
              quanto: "todas" as Quanto,
              numero: "",
            },
          ];
        }),
      ),
    );
    setSemCondicao(!inicial.condicaoTexto && !inicial.condicaoPct);
    setTexto(inicial.condicaoTexto ?? "");
    setPct(inicial.condicaoPct ? String(inicial.condicaoPct) : "");
    setQuem(inicial.quemResponde);
    setDatas([]);
  }, [aberto, inicial]);

  // Só os modelos aprovados na Meta aparecem para escolher (lidos quando o formulário abre).
  const aprovadosFn = useServerFn(modelosAprovadosFn);
  const aprovados = useQuery({
    queryKey: [...CHAVE_MKT, "modelos-aprovados"],
    queryFn: () => aprovadosFn(),
    enabled: aberto,
    staleTime: 120_000,
  });
  const modelos = aprovados.data?.modelos ?? [];

  // Listas escolhidas com a faixa, para contar quem está nelas e quem pode receber agora.
  const segmentos = OPCOES_LISTAS.filter((o) => escolhidas[o.grupo]).map((o) => {
    const f = o.faixas?.find((x) => x.valor === escolhidas[o.grupo]!.faixa);
    const ateFaixa = o.faixas ? f?.ate : o.ate;
    return {
      grupo: o.grupo,
      familia: o.familia,
      ...(o.de !== undefined ? { de: o.de } : {}),
      ...(ateFaixa !== undefined ? { ate: ateFaixa } : {}),
    };
  });
  const contagem = useQuery({
    queryKey: [...CHAVE_MKT, "contagem-nova", JSON.stringify(segmentos)],
    queryFn: () => contarFn({ data: { listas: segmentos } }),
    enabled: aberto && segmentos.length > 0,
    staleTime: 120_000,
  });

  const condicaoAtual = semCondicao
    ? null
    : [texto.trim(), pct.trim() ? `${pct.trim()}%` : ""].filter(Boolean).join(" — ") || null;
  const opcoesDeData = useMemo(
    () =>
      proprio
        ? proximasDatas(hoje, [1, 2, 3, 4, 5, 6, 7], 14, true)
        : proximasDatas(hoje, dias, 12),
    [hoje, dias, proprio],
  );

  /** Quantas pessoas desta lista (null = todas). */
  function quantidade(grupo: string): number | null {
    const e = escolhidas[grupo];
    if (!e || e.quanto === "todas") return null;
    if (e.quanto === "numero") return e.numero.trim() ? Number(e.numero) : NaN;
    const podem = contagem.data?.[grupo]?.podem;
    return podem ? quantidadeDaFracao(podem, e.quanto) : null;
  }

  const entrada = {
    nome,
    listas: OPCOES_LISTAS.filter((o) => escolhidas[o.grupo]).map((o) => ({
      grupo: o.grupo,
      modelo: escolhidas[o.grupo]!.modelo,
      faixa: escolhidas[o.grupo]!.faixa || undefined,
      quantidade: quantidade(o.grupo),
    })),
    semCondicao,
    condicaoTexto: texto,
    condicaoPct: pct.trim() ? Number(pct.replace(",", ".")) : null,
    datas,
    horaInicio: proprio ? hora : null,
    quemResponde: quem,
  };
  const agora = new Date().toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const r = validarNovaCampanha(entrada, { hoje, dias, agora });
  const ordem = ordemDosLotes(OPCOES_LISTAS.filter((o) => escolhidas[o.grupo]));

  function muda(grupo: string, p: Partial<Escolha>) {
    setEscolhidas((e) => (e[grupo] ? { ...e, [grupo]: { ...e[grupo]!, ...p } } : e));
  }

  function alternarLista(grupo: string) {
    setEscolhidas((e) => {
      if (e[grupo]) {
        const { [grupo]: _, ...resto } = e;
        return resto;
      }
      // Sugestão pelos nomes da empresa, só se estiver aprovada na Meta.
      const sugerido = modeloSugerido(grupo, config?.modelos);
      const op = OPCOES_LISTAS.find((o) => o.grupo === grupo);
      return {
        ...e,
        [grupo]: {
          modelo: modelos.some((m) => m.nome === sugerido) ? sugerido : "",
          faixa: op?.faixaPadrao ?? "",
          quanto: "todas",
          numero: "",
        },
      };
    });
  }

  async function criar() {
    if (!r.ok) return;
    setEnviando(true);
    try {
      const res = await criarFn({ fetch: fetchDireto, data: entrada });
      toast.success('Campanha criada em rascunho. Toque em "Preparar agora" para ver a prévia.');
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
      aoCriar(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        <SheetTitle className="pr-12 font-titulo text-xl">
          {inicial ? "Mandar para quem ficou de fora" : "Nova campanha"}
        </SheetTitle>
        <SheetDescription>
          {inicial
            ? "Mesmas listas, modelos e condição. Quem já recebeu fica fora sozinho (limite de 30 dias)."
            : "Nasce em rascunho. Depois: Preparar, conferir a prévia e Aprovar. Nada é enviado antes disso."}
        </SheetDescription>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pt-4">
          <div className="grid gap-1.5">
            <Label htmlFor="nc-nome">Nome</Label>
            <Input
              id="nc-nome"
              className="min-h-11"
              value={nome}
              maxLength={80}
              placeholder="Ex.: Outubro: base geral"
              onChange={(e) => setNome(e.target.value)}
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Listas, modelo e quantas pessoas</legend>
            {OPCOES_LISTAS.map((o) => {
              const e = escolhidas[o.grupo];
              const c = contagem.data?.[o.grupo];
              const q = quantidade(o.grupo);
              return (
                <div
                  key={o.grupo}
                  className={cn(
                    "rounded-card border p-3",
                    e ? "border-marca bg-marca-claro/40" : "border-border",
                  )}
                >
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5 accent-marca"
                      checked={Boolean(e)}
                      onChange={() => alternarLista(o.grupo)}
                    />
                    <span className="flex-1 text-[15px] font-semibold">{o.rotulo}</span>
                    {listaFria(o) ? (
                      <Chip>
                        <Snowflake className="size-3" aria-hidden /> fria
                      </Chip>
                    ) : null}
                  </label>
                  {e ? (
                    <div className="mt-2 grid gap-3">
                      {o.faixas ? (
                        <div className="grid gap-1">
                          <Label htmlFor={`nc-faixa-${o.grupo}`}>Faixa</Label>
                          <select
                            id={`nc-faixa-${o.grupo}`}
                            className="min-h-11 rounded-botao border border-input bg-card px-3 text-sm"
                            value={e.faixa}
                            onChange={(ev) => muda(o.grupo, { faixa: ev.target.value })}
                          >
                            {o.faixas.map((f) => (
                              <option key={f.valor} value={f.valor}>
                                {f.rotulo}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}

                      <div className="grid gap-1">
                        <span className="text-sm font-medium">Quantas pessoas</span>
                        <div
                          className="grid grid-cols-4 gap-1.5"
                          role="group"
                          aria-label="Quantas pessoas"
                        >
                          {QUANTOS.map((x) => (
                            <button
                              key={x.valor}
                              type="button"
                              aria-pressed={e.quanto === x.valor}
                              onClick={() => muda(o.grupo, { quanto: x.valor })}
                              className={cn(
                                "min-h-11 rounded-botao border text-sm font-semibold",
                                e.quanto === x.valor
                                  ? "border-marca bg-marca text-marca-foreground"
                                  : "border-border bg-card text-foreground",
                              )}
                            >
                              {x.rotulo}
                            </button>
                          ))}
                        </div>
                        {e.quanto === "numero" ? (
                          <Input
                            className="min-h-11"
                            inputMode="numeric"
                            aria-label="Número de pessoas"
                            placeholder="Ex.: 100"
                            value={e.numero}
                            onChange={(ev) =>
                              muda(o.grupo, { numero: ev.target.value.replace(/\D/g, "") })
                            }
                          />
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {contagem.isLoading
                            ? "Contando…"
                            : c
                              ? `${c.total} na lista, cerca de ${c.podem} podem receber agora`
                              : ""}
                          {q && Number.isFinite(q) ? ` · vão ${q} (as mais recentes primeiro)` : ""}
                        </p>
                      </div>

                      <div className="grid gap-1">
                        <Label htmlFor={`nc-modelo-${o.grupo}`}>Modelo (aprovados na Meta)</Label>
                        <select
                          id={`nc-modelo-${o.grupo}`}
                          className="min-h-11 rounded-botao border border-input bg-card px-3 text-sm"
                          value={e.modelo}
                          disabled={aprovados.isLoading}
                          onChange={(ev) => muda(o.grupo, { modelo: ev.target.value })}
                        >
                          <option value="">
                            {aprovados.isLoading ? "Lendo os modelos na Meta…" : "Escolha o modelo"}
                          </option>
                          {modelos.map((m) => (
                            <option key={m.nome} value={m.nome}>
                              {m.nome}
                            </option>
                          ))}
                        </select>
                        {!e.modelo &&
                        !aprovados.isLoading &&
                        !modelos.some(
                          (m) => m.nome === modeloSugerido(o.grupo, config?.modelos),
                        ) ? (
                          <p className="text-xs text-muted-foreground">
                            O modelo sugerido ({modeloSugerido(o.grupo, config?.modelos)}) ainda não
                            está aprovado na Meta.
                          </p>
                        ) : null}
                      </div>
                      <PreviaModelo
                        modelo={modelos.find((m) => m.nome === e.modelo) ?? null}
                        condicao={condicaoAtual}
                        semCondicao={semCondicao}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {aprovados.data && !modelos.length ? (
              <p className="rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground">
                {aprovados.data.erro ?? "Nenhum modelo aprovado na Meta ainda."} Envie os textos em{" "}
                <Link to="/modelos-mensagem" className="font-semibold underline">
                  Modelos de mensagem
                </Link>{" "}
                e espere a aprovação.
              </p>
            ) : null}
            {ordem.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                Ordem dos lotes: {ordem.map((o) => o.rotulo).join(" → ")}. As listas frias saem por
                último: se der problema, a trava de bloqueio pausa antes de chegar nelas.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Quem recebe agora fica registrado e não recebe outra campanha por 30 dias. Para mandar
              para o resto depois, use "Mandar para quem ficou de fora" no cartão da campanha.
            </p>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Condição</legend>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={semCondicao}
                onChange={(ev) => setSemCondicao(ev.target.checked)}
              />
              Sem condição (só o desconto do Pix)
            </label>
            {!semCondicao ? (
              <div className="grid grid-cols-[1fr_96px] gap-2">
                <Input
                  className="min-h-11"
                  aria-label="Texto da condição"
                  placeholder="Ex.: 10% na higienização"
                  value={texto}
                  maxLength={200}
                  onChange={(ev) => setTexto(ev.target.value)}
                />
                <Input
                  className="min-h-11"
                  aria-label="Percentual"
                  inputMode="decimal"
                  placeholder="%"
                  value={pct}
                  onChange={(ev) => setPct(ev.target.value)}
                />
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              A Alice usa a condição nas respostas. Modelo com {"{{2}}"} (ex.: o de "conversou") põe
              a condição no texto.
            </p>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Quando</legend>
            <div className="grid grid-cols-2 gap-2">
              {[false, true].map((v) => (
                <Botao
                  key={String(v)}
                  type="button"
                  variante={proprio === v ? "primario" : "contorno"}
                  aria-pressed={proprio === v}
                  onClick={() => {
                    setProprio(v);
                    setDatas([]);
                  }}
                >
                  {v ? "Escolher dia e horário" : "Dias da configuração"}
                </Botao>
              ))}
            </div>
            {proprio ? (
              <div className="grid gap-1">
                <Label htmlFor="nc-hora">Horário de início</Label>
                <Input
                  id="nc-hora"
                  type="time"
                  min="08:00"
                  max="20:00"
                  step={900}
                  className="min-h-11"
                  value={hora}
                  onChange={(ev) => setHora(ev.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Qualquer dia, inclusive hoje (com pelo menos 30 minutos para preparar e aprovar),
                  das 08:00 às 20:00. Cada dia leva até 350 mensagens, uma a cada 8 segundos; nada
                  sai depois das 21h.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Dias da configuração: {diasTexto(dias)}, a partir das {config?.hora_disparo ?? 10}h.
                Se não couber todo mundo, o preparo usa os próximos dias permitidos.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {opcoesDeData.map((d) => {
                const marcada = datas.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={marcada}
                    onClick={() =>
                      setDatas(marcada ? datas.filter((x) => x !== d) : [...datas, d].sort())
                    }
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1 rounded-botao border px-3 text-sm font-semibold",
                      marcada
                        ? "border-marca bg-marca text-marca-foreground"
                        : "border-border bg-card text-foreground",
                    )}
                  >
                    {marcada ? <Check className="size-4" aria-hidden /> : null}
                    {d === hoje ? "Hoje" : `${weekdayPT(d)} ${dateBR(d).slice(0, 5)}`}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Quem responde</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["alice", "equipe"] as const).map((q) => (
                <Botao
                  key={q}
                  type="button"
                  variante={quem === q ? "primario" : "contorno"}
                  aria-pressed={quem === q}
                  onClick={() => setQuem(q)}
                >
                  {q === "alice" ? "Alice" : "Equipe"}
                </Botao>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Dá para trocar depois, a qualquer momento (vale para as próximas respostas).
            </p>
          </fieldset>

          {!r.ok && (nome || datas.length || Object.keys(escolhidas).length) ? (
            <ul className="flex flex-col gap-1 rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground">
              {r.problemas.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          ) : null}

          <Botao
            tamanho="grande"
            larguraTotal
            disabled={!r.ok || enviando}
            onClick={() => void criar()}
          >
            {enviando ? "Criando…" : "Criar campanha"}
          </Botao>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Como o cliente vê a mensagem do modelo escolhido (com um nome de exemplo e a condição). */
function PreviaModelo({
  modelo,
  condicao,
  semCondicao,
}: {
  modelo: ModeloAprovado | null;
  condicao: string | null;
  semCondicao: boolean;
}) {
  if (!modelo) return null;
  const p = previaDoModelo(modelo.form, condicao);
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="flex flex-col gap-2 rounded-card bg-marca-claro p-3">
        <p className="text-xs font-semibold text-muted-foreground">Prévia (para a Ana)</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.texto}</p>
        {p.botoes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {p.botoes.map((b) => (
              <span
                key={b}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-marca"
              >
                {b}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {p.usaCondicao && (semCondicao || !condicao) ? (
        <p className="text-xs text-problema-foreground">
          Este modelo coloca a condição no texto: escreva a condição da campanha.
        </p>
      ) : null}
      {!modelo.temSn ? (
        <p className="text-xs text-muted-foreground">
          A versão {modelo.nome}_sn (para quem está sem nome) ainda não está aprovada: se houver
          alguém sem nome nesta lista, a conferência bloqueia a campanha.
        </p>
      ) : null}
    </div>
  );
}
