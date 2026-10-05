import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Snowflake } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Botao, Chip } from "@/components/nexa";
import { criarCampanhaFn } from "@/lib/marketing.functions";
import {
  diasTexto,
  FAIXAS_CONVERSA,
  listaFria,
  modeloSugerido,
  OPCOES_LISTAS,
  ordemDosLotes,
  proximasDatas,
  validarNovaCampanha,
  type QuemResponde,
} from "@/lib/campanha-nova";
import { dateBR, weekdayPT } from "@/lib/format";
import { fetchDireto } from "@/lib/enderecos";
import { cn } from "@/lib/utils";
import { CHAVE_MKT } from "./campanha-card";

type Escolha = { modelo: string; faixaConversa: string };

/** "Nova campanha" (só admin): listas com o modelo de cada uma, condição, datas e quem responde. */
export function NovaCampanha({
  aberto,
  aoFechar,
  aoCriar,
  hoje,
  config,
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
}) {
  const qc = useQueryClient();
  const criarFn = useServerFn(criarCampanhaFn);
  const dias = (config?.dias_disparo ?? [2, 3, 4]).map(Number);
  const [nome, setNome] = useState("");
  const [escolhidas, setEscolhidas] = useState<Record<string, Escolha>>({});
  const [semCondicao, setSemCondicao] = useState(false);
  const [texto, setTexto] = useState("");
  const [pct, setPct] = useState("");
  const [datas, setDatas] = useState<string[]>([]);
  const [quem, setQuem] = useState<QuemResponde>("alice");
  const [enviando, setEnviando] = useState(false);
  const opcoesDeData = useMemo(() => proximasDatas(hoje, dias, 12), [hoje, dias]);

  const entrada = {
    nome,
    listas: OPCOES_LISTAS.filter((o) => escolhidas[o.grupo]).map((o) => ({
      grupo: o.grupo,
      modelo: escolhidas[o.grupo]!.modelo,
      faixaConversa: escolhidas[o.grupo]!.faixaConversa,
    })),
    semCondicao,
    condicaoTexto: texto,
    condicaoPct: pct.trim() ? Number(pct.replace(",", ".")) : null,
    datas,
    quemResponde: quem,
  };
  const r = validarNovaCampanha(entrada, { hoje, dias });
  const ordem = ordemDosLotes(OPCOES_LISTAS.filter((o) => escolhidas[o.grupo]));

  function alternarLista(grupo: string) {
    setEscolhidas((e) => {
      if (e[grupo]) {
        const { [grupo]: _, ...resto } = e;
        return resto;
      }
      return {
        ...e,
        [grupo]: { modelo: modeloSugerido(grupo, config?.modelos), faixaConversa: "todos" },
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
        <SheetTitle className="pr-12 font-titulo text-xl">Nova campanha</SheetTitle>
        <SheetDescription>
          Nasce em rascunho. Depois: Preparar, conferir a prévia e Aprovar até a véspera. Nada é
          enviado antes disso.
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
            <legend className="mb-1 text-sm font-semibold">Listas e modelo de cada uma</legend>
            {OPCOES_LISTAS.map((o) => {
              const e = escolhidas[o.grupo];
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
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {o.familia === "conversa" ? (
                        <div className="grid gap-1">
                          <Label htmlFor={`nc-faixa-${o.grupo}`}>Faixa</Label>
                          <select
                            id={`nc-faixa-${o.grupo}`}
                            className="min-h-11 rounded-botao border border-input bg-card px-3 text-sm"
                            value={e.faixaConversa}
                            onChange={(ev) =>
                              setEscolhidas({
                                ...escolhidas,
                                [o.grupo]: { ...e, faixaConversa: ev.target.value },
                              })
                            }
                          >
                            {FAIXAS_CONVERSA.map((f) => (
                              <option key={f.valor} value={f.valor}>
                                {f.rotulo}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      <div className="grid gap-1">
                        <Label htmlFor={`nc-modelo-${o.grupo}`}>Modelo</Label>
                        <Input
                          id={`nc-modelo-${o.grupo}`}
                          className="min-h-11"
                          value={e.modelo}
                          autoCapitalize="off"
                          spellCheck={false}
                          onChange={(ev) =>
                            setEscolhidas({
                              ...escolhidas,
                              [o.grupo]: { ...e, modelo: ev.target.value.trim().toLowerCase() },
                            })
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {ordem.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                Ordem dos lotes: {ordem.map((o) => o.rotulo).join(" → ")}. As listas frias saem por
                último: se der problema, a trava de bloqueio pausa antes de chegar nelas.
              </p>
            ) : null}
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
            <legend className="mb-1 text-sm font-semibold">Datas de disparo</legend>
            <p className="text-xs text-muted-foreground">
              Dias da configuração: {diasTexto(dias)}, a partir das {config?.hora_disparo ?? 10}h.
              Se não couber todo mundo, o preparo usa os próximos dias permitidos.
            </p>
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
                    {weekdayPT(d)} {dateBR(d).slice(0, 5)}
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
