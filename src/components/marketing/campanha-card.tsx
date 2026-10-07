import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Pause,
  Play,
  Pencil,
  RefreshCw,
  Users,
  XCircle,
} from "lucide-react";
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
  contagemCampanhaFn,
  editarCampanhaFn,
  ligarDisparoFn,
  pausarFn,
  pessoasDaCampanhaFn,
  presasCampanhaFn,
  tirarDaCampanhaFn,
  prepararCampanhaFn,
  quemRespondeFn,
  recusarCampanhaFn,
  type situacaoMarketing,
} from "@/lib/marketing.functions";
import { brl, dateBR, monthLabelPT, weekdayPT } from "@/lib/format";
import { nomeDoGrupo, nomeDoSegmento, segmentosDaCampanha, type Segmento } from "@/lib/listas";
import { fetchDireto } from "@/lib/enderecos";
import { AtualizarModelos } from "@/components/marketing/atualizar-modelos";
import { BotaoChamadoManual } from "@/components/marketing/chamado-manual";
import { formatPhoneBR } from "@/lib/crm";

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
  /** Tiradas à mão antes de aprovar e as que saíram por "já chamei manualmente". */
  tirados?: number;
  chamados_manualmente?: number;
  /** Ordem dos lotes por lista (quentes primeiro), do preparo. */
  ordem?: Array<{
    grupo: string;
    pessoas: number;
    primeiro_lote: number;
    ultimo_lote: number;
    fria: boolean;
  }>;
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

