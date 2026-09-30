import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Pause, Play, Pencil, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  aprovarCampanhaFn,
  conferirCampanhaFn,
  editarCampanhaFn,
  NOMES_GRUPOS,
  pausarFn,
  prepararCampanhaFn,
  recusarCampanhaFn,
  type situacaoMarketing,
} from "@/lib/marketing.functions";
import { brl, dateBR, monthLabelPT, weekdayPT } from "@/lib/format";

export type Situacao = Awaited<ReturnType<typeof situacaoMarketing>>;
export type Campanha = Situacao["campanhas"][number];
type Lote = Situacao["lotes"][number];
type Relatorio = Situacao["relatorio"][number];
type Estimativa = {
  total?: number;
  por_grupo?: Record<string, number>;
  por_modelo?: Record<string, number>;
  sem_nome?: number;
  custo?: number;
  lotes?: number;
  datas?: string[];
  previa_dia1?: boolean;
} | null;

export const CHAVE_MKT = ["marketing"] as const;

const SITUACOES: Record<
  string,
  { texto: string; cor: "muted" | "warning" | "success" | "info" | "danger" | "navy" }
> = {
  rascunho: { texto: "Rascunho", cor: "muted" },
  aguardando_aprovacao: { texto: "Aguardando aprovação", cor: "warning" },
  aprovada: { texto: "Aprovada", cor: "success" },
  enviando: { texto: "Enviando", cor: "info" },
  pausada: { texto: "Pausada", cor: "danger" },
  concluida: { texto: "Concluída", cor: "navy" },
  recusada: { texto: "Recusada", cor: "muted" },
  expirada: { texto: "Expirou sem aprovação", cor: "muted" },
  bloqueada: { texto: "Bloqueada", cor: "danger" },
};

export function SituacaoBadge({ status }: { status: string }) {
  const s = SITUACOES[status] ?? { texto: status, cor: "muted" as const };
  return <Badge variant={s.cor}>{s.texto}</Badge>;
}

const datasTexto = (datas: string[] | null) =>
  [...(datas ?? [])]
    .sort()
    .map((d) => `${weekdayPT(d)} ${dateBR(d)}`)
    .join(", ") || "-";

export function condicaoTexto(c: Pick<Campanha, "condicao_texto" | "condicao_pct">) {
  const partes = [c.condicao_texto, c.condicao_pct ? `${c.condicao_pct}%` : null].filter(Boolean);
  return partes.length ? partes.join(" — ") : "Sem condição";
}

