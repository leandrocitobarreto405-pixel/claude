// Tatiana › Mês › Plano de ação do dia (só admin): 1 a 3 ações com lista, tamanho, modelo,
// condição, custo e venda esperada. "Aprovar" cria um rascunho no Marketing; o envio continua só
// pelo "Ativar" de lá. "Recusar" só registra. Nada é enviado daqui.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Card, Chip } from "@/components/nexa";
import { NOME_TIPO_ACAO, type AcaoPlano } from "@/lib/comercial/plano";
import { decidirAcaoFn, planoTatianaFn } from "@/lib/tatiana.functions";
import { brl, dateBR } from "@/lib/format";

const CHAVE_PLANO = ["tatiana", "plano"];
const pct = (v: number) => `${String(v).replace(".", ",")}%`;
/** Sem centavos: "R$ 50". */
const brl0 = (v: number) =>
  `R$ ${Math.round(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
/** Venda esperada sem fração: "menos de 1 venda", "~1 venda", "~3 vendas". */
function vendasTexto(v: number): string {
  if (v < 1) return "menos de 1 venda";
  const n = Math.round(v);
  return `~${n} ${n === 1 ? "venda" : "vendas"}`;
}

export function PlanoTatiana() {
  const fn = useServerFn(planoTatianaFn);
  const q = useQuery({ queryKey: CHAVE_PLANO, queryFn: () => fn() });
  if (q.isLoading) return <Card className="text-sm">Carregando o plano…</Card>;
  if (q.error)
    return (
      <Card className="text-sm text-problema-foreground">
        {q.error instanceof Error ? q.error.message : "Não foi possível carregar o plano."}
      </Card>
    );
  const p = q.data;
  if (!p)
    return (
      <Card className="flex min-w-0 flex-col gap-1">
        <h2 className="font-titulo text-xl">Plano de ação</h2>
        <p className="text-sm text-muted-foreground">
          A Tatiana monta o plano do dia às 8h20. Ainda não há plano nesta empresa.
        </p>
      </Card>
    );
  const pendentes = p.acoes.filter((a) => a.status === "sugerida").length;
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="font-titulo text-xl">Plano de ação de {dateBR(p.dia)}</h2>
        {pendentes ? <Chip tom="atencao">{pendentes} para aprovar</Chip> : null}
      </div>
      {p.contexto.erro ? (
        <p className="rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground">
          Não consegui montar o plano de hoje (motivo técnico: {p.contexto.erro}). Tento de novo na
          próxima passada da manhã.
        </p>
      ) : null}
      {p.contexto.avisos?.length ? (
        <p className="text-sm text-muted-foreground">
          Plano montado sem uma parte: {p.contexto.avisos.join("; ")}.
        </p>
      ) : null}
      {p.leitura ? <p className="text-sm">{p.leitura}</p> : null}
      {!p.acoes.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma ação proposta hoje.</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">
          {p.acoes.map((a) => (
            <Acao key={a.indice} planoId={p.id} a={a} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Venda esperada pelo histórico das campanhas
        {p.contexto.taxasHistoricas ? " da empresa" : " (padrão: poucas campanhas acompanhadas)"}.
        Desconto máximo {pct(p.contexto.limitePct)}; quem recebeu mensagem nos últimos{" "}
        {p.contexto.travaDias} dias e quem pediu para parar ficam de fora. Aprovar cria um rascunho
        no Marketing; nada sai sem o Ativar de lá. Custo da IA{" "}
        {`US$ ${p.custoUsd.toFixed(2).replace(".", ",")}`}.
      </p>
    </Card>
  );
}

function Acao({ planoId, a }: { planoId: string; a: AcaoPlano }) {
  const qc = useQueryClient();
  const decidir = useServerFn(decidirAcaoFn);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: (v: { decisao: "aprovar" | "recusar"; motivo?: string }) =>
      decidir({
        data: {
          planoId,
          indice: a.indice,
          decisao: v.decisao,
          ...(v.motivo ? { motivo: v.motivo } : {}),
        },
      }),
    onSuccess: (r, v) => {
      void qc.invalidateQueries({ queryKey: CHAVE_PLANO });
      toast.success(
        v.decisao === "aprovar"
          ? "Rascunho criado no Marketing. Lá você prepara, confere e ativa."
          : "Ação recusada.",
      );
      if (r.campanhaId) setRecusando(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível decidir."),
  });
  const tom = a.status === "aprovada" ? "sucesso" : a.status === "recusada" ? "neutro" : "atencao";
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-background p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Chip tom="neutro">{NOME_TIPO_ACAO[a.tipo]}</Chip>
        <span className="font-semibold">{a.titulo}</span>
        <Chip tom={tom}>
          {a.status === "aprovada"
            ? "Aprovada · rascunho no Marketing"
            : a.status === "recusada"
              ? "Recusada"
              : "Para aprovar"}
        </Chip>
      </div>
      <p className="text-sm">{a.porque}</p>
      {a.texto ? <p className="text-sm italic">“{a.texto}”</p> : null}
      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <Linha
          r="Lista"
          v={`${a.lista.nome} · ${a.tamanho.podem} de ${a.tamanho.total} podem receber`}
        />
        <Linha r="Modelo" v={a.modelo} />
        <Linha
          r="Condição"
          v={
            a.condicao.semCondicao
              ? "sem condição"
              : `${a.condicao.texto ?? ""}${a.condicao.pct ? ` (${pct(a.condicao.pct)})` : ""}`
          }
        />
        <Linha r="Envio" v={`${dateBR(a.data)}${a.horaInicio ? ` às ${a.horaInicio}` : ""}`} />
        <Linha r="Custo de envio" v={brl(a.custo)} />
        <Linha
          r="Venda esperada"
          v={`${a.esperado.respostas} ${a.esperado.respostas === 1 ? "resposta" : "respostas"} · ${vendasTexto(a.esperado.vendas)} · ~${brl0(a.esperado.valor)}${a.esperado.descontoCusto ? ` (desconto custa ~${brl0(a.esperado.descontoCusto)})` : ""}`}
        />
      </dl>
      {a.acimaDaRegra ? (
        <p className="text-xs text-atencao-foreground">
          A Tatiana pediu mais desconto do que a regra permite; ficou em {pct(a.limitePct)}.
        </p>
      ) : null}
      {a.status === "sugerida" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Botao onClick={() => m.mutate({ decisao: "aprovar" })} disabled={m.isPending}>
              Aprovar
            </Botao>
            <Botao
              variante="contorno"
              onClick={() => setRecusando((v) => !v)}
              disabled={m.isPending}
            >
              Recusar
            </Botao>
          </div>
          {recusando ? (
            <div className="flex min-w-0 flex-col gap-2">
              <input
                className="min-h-11 rounded-botao border border-border bg-card px-3 text-sm"
                placeholder="Motivo (opcional)"
                value={motivo}
                maxLength={300}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <div>
                <Botao
                  variante="contorno"
                  onClick={() => m.mutate({ decisao: "recusar", ...(motivo ? { motivo } : {}) })}
                  disabled={m.isPending}
                >
                  Confirmar recusa
                </Botao>
              </div>
            </div>
          ) : null}
        </div>
      ) : a.status === "aprovada" ? (
        <p className="text-sm">
          <Link
            to="/marketing"
            className="font-semibold text-marca underline-offset-2 hover:underline"
          >
            Abrir no Marketing
          </Link>{" "}
          para preparar, conferir e ativar.
        </p>
      ) : a.motivo ? (
        <p className="text-xs text-muted-foreground">Motivo: {a.motivo}</p>
      ) : null}
    </li>
  );
}

function Linha({ r, v }: { r: string; v: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-muted-foreground">{r}:</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </div>
  );
}