/** Quantas pessoas da lista entram nesta campanha (vazio = todas). */
function limiteDe(c: Campanha, grupo: string): number | null {
  const l = (c.limites ?? {}) as Record<string, unknown>;
  const n = Number(l[grupo]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Listas da campanha, com "X na lista, Y podem receber agora" de cada uma. */
/** Antes de aprovar: quem das listas está preso em outra campanha ainda não enviada. */
function usePresas(campanha: Campanha) {
  const presasFn = useServerFn(presasCampanhaFn);
  return useQuery({
    queryKey: [...CHAVE_MKT, "presas", campanha.id],
    queryFn: () => presasFn({ data: { campanhaId: campanha.id } }),
    enabled:
      campanha.tipo === "calendario" &&
      ["rascunho", "aguardando_aprovacao", "bloqueada"].includes(campanha.status),
    staleTime: 300_000,
  });
}

const SITUACAO_OUTRA: Record<string, string> = {
  aguardando_aprovacao: "aguardando aprovação",
  aprovada: "aprovada e ainda não enviada",
  pausada: "pausada",
};

/** "263 pessoas estão em outra campanha aguardando aprovação", com atalho para cancelar a outra. */
function PresasEmOutra({ campanha, admin }: { campanha: Campanha; admin: boolean }) {
  const q = usePresas(campanha);
  const qc = useQueryClient();
  const recusarFn = useServerFn(recusarCampanhaFn);
  const [cancelar, setCancelar] = useState<{ id: string; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const outras = (q.data?.campanhas ?? []).filter((c) => c.pessoas > 0);
  if (!outras.length) return null;
  return (
    <div className="rounded-lg border border-warning bg-card p-3 text-sm">
      {outras.map((o) => (
        <div key={o.id} className="flex flex-wrap items-center justify-between gap-2">
          <p>
            <AlertTriangle className="mr-1 inline h-4 w-4 text-warning" />
            <strong>{o.pessoas}</strong> {o.pessoas === 1 ? "pessoa está" : "pessoas estão"} em
            outra campanha {SITUACAO_OUTRA[o.status] ?? o.status}: "{o.nome}". Por isso a contagem
            desta é menor.
          </p>
          {admin && o.status === "aguardando_aprovacao" && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              onClick={() => setCancelar({ id: o.id, nome: o.nome })}
            >
              Cancelar a outra
            </Button>
          )}
        </div>
      ))}
      <Dialog open={cancelar !== null} onOpenChange={(v) => !v && setCancelar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar "{cancelar?.nome}"?</DialogTitle>
            <DialogDescription>
              A outra campanha é recusada e nada dela será enviado. As pessoas ficam livres para
              esta: depois toque em "Preparar de novo" aqui.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setCancelar(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={ocupado}
              onClick={async () => {
                if (!cancelar) return;
                setOcupado(true);
                try {
                  await recusarFn({
                    data: {
                      campanhaId: cancelar.id,
                      motivo: `cancelada para liberar as pessoas para "${campanha.nome}"`,
                    },
                  });
                  toast.success(
                    `"${cancelar.nome}" cancelada. Toque em "Preparar de novo" para incluir as pessoas.`,
                  );
                  setCancelar(null);
                  await qc.invalidateQueries({ queryKey: CHAVE_MKT });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Não foi possível cancelar.");
                } finally {
                  setOcupado(false);
                }
              }}
            >
              Cancelar a outra campanha
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ListasDaCampanha({ campanha, segmentos }: { campanha: Campanha; segmentos: Segmento[] }) {
  const contagemFn = useServerFn(contagemCampanhaFn);
  const presas = usePresas(campanha);
  const q = useQuery({
    queryKey: [...CHAVE_MKT, "contagem", campanha.id],
    queryFn: () => contagemFn({ data: { campanhaId: campanha.id } }),
    enabled: campanha.tipo === "calendario" && segmentos.length > 0,
    staleTime: 300_000,
  });
  if (!segmentos.length) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
      {segmentos.map((s) => {
        const c = q.data?.find((x) => x.grupo === s.grupo);
        return (
          <li key={s.grupo}>
            {nomeDoSegmento(s)}
            {limiteDe(campanha, s.grupo) ? (
              <span className="font-semibold"> · até {limiteDe(campanha, s.grupo)} pessoas</span>
            ) : null}
            <span className="text-muted-foreground">
              {c
                ? ` · ${c.total} na lista, ${c.podem} ${c.podem === 1 ? "pode" : "podem"} receber agora`
                : q.isLoading
                  ? " · contando…"
                  : ""}
              {presas.data?.por_grupo[s.grupo]
                ? ` · ${presas.data.por_grupo[s.grupo]} em outra campanha`
                : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function CampanhaCard({
  campanha,
  lotes,
  relatorio,
  admin,
  aoRepetir,
}: {
  campanha: Campanha;
  lotes: Lote[];
  relatorio: Relatorio | undefined;
  admin: boolean;
  /** "Mandar para quem ficou de fora": abre a Nova campanha preenchida com esta. */
  aoRepetir?: (c: Campanha) => void;
}) {
  const qc = useQueryClient();
  const [aberta, setAberta] = useState(campanha.status === "aguardando_aprovacao");
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const prepararFn = useServerFn(prepararCampanhaFn);
  const aprovarFn = useServerFn(aprovarCampanhaFn);
  const recusarFn = useServerFn(recusarCampanhaFn);
  const pausarServ = useServerFn(pausarFn);
  const ligarDisparo = useServerFn(ligarDisparoFn);
  // Aprovou com o envio desligado: aviso claro com o botão para ligar ali mesmo.
  const [envioDesligado, setEnvioDesligado] = useState(false);
  const est = campanha.estimativa as Estimativa;
  const segmentos = segmentosDaCampanha(campanha.listas, campanha.grupos);
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
      <Dialog open={envioDesligado} onOpenChange={setEnvioDesligado}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>O envio está desligado</DialogTitle>
            <DialogDescription>
              O envio está desligado em Configuração: nada vai sair até você ligar. A campanha "
              {campanha.nome}" continua aprovada e sai nas datas assim que o envio for ligado.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setEnvioDesligado(false)}>
              Deixar desligado
            </Button>
            {admin && (
              <Button
                disabled={ocupado !== null}
                onClick={async () => {
                  await acao(
                    "ligar",
                    () => ligarDisparo(),
                    "Envio ligado: as campanhas aprovadas saem nas datas.",
                  );
                  setEnvioDesligado(false);
                }}
              >
                <Play className="mr-1 h-4 w-4" /> Ligar o envio agora
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {monthLabelPT(campanha.mes_ref)}
          </p>
          <h3 className="text-base font-semibold text-navy">{campanha.nome}</h3>
          <p className="text-sm text-muted-foreground">
            {datasTexto(campanha.datas_disparo)}
            {campanha.hora_inicio ? ` · começa às ${campanha.hora_inicio.slice(0, 5)}` : ""}
          </p>
          <ListasDaCampanha campanha={campanha} segmentos={segmentos} />
        </div>
        <SituacaoBadge status={campanha.status} />
      </div>

      <div className="mt-3 grid gap-1 text-sm">
        <p>
          <span className="text-muted-foreground">Condição:</span> {condicaoTexto(campanha)}
        </p>
        {campanha.tipo === "calendario" ? <QuemResponde campanha={campanha} admin={admin} /> : null}
        {est?.total !== undefined && (
          <p>
            <span className="text-muted-foreground">
              {est.previa_dia1 ? "Estimativa:" : "Preparada:"}
            </span>{" "}
            {est.total} contatos · {brl(est.custo ?? 0)}
            {est.lotes ? ` · ${est.lotes} lote(s)` : ""}
            {est.sem_nome ? ` · ${est.sem_nome} sem nome` : ""}
          </p>
        )}
        {est?.ordem && est.ordem.length > 1 ? (
          <p>
            <span className="text-muted-foreground">Ordem dos lotes:</span>{" "}
            {est.ordem
              .map(
                (o) =>
                  `${nomeDoGrupo(o.grupo, segmentos)} (${
                    o.primeiro_lote === o.ultimo_lote
                      ? `lote ${o.primeiro_lote}`
                      : `lotes ${o.primeiro_lote}–${o.ultimo_lote}`
                  }${o.fria ? ", fria" : ""})`,
              )
              .join(" → ")}
          </p>
        ) : null}
        {est?.tirados || est?.chamados_manualmente ? (
          <p className="text-muted-foreground">
            Fora desta campanha:{" "}
            {[
              est.tirados ? `${est.tirados} tirada(s) à mão` : null,
              est.chamados_manualmente
                ? `${est.chamados_manualmente} já chamada(s) manualmente`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <PresasEmOutra campanha={campanha} admin={admin} />
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
        {admin && ["rascunho", "bloqueada", "aguardando_aprovacao"].includes(campanha.status) && (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado !== null}
            onClick={() =>
              acao(
                "preparar",
                () => prepararFn({ fetch: fetchDireto, data: { campanhaId: campanha.id } }),
                "Campanha preparada. Confira e aprove.",
              )
            }
          >
            <RefreshCw className="mr-1 h-4 w-4" />{" "}
            {campanha.status === "rascunho" ? "Preparar agora" : "Preparar de novo"}
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
        {admin &&
          aoRepetir &&
          campanha.tipo === "calendario" &&
          ["aprovada", "enviando", "pausada", "concluida"].includes(campanha.status) && (
            <Button size="sm" variant="outline" onClick={() => aoRepetir(campanha)}>
              <Users className="mr-1 h-4 w-4" /> Mandar para quem ficou de fora
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
                  async () => {
                    const r = await aprovarFn({ data: { campanhaId: campanha.id } });
                    if (!r.envioLigado) setEnvioDesligado(true);
                  },
                  "Campanha aprovada.",
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

/** Quem atende as respostas desta campanha. O admin troca a qualquer momento. */
function QuemResponde({ campanha, admin }: { campanha: Campanha; admin: boolean }) {
  const qc = useQueryClient();
  const trocarFn = useServerFn(quemRespondeFn);
  const [ocupado, setOcupado] = useState(false);
  const atual = campanha.quem_responde === "equipe" ? "equipe" : "alice";
  async function trocar(quem: "alice" | "equipe") {
    if (quem === atual) return;
    setOcupado(true);
    try {
      await trocarFn({ data: { campanhaId: campanha.id, quem } });
      toast.success(
        quem === "equipe"
          ? "As próximas respostas desta campanha vão para a equipe."
          : "As próximas respostas desta campanha ficam com a Alice.",
      );
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível trocar.");
    } finally {
      setOcupado(false);
    }
  }
  if (!admin)
    return (
      <p>
        <span className="text-muted-foreground">Quem responde:</span>{" "}
        {atual === "equipe" ? "Equipe" : "Alice"}
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">Quem responde:</span>
      <div
        className="inline-flex rounded-botao border p-0.5"
        role="group"
        aria-label="Quem responde"
      >
        {(["alice", "equipe"] as const).map((q) => (
          <button
            key={q}
            type="button"
            aria-pressed={atual === q}
            disabled={ocupado}
            onClick={() => void trocar(q)}
            className={
              atual === q
                ? "min-h-11 rounded-botao bg-marca px-4 text-sm font-semibold text-marca-foreground"
                : "min-h-11 rounded-botao px-4 text-sm font-semibold text-foreground"
            }
          >
            {q === "alice" ? "Alice" : "Equipe"}
          </button>
        ))}
      </div>
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
          <p className="mb-1 font-medium">
            {est?.ordem?.length ? "Contatos por lista, na ordem dos lotes" : "Contatos por lista"}
          </p>
          {est?.ordem?.length
            ? est.ordem.map((o) => (
                <p key={o.grupo}>
                  {nomeDoGrupo(o.grupo, segmentosDaCampanha(campanha.listas, campanha.grupos))}:{" "}
                  <strong>{o.pessoas}</strong>{" "}
                  <span className="text-muted-foreground">
                    ·{" "}
                    {o.primeiro_lote === o.ultimo_lote
                      ? `lote ${o.primeiro_lote}`
                      : `lotes ${o.primeiro_lote} a ${o.ultimo_lote}`}
                    {o.fria ? " · fria" : ""}
                  </span>
                </p>
              ))
            : Object.entries(est?.por_grupo ?? {}).map(([g, n]) => (
                <p key={g}>
                  {nomeDoGrupo(g, segmentosDaCampanha(campanha.listas, campanha.grupos))}:{" "}
                  <strong>{n}</strong>
                </p>
              ))}
          {est?.ordem?.some((o) => o.fria) ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Listas frias por último: se der problema, a trava pausa antes de chegar nelas.
            </p>
          ) : null}
          <p className="mt-2">
            Total: <strong>{est?.total ?? 0}</strong> · sem nome confiável:{" "}
            <strong>{est?.sem_nome ?? 0}</strong>
          </p>
          <p>
            Custo estimado: <strong>{brl(est?.custo ?? 0)}</strong> (
            {brl(campanha.custo_msg_estimado)} por mensagem)
          </p>
          <p>
            Datas: {datasTexto(est?.datas ?? campanha.datas_disparo)} (dias e horário da
            configuração)
          </p>
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
      <QuemVaiReceber campanha={campanha} admin={admin} />
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
          {problemas.some((p) => /modelo/.test(p)) && <AtualizarModelos chaves={[CHAVE_MKT]} />}
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

/**
 * Quem vai receber (nome, telefone, lista), com busca, "Tirar" e "Já chamei manualmente".
 * Quem é tirado não recebe esta campanha nem o "Mandar para quem ficou de fora" dela; nas
 * campanhas novas volta normalmente.
 */
function QuemVaiReceber({ campanha, admin }: { campanha: Campanha; admin: boolean }) {
  const qc = useQueryClient();
  const listarFn = useServerFn(pessoasDaCampanhaFn);
  const tirarFn = useServerFn(tirarDaCampanhaFn);
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(0);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const segmentos = segmentosDaCampanha(campanha.listas, campanha.grupos);
  const q = useQuery({
    queryKey: [...CHAVE_MKT, "pessoas", campanha.id, termo, pagina],
    queryFn: () => listarFn({ data: { campanhaId: campanha.id, busca: termo, pagina } }),
    enabled: aberto,
  });

  async function tirar(contatoId: string, nome: string | null, devolver = false) {
    setOcupado(contatoId);
    try {
      await tirarFn({ data: { campanhaId: campanha.id, contatoId, devolver } });
      toast.success(
        devolver
          ? `${nome ?? "Contato"} voltou para a campanha.`
          : `${nome ?? "Contato"} saiu desta campanha.`,
      );
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setOcupado(null);
    }
  }

  if (!aberto)
    return (
      <div>
        <Button variant="outline" className="min-h-11" onClick={() => setAberto(true)}>
          <Users className="mr-1 h-4 w-4" /> Ver quem vai receber
        </Button>
      </div>
    );

  const d = q.data;
  const ultimaPagina = d ? (pagina + 1) * d.porPagina >= d.total : true;
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">
        Quem vai receber{d ? ` (${d.total}${termo ? " na busca" : ""})` : ""}
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPagina(0);
          setTermo(busca.trim());
        }}
      >
        <Input
          aria-label="Buscar por nome ou telefone"
          placeholder="Buscar nome ou telefone"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Button type="submit" variant="outline" className="min-h-11 shrink-0">
          Buscar
        </Button>
      </form>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.error && (
        <p className="text-sm text-destructive">
          {q.error instanceof Error ? q.error.message : "Falha ao carregar."}
        </p>
      )}
      <ul className="grid gap-2">
        {d?.pessoas.map((p) => (
          <li
            key={p.contatoId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.nome ?? "Sem nome"}</p>
              <p className="text-sm text-muted-foreground">
                {formatPhoneBR(p.telefone)}
                {p.grupo ? ` · ${nomeDoGrupo(p.grupo, segmentos)}` : ""}
              </p>
            </div>
            {admin && (
              <div className="flex flex-wrap gap-2">
                <BotaoChamadoManual
                  contatoId={p.contatoId}
                  nome={p.nome}
                  marcadoEm={p.chamadoManualEm}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  disabled={ocupado !== null}
                  onClick={() => tirar(p.contatoId, p.nome)}
                >
                  <XCircle className="mr-1 h-4 w-4" /> Tirar
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {d && d.pessoas.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {termo ? "Ninguém com esse nome ou telefone." : "Ninguém para receber."}
        </p>
      )}
      {d && (pagina > 0 || !ultimaPagina) && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={pagina === 0}
            onClick={() => setPagina((n) => n - 1)}
          >
            Anteriores
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={ultimaPagina}
            onClick={() => setPagina((n) => n + 1)}
          >
            Próximos
          </Button>
        </div>
      )}
      {d && d.tirados.length > 0 && (
        <div className="grid gap-2 border-t pt-2">
          <p className="text-sm font-medium">Fora desta campanha ({d.tirados.length})</p>
          <ul className="grid gap-2">
            {d.tirados.map((p) => (
              <li
                key={p.contatoId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0">
                  {p.nome ?? "Sem nome"} · {formatPhoneBR(p.telefone)}
                  <span className="text-muted-foreground">
                    {" "}
                    ·{" "}
                    {p.motivo === "manual"
                      ? `já chamado manualmente${p.chamadoManualEm ? ` em ${dateBR(p.chamadoManualEm)}` : ""}`
                      : "tirado à mão"}
                  </span>
                </span>
                {admin && p.motivo === "tirado" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    disabled={ocupado !== null}
                    onClick={() => tirar(p.contatoId, p.nome, true)}
                  >
                    Devolver
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Quem você tira não recebe esta campanha nem o "Mandar para quem ficou de fora" dela; nas
        campanhas novas volta normalmente.
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
  const [hora, setHora] = useState(campanha.hora_inicio ? campanha.hora_inicio.slice(0, 5) : "");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await editarFn({
        fetch: fetchDireto,
        data: {
          campanhaId: campanha.id,
          datas: datas.filter(Boolean),
          condicaoTexto: semCondicao ? null : texto,
          condicaoPct: semCondicao || !pct ? null : Number(pct.replace(",", ".")),
          horaInicio: hora || null,
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
            Datas, horário e condição da campanha. Sem horário, valem os dias e o horário da
            configuração. Se a campanha já estava preparada, ela é montada de novo.
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
          <div className="grid gap-1">
            <Label htmlFor="edit-hora">Começa às (vazio = horário da configuração)</Label>
            <div className="flex gap-2">
              <Input
                id="edit-hora"
                type="time"
                min="08:00"
                max="20:00"
                step={900}
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
              {hora && (
                <Button variant="ghost" onClick={() => setHora("")}>
                  Limpar
                </Button>
              )}
            </div>
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
