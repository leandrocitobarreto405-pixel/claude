import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, ExternalLink, RefreshCw, Sheet as IconePlanilha, Users } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Botao, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import {
  atualizarPlanilhaListasFn,
  contagemListasFn,
  modelosDasListasFn,
  planilhaListasFn,
  pessoasDaListaFn,
  type ModelosDasListas,
  type PessoaPublico,
} from "@/lib/listas.functions";
import { FAMILIAS, csvDaLista, nomeDoFiltro, type DefFamilia, type OpcaoLista } from "@/lib/listas";
import { brl, dateTimeBR } from "@/lib/format";
import { fetchDireto } from "@/lib/enderecos";
import { usePapel } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/listas")({
  head: () => ({ meta: [{ title: "Listas — Nexa OS" }] }),
  component: Listas,
});

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Modelo(s) usado(s) por cada família, com a situação na Meta quando o admin consegue ver. */
function ModelosDaFamilia({ def, m }: { def: DefFamilia; m: ModelosDasListas | undefined }) {
  const nomes = m?.nomes ?? {};
  const linhas: Array<{ quando: string; nome: string | null }> =
    def.familia === "orcamento"
      ? [
          { quando: "até 90 dias", nome: nomes["orcamento"] ?? null },
          {
            quando: "mais de 90 dias",
            nome: nomes["sazonal_prefixo"] ? `${nomes["sazonal_prefixo"]}(mês)` : null,
          },
        ]
      : def.familia === "conversa"
        ? [{ quando: "", nome: nomes["conversa"] ?? null }]
        : def.familia === "clientes"
          ? [
              { quando: "até 30 dias (pós-venda automático)", nome: nomes["posvenda"] ?? null },
              { quando: "3 meses a 1 ano", nome: nomes["oferta"] ?? null },
              { quando: "mais de 1 ano", nome: nomes["reativacao"] ?? null },
            ]
          : def.familia === "perdido_preco"
            ? [{ quando: "", nome: nomes["preco"] ?? null }]
            : [];
  if (def.familia === "agendado")
    return <p className="text-xs text-muted-foreground">Não recebe mensagens de marketing.</p>;
  if (!m) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {linhas.map((l) => {
        const s = l.nome ? m.situacao[l.nome] : undefined;
        return (
          <li key={l.quando + l.nome} className="flex flex-wrap items-center gap-1.5">
            <span>
              Modelo{l.quando ? ` (${l.quando})` : ""}:{" "}
              <b className="text-foreground">{l.nome ?? "—"}</b>
            </span>
            {s ? <Chip tom={s.tom}>{s.rotulo}</Chip> : null}
          </li>
        );
      })}
    </ul>
  );
}

function descricaoPessoa(p: PessoaPublico): string {
  const partes: string[] = [];
  if (p.dias_orcamento !== null && p.familias.includes("orcamento"))
    partes.push(
      `orçamento há ${plural(p.dias_orcamento, "dia", "dias")}${p.orcamento_valor ? ` · ${brl(p.orcamento_valor)}` : ""}`,
    );
  if (p.dias_conversa !== null && p.familias.includes("conversa"))
    partes.push(`conversa há ${plural(p.dias_conversa, "dia", "dias")}`);
  if (p.dias_cliente !== null && p.familias.includes("clientes"))
    partes.push(`último serviço há ${plural(p.dias_cliente, "dia", "dias")}`);
  if (p.familias.includes("perdido_preco")) partes.push("perdido por preço");
  if (p.agendado_para)
    partes.push(`serviço marcado em ${p.agendado_para.split("-").reverse().join("/")}`);
  return partes.join(" · ");
}