export function CampanhaCard({
  campanha,
  lotes,
  relatorio,
  admin,
}: {
  campanha: Campanha;
  lotes: Lote[];
  relatorio: Relatorio | undefined;
  admin: boolean;
}) {
  const qc = useQueryClient();
  const [aberta, setAberta] = useState(campanha.status === "aguardando_aprovacao");
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const prepararFn = useServerFn(prepararCampanhaFn);
  const aprovarFn = useServerFn(aprovarCampanhaFn);
  const recusarFn = useServerFn(recusarCampanhaFn);
  const pausarServ = useServerFn(pausarFn);
  const est = campanha.estimativa as Estimativa;
  const alertaLote = lotes.find((l) => Number(l.optout_bloqueio_pct ?? 0) > 3);
  const podeEditar = ["rascunho", "aguardando_aprovacao", "bloqueada"].includes(campanha.status);

  async function acao(nome: string, f: () => Promise<unknown>, ok: string) {
    setOcupado(nome);
    try {
      await f();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {monthLabelPT(campanha.mes_ref)}
          </p>
          <h3 className="text-base font-semibold text-navy">{campanha.nome}</h3>
          <p className="text-sm text-muted-foreground">
            {datasTexto(campanha.datas_disparo)} · grupos {campanha.grupos.join(", ")}
          </p>
        </div>
        <SituacaoBadge status={campanha.status} />
      </div>

      <div className="mt-3 grid gap-1 text-sm">
        <p>
          <span className="text-muted-foreground">Condição:</span> {condicaoTexto(campanha)}
        </p>
        {est?.total !== undefined && (
          <p>
            <span className="text-muted-foreground">
              {est.previa_dia1 ? "Estimativa:" : "Preparada:"}
            </span>{" "}
            {est.total} contatos · {brl(est.custo ?? 0)}
            {est.lotes ? ` · ${est.lotes} lote(s)` : ""}
            {est.sem_nome ? ` · ${est.sem_nome} sem nome (_sn)` : ""}
          </p>
        )}
        {campanha.motivo_status && (
          <p className="text-destructive">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            {campanha.motivo_status}
          </p>
        )}
        {alertaLote && (
          <p className="font-medium text-destructive">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            Lote {alertaLote.numero}: opt-out + bloqueio em {alertaLote.optout_bloqueio_pct}% (acima
            de 3%).
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setAberta((v) => !v)}>
          {aberta ? "Fechar detalhes" : "Ver detalhes"}
        </Button>
        {admin && ["rascunho", "bloqueada"].includes(campanha.status) && (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado !== null}
            onClick={() =>
              acao(
                "preparar",
                () => prepararFn({ data: { campanhaId: campanha.id } }),
                "Campanha preparada. Confira e aprove.",
              )
            }
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Preparar agora
          </Button>
        )}
        {admin && podeEditar && (
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            <Pencil className="mr-1 h-4 w-4" /> Editar datas/condição
          </Button>
        )}
        {admin && ["aprovada", "enviando"].includes(campanha.status) && (
          <Button
            size="sm"
            variant="destructive"
            disabled={ocupado !== null}
            onClick={() =>
              acao(
                "pausar",
                () => pausarServ({ data: { campanhaId: campanha.id } }),
                "Campanha pausada: nada mais sai até retomar.",
              )
            }
          >
            <Pause className="mr-1 h-4 w-4" /> Pausar
          </Button>
        )}
        {admin && campanha.status === "pausada" && (
          <Button
            size="sm"
            disabled={ocupado !== null}
            onClick={() =>
              acao(
                "retomar",
                () => pausarServ({ data: { campanhaId: campanha.id, retomar: true } }),
                "Retomada: os envios voltam no próximo horário permitido.",
              )
            }
          >
            <Play className="mr-1 h-4 w-4" /> Retomar
          </Button>
        )}
      </div>

      {aberta && (
        <div className="mt-4 grid gap-4 border-t pt-4">
          {campanha.status === "aguardando_aprovacao" && (
            <Aprovacao
              campanha={campanha}
              est={est}
              admin={admin}
              ocupado={ocupado}
              aprovar={() =>
                acao(
                  "aprovar",
                  () => aprovarFn({ data: { campanhaId: campanha.id } }),
                  "Aprovada: os lotes saem sozinhos nas datas, às 10h (com o disparo ligado).",
                )
              }
              recusar={() =>
                acao(
                  "recusar",
                  () => recusarFn({ data: { campanhaId: campanha.id } }),
                  "Campanha recusada: nada será enviado.",
                )
              }
            />
          )}
          {lotes.length > 0 && (
            <Lotes
              lotes={lotes}
              admin={admin}
              ocupado={ocupado}
              pausar={(l, retomar) =>
                acao(
                  `lote-${l.lote_id}`,
                  () =>
                    pausarServ({
                      data: { campanhaId: campanha.id, loteId: l.lote_id, retomar },
                    }),
                  retomar ? "Lote retomado." : "Lote pausado.",
                )
              }
            />
          )}
          {relatorio && (relatorio.enviados ?? 0) > 0 && <RelatorioCampanha r={relatorio} />}
        </div>
      )}

      {editando && <EditarCampanha campanha={campanha} fechar={() => setEditando(false)} />}
    </div>
  );
}

function Aprovacao({
  campanha,
  est,
  admin,
  ocupado,
  aprovar,
  recusar,
}: {
  campanha: Campanha;
  est: Estimativa;
  admin: boolean;
  ocupado: string | null;
  aprovar: () => void;
  recusar: () => void;
}) {
  const conferirFn = useServerFn(conferirCampanhaFn);
  const conf = useQuery({
    queryKey: [...CHAVE_MKT, "conferir", campanha.id, campanha.preparada_em],
    queryFn: () => conferirFn({ data: { campanhaId: campanha.id } }),
    staleTime: 60_000,
  });
  const problemas = conf.data?.problemas ?? [];
  return (
    <div className="grid gap-3">
      <h4 className="font-semibold text-navy">Aprovação</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3 text-sm">
          <p className="mb-1 font-medium">Contatos por grupo</p>
          {Object.entries(est?.por_grupo ?? {}).map(([g, n]) => (
            <p key={g}>
              {g} · {NOMES_GRUPOS[g] ?? g}: <strong>{n}</strong>
            </p>
          ))}
          <p className="mt-2">
            Total: <strong>{est?.total ?? 0}</strong> · sem nome confiável (_sn):{" "}
            <strong>{est?.sem_nome ?? 0}</strong>
          </p>
          <p>
            Custo estimado: <strong>{brl(est?.custo ?? 0)}</strong> (
            {brl(campanha.custo_msg_estimado)} por mensagem)
          </p>
          <p>Datas: {datasTexto(est?.datas ?? campanha.datas_disparo)} (terça a quinta, 10h)</p>
          <p>Condição: {condicaoTexto(campanha)}</p>
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <p className="mb-1 font-medium">Modelos na Meta</p>
          {conf.isLoading && <p className="text-muted-foreground">Conferindo no Chatwoot…</p>}
          {(conf.data?.modelos ?? []).map((m) => (
            <p key={m.nome} className={m.ok ? "" : "text-destructive"}>
              {m.ok ? (
                <CheckCircle2 className="mr-1 inline h-4 w-4 text-success" />
              ) : (
                <XCircle className="mr-1 inline h-4 w-4" />
              )}
              {m.nome}: {m.envios} envio(s){m.erro ? ` — ${m.erro}` : ""}
            </p>
          ))}
          {conf.error && (
            <p className="text-destructive">
              {conf.error instanceof Error ? conf.error.message : "Falha ao conferir."}
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Prévia com 3 contatos reais</p>
        <div className="grid gap-2 md:grid-cols-3">
          {(conf.data?.previa ?? []).map((p) => (
            <div key={p.telefone} className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {p.nome ?? "Sem nome"} · {p.grupo} · {p.modelo}
              </p>
              {p.texto ? (
                <p className="mt-1 whitespace-pre-wrap">{p.texto}</p>
              ) : (
                <p className="mt-1 text-destructive">{p.erro}</p>
              )}
              {p.botoes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.botoes.map((b) => (
                    <Badge key={b} variant="outline">
                      {b}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {admin && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={ocupado !== null || conf.isLoading || problemas.length > 0}
            onClick={aprovar}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar
          </Button>
          <Button variant="outline" disabled={ocupado !== null} onClick={recusar}>
            <XCircle className="mr-1 h-4 w-4" /> Recusar
          </Button>
          {problemas.length > 0 && (
            <p className="self-center text-sm text-destructive">
              Não dá para aprovar: {problemas.join("; ")}
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Aprovada, cada lote sai sozinho na data, a partir das 10h, espaçado, e pausa sozinho se os
        erros passarem de 5% ou opt-out + bloqueio passarem de 3%. Sem aprovação até a véspera, nada
        é enviado.
      </p>
    </div>
  );
}

function Lotes({
  lotes,
  admin,
  ocupado,
  pausar,
}: {
  lotes: Lote[];
  admin: boolean;
  ocupado: string | null;
  pausar: (l: Lote, retomar: boolean) => void;
}) {
  return (
    <div className="grid gap-2">
      <h4 className="font-semibold text-navy">Lotes</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">Lote</th>
              <th className="pr-2">Data</th>
              <th className="pr-2">Situação</th>
              <th className="pr-2">Contatos</th>
              <th className="pr-2">Enviados</th>
              <th className="pr-2">Erros</th>
              <th className="pr-2">Opt-out + bloqueio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.lote_id} className="border-t">
                <td className="py-1 pr-2">{l.numero}</td>
                <td className="pr-2">{dateBR(l.data_prevista)}</td>
                <td className="pr-2">
                  {l.status}
                  {l.motivo_pausa ? (
                    <span className="block text-xs text-destructive">{l.motivo_pausa}</span>
                  ) : null}
                </td>
                <td className="pr-2">{l.quantidade}</td>
                <td className="pr-2">{l.enviados}</td>
                <td className="pr-2">
                  {l.erros}
                  {l.erro_pct ? ` (${l.erro_pct}%)` : ""}
                </td>
                <td
                  className={`pr-2 ${Number(l.optout_bloqueio_pct ?? 0) > 3 ? "font-semibold text-destructive" : ""}`}
                >
                  {Number(l.optouts) + Number(l.bloqueios)}
                  {l.optout_bloqueio_pct ? ` (${l.optout_bloqueio_pct}%)` : ""}
                </td>
                <td className="text-right">
                  {admin && ["aprovado", "enviando"].includes(l.status ?? "") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado !== null}
                      onClick={() => pausar(l, false)}
                    >
                      <Pause className="h-4 w-4" />
                    </Button>
                  )}
                  {admin && l.status === "pausado" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado !== null}
                      onClick={() => pausar(l, true)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RelatorioCampanha({ r }: { r: Relatorio }) {
  const itens: Array<[string, string]> = [
    ["Enviados", String(r.enviados ?? 0)],
    ["Respostas", String(r.respostas ?? 0)],
    ["Orçamentos", String(r.orcamentos ?? 0)],
    ["Vendas", String(r.vendas ?? 0)],
    ["Valor vendido", brl(r.valor_vendido)],
    ["Opt-outs", String(r.optouts ?? 0)],
    ["Custo estimado", brl(r.custo_estimado)],
    ["Retorno", r.retorno ? `${String(r.retorno).replace(".", ",")}x` : "-"],
  ];
  return (
    <div className="grid gap-2">
      <h4 className="font-semibold text-navy">Resultado</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {itens.map(([k, v]) => (
          <div key={k} className="rounded-lg border p-2">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="font-semibold">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditarCampanha({ campanha, fechar }: { campanha: Campanha; fechar: () => void }) {
  const qc = useQueryClient();
  const editarFn = useServerFn(editarCampanhaFn);
  const [datas, setDatas] = useState<string[]>([...(campanha.datas_disparo ?? [])].sort());
  const [semCondicao, setSemCondicao] = useState(
    !campanha.condicao_texto && !campanha.condicao_pct,
  );
  const [texto, setTexto] = useState(campanha.condicao_texto ?? "");
  const [pct, setPct] = useState(campanha.condicao_pct ? String(campanha.condicao_pct) : "");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await editarFn({
        data: {
          campanhaId: campanha.id,
          datas: datas.filter(Boolean),
          condicaoTexto: semCondicao ? null : texto,
          condicaoPct: semCondicao || !pct ? null : Number(pct.replace(",", ".")),
        },
      });
      toast.success(
        campanha.status === "rascunho"
          ? "Campanha atualizada."
          : "Campanha atualizada e preparada de novo. Confira e aprove.",
      );
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
      fechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && fechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar {campanha.nome}</DialogTitle>
          <DialogDescription>
            Datas de disparo (terça a quinta) e a condição da campanha. Se a campanha já estava
            preparada, ela é montada de novo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label>Datas</Label>
            {datas.map((d, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  type="date"
                  value={d}
                  onChange={(e) => setDatas(datas.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <Button variant="ghost" onClick={() => setDatas(datas.filter((_, j) => j !== i))}>
                  Tirar
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setDatas([...datas, ""])}>
              Adicionar data
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={semCondicao}
              onChange={(e) => setSemCondicao(e.target.checked)}
            />
            Sem condição (só o desconto do Pix)
          </label>
          {!semCondicao && (
            <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
              <div className="grid gap-1">
                <Label htmlFor="cond-texto">Condição (texto que vai na mensagem)</Label>
                <Input
                  id="cond-texto"
                  value={texto}
                  maxLength={200}
                  placeholder="Ex.: 10% na higienização"
                  onChange={(e) => setTexto(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="cond-pct">% (até 25)</Label>
                <Input
                  id="cond-pct"
                  inputMode="decimal"
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={fechar}>
              Cancelar
            </Button>
            <Button disabled={salvando} onClick={salvar}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
