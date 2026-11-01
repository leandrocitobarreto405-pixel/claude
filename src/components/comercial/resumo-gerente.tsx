// Gerente comercial › Resumo, na ordem de quem decide: o que fazer agora, como estamos, onde
// perdemos, o que corrigir (Alice e equipe), sugestões (aprovar/recusar, só marca) e os detalhes
// recolhidos. No celular tudo é linha com barra; tabela só no computador (≥ 1024 px).
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Minus } from "lucide-react";
import { toast } from "sonner";
import { Botao, Card, Chip, NumeroGrande, Recolhido } from "@/components/nexa";
import {
  decidirSugestaoFn,
  type GerenteComercial,
  type RelatorioTela,
} from "@/lib/comercial.functions";
import { NOME_REGRA } from "@/lib/comercial/ficha";
import type { DefeitoSistemaContado } from "@/lib/comercial/defeitos-sistema";
import {
  PERIODOS,
  comoEstamos,
  defeitosAlice,
  errosEquipe,
  funilComQueda,
  noGrupo,
  noPeriodo,
  type FichaPainel,
  type Grupo,
  type ItemCorrigir,
  type Periodo,
} from "@/lib/comercial/painel";
import { NOME_TEMA_EQUIPE, type TemaEquipe } from "@/lib/comercial/relatorio";
import {
  conversaoPor,
  perdasPorMotivo,
  regrasQuebradas,
  servicoPrincipal,
} from "@/lib/comercial/resumo";
import { brl, dateBR } from "@/lib/format";
import { cn } from "@/lib/utils";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

// ---------------------------------------------------------------- peças