function baixar(nomeArquivo: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function QuemEsta({
  opcao,
  aberto,
  fechar,
}: {
  opcao: OpcaoLista | null;
  aberto: boolean;
  fechar: () => void;
}) {
  const fn = useServerFn(pessoasDaListaFn);
  const q = useQuery({
    queryKey: ["listas", "pessoas", opcao?.chave],
    queryFn: () => fn({ data: { filtros: { [opcao!.familia]: opcao!.filtro } } }),
    enabled: Boolean(opcao) && aberto,
  });
  const titulo = opcao ? nomeDoFiltro(opcao.familia, opcao.filtro) : "";
  const pessoas = q.data ?? [];
  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && fechar()}>
      <SheetContent
        side="bottom"
        className="max-h-[88vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        <SheetTitle className="font-titulo text-2xl">{titulo}</SheetTitle>
        <SheetDescription>
          {q.isLoading
            ? "Carregando…"
            : `${plural(pessoas.length, "pessoa", "pessoas")} · ${pessoas.filter((p) => p.pode_receber).length} podem receber agora`}
        </SheetDescription>
        <div className="mt-4 flex flex-col gap-3">
          <Botao
            variante="contorno"
            className="self-start"
            disabled={!pessoas.length}
            onClick={() => {
              baixar(
                `${titulo
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^A-Za-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .toLowerCase()}.csv`,
                csvDaLista(pessoas),
              );
              toast.success("Lista exportada. Abre no Excel e no Google Planilhas.");
            }}
          >
            <Download /> Exportar lista (CSV)
          </Botao>
          <ul className="flex flex-col gap-1.5">
            {pessoas.map((p) => (
              <li
                key={p.contato_id}
                className="rounded-botao border border-border bg-card px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{p.nome || p.telefone}</span>
                  {p.pode_receber ? null : <Chip tom="neutro">não recebe agora</Chip>}
                </div>
                <p className="text-xs text-muted-foreground">{descricaoPessoa(p)}</p>
                {p.motivo ? <p className="text-xs text-atencao-foreground">{p.motivo}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const CHAVE_PLANILHA = ["listas", "planilha"] as const;

/** Planilha "Nexa OS — Listas" no Google Drive: abrir e atualizar agora (o admin). */
function PlanilhaDoGoogle({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const lerFn = useServerFn(planilhaListasFn);
  const atualizarFn = useServerFn(atualizarPlanilhaListasFn);
  const q = useQuery({ queryKey: CHAVE_PLANILHA, queryFn: () => lerFn() });
  const [atualizando, setAtualizando] = useState(false);
  const p = q.data;
  if (!p) return null;

  async function atualizar() {
    setAtualizando(true);
    try {
      const r = await atualizarFn({ fetch: fetchDireto });
      toast.success(
        r.criada
          ? `Planilha criada no Google Drive com ${plural(r.pessoas, "pessoa", "pessoas")}.`
          : `Planilha atualizada (${plural(r.pessoas, "pessoa", "pessoas")}).`,
      );
      await qc.invalidateQueries({ queryKey: CHAVE_PLANILHA });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar a planilha.");
    } finally {
      setAtualizando(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <IconePlanilha className="mt-0.5 size-5 shrink-0 text-marca" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold">Planilha do Google</h2>
          <p className="text-sm text-muted-foreground">
            {!p.googleConectado
              ? "Conecte a conta Google da empresa em Configurações → Modelos de ordem de serviço para ter a planilha."
              : p.url
                ? `“Nexa OS — Listas”, no Drive da empresa. Atualiza sozinha todo dia às 9h${
                    p.atualizadaEm ? ` · última: ${dateTimeBR(p.atualizadaEm)}` : ""
                  }.`
                : "Ainda não foi criada. Ela é criada no Drive da empresa na primeira atualização e depois se atualiza sozinha todo dia às 9h."}
          </p>
        </div>
      </div>
      {p.googleConectado ? (
        <div className="flex flex-wrap gap-2">
          {p.url ? (
            <Botao asChild variante="contorno">
              <a href={p.url} target="_blank" rel="noreferrer">
                <ExternalLink /> Abrir planilha
              </a>
            </Botao>
          ) : null}
          {admin ? (
            <Botao variante="neutro" disabled={atualizando} onClick={() => void atualizar()}>
              <RefreshCw className={atualizando ? "animate-spin" : undefined} />
              {atualizando ? "Atualizando…" : p.url ? "Atualizar agora" : "Criar planilha"}
            </Botao>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Listas() {
  const { papel } = usePapel();
  const contagemFn = useServerFn(contagemListasFn);
  const modelosFn = useServerFn(modelosDasListasFn);
  const q = useQuery({ queryKey: ["listas", "contagem"], queryFn: () => contagemFn() });
  const modelos = useQuery({
    queryKey: ["listas", "modelos"],
    queryFn: () => modelosFn(),
    enabled: papel === "admin",
    staleTime: 300_000,
  });
  const [aberta, setAberta] = useState<OpcaoLista | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        voltarPara="/marketing"
        titulo="Listas"
        descricao="Quem está em cada lista hoje. As listas se atualizam sozinhas pelas datas do CRM: ninguém precisa mexer."
      />
      <PlanilhaDoGoogle admin={papel === "admin"} />
      {q.error ? (
        <Card className="text-sm">
          {q.error instanceof Error ? q.error.message : "Erro ao carregar."}
        </Card>
      ) : null}
      {FAMILIAS.map((def) => (
        <Card key={def.familia} className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-bold">{def.nome}</h2>
            <p className="text-sm text-muted-foreground">{def.explicacao}</p>
          </div>
          <ModelosDaFamilia def={def} m={modelos.data} />
          <ul className="flex flex-col divide-y divide-border">
            {def.opcoes.map((o) => {
              const c = q.data?.[o.chave];
              return (
                <li key={o.chave} className="flex min-h-12 items-center gap-3 py-1.5">
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{o.rotulo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c
                        ? `${plural(c.total, "pessoa", "pessoas")} · ${c.podem} podem receber agora`
                        : q.isLoading
                          ? "Contando…"
                          : "—"}
                    </span>
                  </span>
                  <Botao variante="neutro" disabled={!c?.total} onClick={() => setAberta(o)}>
                    <Users /> Ver
                  </Botao>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      <QuemEsta opcao={aberta} aberto={Boolean(aberta)} fechar={() => setAberta(null)} />
    </div>
  );
}