/** Botões lado a lado (um escolhido), com rolagem própria se não couber. */
function Segmentos<T extends string>({
  opcoes,
  valor,
  onChange,
  rotulo,
}: {
  opcoes: Array<{ id: T; rotulo: string }>;
  valor: T;
  onChange: (v: T) => void;
  rotulo: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1"
    >
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold",
            valor === o.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export type LinhaBarra = {
  rotulo: React.ReactNode;
  /** Tamanho da barra (0 a 1). */
  fracao: number;
  direita: React.ReactNode;
  sub?: React.ReactNode;
};

/** Linhas com barra: rótulo à esquerda, número à direita, barra embaixo. */
export function LinhasComBarra({
  linhas,
  tom = "marca",
  className,
}: {
  linhas: LinhaBarra[];
  tom?: "marca" | "problema";
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {linhas.map((l, i) => (
        <li key={i} className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{l.rotulo}</span>
            <span className="shrink-0 text-right font-semibold tabular-nums">{l.direita}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                tom === "marca" ? "bg-marca" : "bg-problema-foreground/70",
              )}
              style={{ width: `${Math.max(2, Math.min(100, l.fracao * 100))}%` }}
            />
          </div>
          {l.sub ? <span className="text-xs text-muted-foreground">{l.sub}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Tabela só para o computador; no celular, as mesmas linhas com barra. */
function TabelaOuBarras({
  cabecalho,
  linhas,
  barras,
}: {
  cabecalho: string[];
  linhas: Array<Array<React.ReactNode>>;
  barras: LinhaBarra[];
}) {
  return (
    <>
      <LinhasComBarra linhas={barras} className="lg:hidden" />
      <div className="hidden max-w-full overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {cabecalho.map((c, i) => (
                <th key={c} className={cn("py-1.5 font-semibold", i > 0 && "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-border">
                {l.map((c, j) => (
                  <td key={j} className={cn("py-1.5", j > 0 && "text-right tabular-nums")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="font-titulo text-lg font-bold">{titulo}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- tela

export type AbaDestino = "confirmar" | "recuperar" | "encaixe";

export function ResumoGerente({
  d,
  fichas,
  afazeres,
  irPara,
  custoCartao,
}: {
  d: GerenteComercial;
  fichas: FichaPainel[];
  afazeres: Record<AbaDestino, number>;
  irPara: (aba: AbaDestino) => void;
  /** Cartão do custo da IA (vai para "Ver detalhes"). */
  custoCartao: React.ReactNode;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("outubro");
  const [grupo, setGrupo] = useState<Grupo>("todos");
  const doPeriodo = useMemo(
    () => fichas.filter((f) => f.status === "ok" && noPeriodo(f, periodo)),
    [fichas, periodo],
  );
  const doGrupo = useMemo(() => doPeriodo.filter((f) => noGrupo(f, grupo)), [doPeriodo, grupo]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <Segmentos opcoes={PERIODOS} valor={periodo} onChange={setPeriodo} rotulo="Período" />
        <p className="text-xs text-muted-foreground">
          {d.rotinaDiaria
            ? "Atualizado todo dia pela rotina diária."
            : "Hoje só há a análise de outubro; os outros períodos se completam quando a rotina diária ligar."}
        </p>
      </div>

      <Secao titulo="Para fazer agora">
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ["confirmar", "Confirmar perdas", "Orçamento sem desfecho com motivo sugerido"],
              ["recuperar", "Ainda dá para recuperar", "Mensagem pronta para copiar"],
              ["encaixe", "Fila de encaixe", "Pediram horário que não tinha"],
            ] as const
          ).map(([id, titulo, sub]) => (
            <button
              key={id}
              type="button"
              onClick={() => irPara(id)}
              className="flex min-h-16 min-w-0 items-center gap-3 rounded-card border border-border bg-card p-4 text-left hover:bg-muted"
            >
              <span className="font-titulo text-3xl tabular-nums">{afazeres[id]}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{titulo}</span>
                <span className="text-xs text-muted-foreground">{sub}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </Secao>

      {!doPeriodo.length ? (
        <Card className="text-sm">Nenhuma ficha neste período.</Card>
      ) : (
        <>
          <Secao titulo="Como estamos">
            <Segmentos
              rotulo="Origem"
              valor={grupo}
              onChange={setGrupo}
              opcoes={[
                { id: "todos", rotulo: "Todos" },
                { id: "google", rotulo: "Google" },
                { id: "outras", rotulo: "Outras origens" },
              ]}
            />
            <ComoEstamos fichas={doGrupo} />
          </Secao>
          <Secao titulo="Onde perdemos">
            <OndePerdemos fichas={doGrupo} />
          </Secao>
          <Secao titulo="O que corrigir">
            <OQueCorrigir
              fichas={doPeriodo}
              relatorio={d.relatorio}
              sistema={d.defeitosSistema ?? []}
            />
          </Secao>
          {d.relatorio?.leitura.sugestoes.length ? (
            <Secao titulo="Sugestões da gerente">
              <Sugestoes r={d.relatorio} />
            </Secao>
          ) : null}
          <Recolhido titulo="Ver detalhes">
            <Detalhes fichas={doGrupo} relatorio={d.relatorio} custoCartao={custoCartao} />
          </Recolhido>
        </>
      )}
    </div>
  );
}

function ComoEstamos({ fichas }: { fichas: FichaPainel[] }) {
  const c = comoEstamos(fichas);
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
      <Card className="min-w-0">
        <NumeroGrande valor={c.leads} legenda="leads" />
      </Card>
      <Card className="min-w-0">
        <NumeroGrande
          valor={pct(c.pctOrcamento)}
          legenda={`receberam orçamento (${c.comOrcamento})`}
        />
      </Card>
      <Card className="min-w-0">
        <NumeroGrande
          valor={pct(c.conversao)}
          legenda={`conversão · ${c.vendas} ${c.vendas === 1 ? "venda" : "vendas"} · ${brl(c.vendido)}`}
        />
      </Card>
      <Card className="min-w-0">
        <NumeroGrande
          tamanho="pequeno"
          valor={brl(c.orcado)}
          legenda={`orçado · ${brl(c.perdido)} perdido ou parado`}
        />
      </Card>
    </div>
  );
}

function OndePerdemos({ fichas }: { fichas: FichaPainel[] }) {
  const etapas = funilComQueda(fichas);
  const motivos = perdasPorMotivo(fichas).slice(0, 5);
  const maiorValor = Math.max(1, ...motivos.map((m) => m.valor));
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="min-w-0">
        <h3 className="font-bold">Funil</h3>
        <ol className="flex flex-col gap-1">
          {etapas.map((e) => (
            <li key={e.etapa} className="flex min-w-0 flex-col gap-1">
              {e.queda !== null ? (
                <span className="flex items-center gap-1 py-0.5 text-xs text-problema-foreground">
                  <ArrowDown aria-hidden className="size-3.5" />
                  caem {pct(e.queda)}
                </span>
              ) : null}
              <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">{e.etapa}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {e.n}{" "}
                  <span className="font-normal text-muted-foreground">({pct(e.pctDoTotal)})</span>
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-marca"
                  style={{ width: `${Math.max(2, e.pctDoTotal * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card className="min-w-0">
        <h3 className="font-bold">Top 5 motivos de perda</h3>
        {motivos.length ? (
          <LinhasComBarra
            tom="problema"
            linhas={motivos.map((m) => ({
              rotulo: m.motivo,
              fracao: m.valor / maiorValor,
              direita: brl(m.valor),
              sub: `${m.n} ${m.n === 1 ? "lead" : "leads"}`,
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma perda neste filtro.</p>
        )}
      </Card>
    </div>
  );
}

/** "dd/mm" da data da correção (o corte é meia-noite de São Paulo, 03:00 UTC). */
const diaCorte = (iso: string) =>
  dateBR(new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString()).slice(0, 5);

function ChipTendencia({ item }: { item: ItemCorrigir }) {
  if (!item.corte)
    return (
      <Chip tom="neutro" title="A correção deste defeito ainda não foi publicada">
        correção ainda não publicada
      </Chip>
    );
  const dia = diaCorte(item.corte);
  if (item.tendencia === "sem_base")
    return (
      <Chip tom="neutro" title={`Menos de 5 leads de cada lado de ${dia} para comparar`}>
        corrigido em {dia} · sem base ainda
      </Chip>
    );
  const tom =
    item.tendencia === "caiu" ? "sucesso" : item.tendencia === "subiu" ? "problema" : "neutro";
  const Icone =
    item.tendencia === "caiu" ? ArrowDown : item.tendencia === "subiu" ? ArrowUp : Minus;
  return (
    <Chip tom={tom} title={`% dos leads com o problema antes e depois de ${dia}`}>
      <Icone aria-hidden className="size-3.5" />
      {pct(item.antes ?? 0)} → {pct(item.depois ?? 0)}
    </Chip>
  );
}

function ListaCorrigir({
  titulo,
  itens,
  oCerto,
  rodape,
}: {
  titulo: string;
  itens: ItemCorrigir[];
  oCerto?: (id: string) => string | null;
  rodape?: React.ReactNode;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  return (
    <Card className="min-w-0">
      <h3 className="font-bold">{titulo}</h3>
      {itens.length ? (
        <ul className="flex flex-col divide-y divide-border">
          {itens.map((it) => {
            const ab = aberto === it.id;
            const certo = oCerto?.(it.id) ?? null;
            return (
              <li key={it.id} className="min-w-0 py-2">
                <button
                  type="button"
                  aria-expanded={ab}
                  onClick={() => setAberto(ab ? null : it.id)}
                  className="flex min-h-11 w-full min-w-0 flex-col gap-1 text-left"
                >
                  <span className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-semibold">{it.nome}</span>
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                        ab && "rotate-180",
                      )}
                    />
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm tabular-nums">{it.casos} casos</span>
                    <ChipTendencia item={it} />
                  </span>
                </button>
                {ab ? (
                  <div className="mt-1 flex flex-col gap-1.5 text-sm">
                    {it.exemplos.length ? (
                      it.exemplos.map((e, i) => (
                        <p key={i} className="rounded-botao bg-background p-2">
                          {e}
                        </p>
                      ))
                    ) : (
                      <p className="text-muted-foreground">Sem trecho de exemplo nas fichas.</p>
                    )}
                    {certo ? (
                      <p className="rounded-botao bg-marca-claro p-2">
                        <span className="font-semibold">O certo: </span>
                        {certo}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nada neste período.</p>
      )}
      {rodape}
    </Card>
  );
}

function OQueCorrigir({
  fichas,
  relatorio,
  sistema,
}: {
  fichas: FichaPainel[];
  relatorio: RelatorioTela | null;
  sistema: DefeitoSistemaContado[];
}) {
  const alice = defeitosAlice(fichas);
  const equipe = errosEquipe(fichas);
  const oCerto = (id: string) =>
    relatorio?.leitura.para_a_equipe?.find((p) => p.tema === id)?.o_certo ?? null;
  const texto = equipe
    .map((e, i) => {
      const certo = oCerto(e.id);
      return [
        `${i + 1}. ${NOME_TEMA_EQUIPE[e.id as TemaEquipe] ?? e.nome} (${e.casos} casos)`,
        e.exemplos[0] ? `Exemplo: ${e.exemplos[0]}` : "",
        certo ? `O certo: ${certo}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Casos contados nas fichas; a seta compara a % dos leads com o problema antes e depois da
        correção de cada defeito. Toque para ver exemplos (sem o nome do cliente).
      </p>
      {sistema.length ? <DefeitosDoSistema itens={sistema} /> : null}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <ListaCorrigir titulo="Alice" itens={alice} />
        <ListaCorrigir
          titulo="Equipe"
          itens={equipe}
          oCerto={oCerto}
          rodape={
            equipe.length ? (
              <Botao
                variante="contorno"
                className="self-start"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(texto)
                    .then(() => toast.success("Lista copiada."))
                    .catch(() => toast.error("Não foi possível copiar."))
                }
              >
                <Copy aria-hidden /> Copiar para a conversa com a equipe
              </Botao>
            ) : null
          }
        />
      </div>
    </>
  );
}

const porDia = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Defeitos da Alice contados pelo sistema (exatos, últimos 30 dias), antes × depois da correção. */
function DefeitosDoSistema({ itens }: { itens: DefeitoSistemaContado[] }) {
  return (
    <Card className="min-w-0">
      <h3 className="font-bold">Alice · contado pelo sistema (exato)</h3>
      <p className="text-xs text-muted-foreground">
        Últimos 30 dias, por dia antes e depois da correção de cada defeito.
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {itens.map((it) => (
          <li key={it.id} className="flex min-w-0 flex-col gap-1 py-2">
            <span className="text-sm font-semibold">{it.nome}</span>
            <span className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
              {it.corte ? (
                <>
                  <span>
                    antes: {it.antes} ({porDia(it.porDiaAntes)}/dia)
                  </span>
                  <span>
                    depois de {diaCorte(it.corte)}: {it.depois} ({porDia(it.porDiaDepois)}/dia)
                  </span>
                </>
              ) : (
                <>
                  <span>{it.antes} casos</span>
                  <Chip tom="neutro">correção ainda não publicada</Chip>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Sugestoes({ r }: { r: RelatorioTela }) {
  const qc = useQueryClient();
  const decidir = useServerFn(decidirSugestaoFn);
  const [recusando, setRecusando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState<number | null>(null);
  const enviar = async (indice: number, decisao: "aprovada" | "recusada" | "desfazer") => {
    setSalvando(indice);
    try {
      await decidir({ data: { relatorioId: r.id, indice, decisao, motivo } });
      setRecusando(null);
      setMotivo("");
      await qc.invalidateQueries({ queryKey: ["gerente-comercial"] });
      toast.success(
        decisao === "desfazer"
          ? "Decisão desfeita."
          : decisao === "aprovada"
            ? "Sugestão aprovada (nada mudou na Alice)."
            : "Sugestão recusada.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setSalvando(null);
    }
  };
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Aprovar só marca a sugestão (alimenta o manual depois); nada é aplicado na Alice.
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        {r.leitura.sugestoes.map((s, i) => {
          const dec = r.decisoes[String(i)];
          return (
            <Card key={i} className="min-w-0 gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tom={s.forca === "forte" ? "sucesso" : "neutro"}>
                  {s.forca === "forte" ? "Forte" : "Hipótese"}
                </Chip>
                <span className="text-xs text-muted-foreground">{s.casos} casos</span>
                {dec ? (
                  <Chip tom={dec.decisao === "aprovada" ? "sucesso" : "problema"}>
                    {dec.decisao === "aprovada" ? "Aprovada" : "Recusada"} em{" "}
                    {dateBR(dec.em.slice(0, 10))}
                  </Chip>
                ) : null}
              </div>
              <p className="text-sm">{s.sugestao}</p>
              {dec?.motivo ? (
                <p className="text-xs text-muted-foreground">Motivo: {dec.motivo}</p>
              ) : null}
              {recusando === i ? (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold" htmlFor={`motivo-${i}`}>
                    Motivo (opcional)
                  </label>
                  <textarea
                    id={`motivo-${i}`}
                    value={motivo}
                    maxLength={300}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="min-h-20 w-full rounded-botao border border-border bg-background p-2 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Botao disabled={salvando === i} onClick={() => void enviar(i, "recusada")}>
                      Confirmar recusa
                    </Botao>
                    <Botao variante="neutro" onClick={() => setRecusando(null)}>
                      Cancelar
                    </Botao>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {dec ? (
                    <Botao
                      variante="neutro"
                      disabled={salvando === i}
                      onClick={() => void enviar(i, "desfazer")}
                    >
                      Desfazer
                    </Botao>
                  ) : (
                    <>
                      <Botao disabled={salvando === i} onClick={() => void enviar(i, "aprovada")}>
                        Aprovar
                      </Botao>
                      <Botao
                        variante="contorno"
                        onClick={() => {
                          setMotivo("");
                          setRecusando(i);
                        }}
                      >
                        Recusar
                      </Botao>
                    </>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

function Detalhes({
  fichas,
  relatorio,
  custoCartao,
}: {
  fichas: FichaPainel[];
  relatorio: RelatorioTela | null;
  custoCartao: React.ReactNode;
}) {
  const porServico = conversaoPor(fichas, (f) => servicoPrincipal(f.servico));
  const porOrigem = conversaoPor(fichas, (f) => f.origem ?? "Sem origem");
  const regras = regrasQuebradas(fichas);
  const maior = (xs: Array<{ leads: number }>) => Math.max(1, ...xs.map((x) => x.leads));
  const conv = (xs: ReturnType<typeof conversaoPor>, titulo: string) => (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-bold">{titulo}</h3>
      <TabelaOuBarras
        cabecalho={[
          titulo.replace("Conversão por ", "").replace(/^./, (c) => c.toUpperCase()),
          "Leads",
          "Vendas",
          "Conversão",
          "Vendido",
        ]}
        linhas={xs.map((l) => [l.chave, l.leads, l.vendas, pct(l.conversao), brl(l.vendido)])}
        barras={xs.map((l) => ({
          rotulo: l.chave,
          fracao: l.leads / maior(xs),
          direita: `${l.leads} leads`,
          sub: `${l.vendas} ${l.vendas === 1 ? "venda" : "vendas"} · ${pct(l.conversao)} · ${brl(l.vendido)}`,
        }))}
      />
    </div>
  );
  const leitura = relatorio?.leitura;
  return (
    <div className="flex min-w-0 flex-col gap-5 p-4">
      {conv(porServico, "Conversão por serviço")}
      {conv(porOrigem, "Conversão por origem")}
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="font-bold">Regras do roteiro (quebradas)</h3>
        <TabelaOuBarras
          cabecalho={["Regra", "Avaliadas", "Alice quebrou", "Equipe quebrou"]}
          linhas={regras.map((r) => [r.nome, r.avaliadas, r.alice, r.equipe])}
          barras={regras.map((r) => ({
            rotulo: NOME_REGRA[r.regra],
            fracao: r.avaliadas ? (r.alice + r.equipe) / r.avaliadas : 0,
            direita: `${r.alice + r.equipe} de ${r.avaliadas}`,
            sub: `Alice ${r.alice} · equipe ${r.equipe}`,
          }))}
        />
      </div>
      {leitura ? (
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          <h3 className="font-bold">Leitura do relatório</h3>
          <p className="font-semibold">Padrões das vendas</p>
          <ul className="ml-4 list-disc space-y-1">
            {leitura.padroes_vendas.map((p, i) => (
              <li key={i}>
                {p.padrao} <span className="text-muted-foreground">({p.casos} casos)</span>
              </li>
            ))}
          </ul>
          <p className="font-semibold">Perfil de quem mais fecha</p>
          <p>{leitura.perfil_que_mais_fecha}</p>
          <p className="font-semibold">Onde os leads somem</p>
          <p>{leitura.onde_somem}</p>
          <p className="font-semibold">Vendeu × não vendeu</p>
          <ul className="ml-4 list-disc space-y-1">
            {leitura.vendeu_x_nao_vendeu.map((v, i) => (
              <li key={i}>
                {v.servico}: {v.diferenca}
              </li>
            ))}
          </ul>
          <p className="font-semibold">Mudanças sugeridas na Alice (não aplicadas)</p>
          {leitura.mudancas_alice.map((m, i) => (
            <div key={i} className="flex min-w-0 flex-col gap-1">
              <p>
                {m.tema} <span className="text-muted-foreground">({m.casos} casos)</span>
              </p>
              <p className="whitespace-pre-wrap break-words rounded-botao bg-background p-2">
                <span className="font-semibold">Antes: </span>
                {m.antes}
              </p>
              <p className="whitespace-pre-wrap break-words rounded-botao bg-marca-claro p-2">
                <span className="font-semibold">Depois: </span>
                {m.depois}
              </p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {relatorio.periodo} · relatório de {dateBR(relatorio.criadoEm.slice(0, 10))} · custo{" "}
            {usd(relatorio.custoUsd)}
          </p>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="font-bold">Custo da IA</h3>
        {custoCartao}
      </div>
    </div>
  );
}
