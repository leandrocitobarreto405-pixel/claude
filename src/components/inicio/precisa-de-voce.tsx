import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { Botao, Card, Chip } from "@/components/nexa";
import { Destino } from "@/components/crm/destino-lead";
import { mensagemDeErro } from "@/lib/erros";
import { brl, dateBR, todayISO } from "@/lib/format";
import { chamarLeadPeloModelo, marcarLeadChamado } from "@/lib/leads-site.functions";
import {
  ORDEM_SECOES,
  TITULO_SECAO,
  filtrarItens,
  type FiltroPrecisa,
  type ItemPrecisa,
} from "@/lib/precisa-de-voce";
import {
  concluirFollowupEquipeFn,
  precisaDeVoceFn,
  resolverAvisoPrecisaFn,
} from "@/lib/precisa-de-voce.functions";

const CHAVE = ["precisa-de-voce"] as const;

function horaSP(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Bloco fixo no topo do Início: o que depende da pessoa hoje, em ordem de urgência (item F).
 * Atendente vê o que é dela e o que está sem dono; admin vê todos, com filtro por pessoa.
 */
export function PrecisaDeVoce() {
  const buscar = useServerFn(precisaDeVoceFn);
  const { data, isLoading, error } = useQuery({
    queryKey: CHAVE,
    queryFn: () => buscar(),
    refetchInterval: 60_000,
  });
  const [filtro, setFiltro] = useState<FiltroPrecisa>("meus");

  if (error)
    return (
      <Card className="text-sm text-problema-foreground">
        {mensagemDeErro(error, "Não deu para carregar o que precisa de você.", "precisa")}
      </Card>
    );
  if (isLoading || !data) return <Card className="min-h-24 animate-pulse" aria-busy />;

  const itens = filtrarItens(data.itens, filtro, data.meuId);
  const total = itens.length + (data.semDesfecho.quantidade ? 1 : 0);

  return (
    <Card aria-labelledby="precisa-titulo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="precisa-titulo" className="text-lg font-bold">
          Precisa de você hoje{total ? ` · ${itens.length + data.semDesfecho.quantidade}` : ""}
        </h2>
        {data.souAdmin ? (
          <select
            aria-label="De quem"
            className="min-h-11 rounded-botao border border-border bg-card px-3 text-sm"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          >
            <option value="meus">Os meus + sem dono</option>
            <option value="todos">Todos</option>
            {data.pessoas
              .filter((p) => p.id !== data.meuId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </select>
        ) : null}
      </div>

      {!itens.length && !data.semDesfecho.quantidade ? (
        <p className="flex items-center justify-center gap-2 rounded-card bg-marca-claro p-5 font-bold text-marca">
          <CheckCircle2 className="size-5" aria-hidden /> Tudo em dia ✔
        </p>
      ) : null}

      {ORDEM_SECOES.map((secao) => {
        const daSecao = itens.filter((i) => i.secao === secao);
        if (!daSecao.length) return null;
        return (
          <section key={secao} className="flex flex-col gap-2" aria-label={TITULO_SECAO[secao]}>
            <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {TITULO_SECAO[secao]}
              <Chip tom={secao === "urgente" ? "problema" : "neutro"}>{daSecao.length}</Chip>
            </h3>
            <ul className="flex flex-col gap-2">
              {daSecao.map((i) => (
                <LinhaPrecisa key={i.chave} item={i} />
              ))}
            </ul>
          </section>
        );
      })}

      {data.semDesfecho.quantidade ? (
        <section className="flex flex-col gap-2" aria-label="Orçamentos sem desfecho">
          <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Orçamentos sem desfecho <Chip>{data.semDesfecho.quantidade}</Chip>
          </h3>
          <Link
            to="/crm/follow-ups"
            search={{ aba: "sem-desfecho" }}
            className="flex min-h-11 items-center justify-between gap-2 rounded-card border border-border p-3 text-sm"
          >
            <span className="text-muted-foreground">
              {data.semDesfecho.quantidade} esperando o motivo ({brl(data.semDesfecho.valor)} no
              total)
            </span>
            <span className="inline-flex items-center font-bold text-marca">
              Marcar motivos <ChevronRight className="size-4" aria-hidden />
            </span>
          </Link>
        </section>
      ) : null}
    </Card>
  );
}

function LinhaPrecisa({ item }: { item: ItemPrecisa }) {
  const qc = useQueryClient();
  const resolverAviso = useServerFn(resolverAvisoPrecisaFn);
  const concluir = useServerFn(concluirFollowupEquipeFn);
  const chamar = useServerFn(chamarLeadPeloModelo);
  const marcar = useServerFn(marcarLeadChamado);
  const [ocupado, setOcupado] = useState(false);
  const urgente = item.secao === "urgente";

  async function acao(f: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await f();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não deu certo.", "precisa"));
    } finally {
      setOcupado(false);
    }
  }

  const abrir = item.conversaId ? (
    <Botao asChild>
      <Link to="/conversas/$conversaId" params={{ conversaId: item.conversaId }}>
        {item.secao === "esperando" ? "Responder" : "Abrir conversa"}
      </Link>
    </Botao>
  ) : null;

  return (
    <li
      className={
        urgente
          ? "flex flex-col gap-2 rounded-card border border-problema-foreground/30 bg-problema p-3"
          : "flex flex-col gap-2 rounded-card border border-border p-3"
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          <p className="flex flex-wrap items-center gap-2 font-bold">
            {urgente ? <Chip tom="problema">CONCORRÊNCIA</Chip> : null}
            {item.secao === "followup" && item.quando ? (
              <Chip tom="atencao">
                {item.quando.slice(0, 10) === todayISO()
                  ? horaSP(item.quando)
                  : `Atrasado · ${dateBR(item.quando)}`}
              </Chip>
            ) : null}
            <span className="min-w-0 break-words">{item.nome}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.detalhe}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {item.secao === "lead_site" ? (
            <>
              {item.modeloEnviado || item.dentroDaJanela ? (
                abrir
              ) : (
                <Botao
                  disabled={ocupado}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Fora da janela de 24 h: vai o modelo aprovado (tc_lead_site) pelo WhatsApp oficial. Enviar?",
                      )
                    )
                      return;
                    void acao(
                      () => chamar({ data: { id: item.leadSiteId! } }),
                      "Modelo enviado: a resposta cai com a Alice.",
                    );
                  }}
                >
                  Chamar no WhatsApp
                </Botao>
              )}
              <Botao
                variante="contorno"
                disabled={ocupado}
                onClick={() =>
                  void acao(
                    () => marcar({ data: { id: item.leadSiteId!, chamado: true } }),
                    "Marcado: você ligou.",
                  )
                }
              >
                Liguei
              </Botao>
            </>
          ) : (
            abrir
          )}
          {item.secao === "esperando" && !item.donoUserId && item.conversaId ? (
            <Botao variante="contorno" asChild>
              <Link to="/conversas/$conversaId" params={{ conversaId: item.conversaId }}>
                Assumir
              </Link>
            </Botao>
          ) : null}
          {item.secao === "followup" && item.followupId ? (
            <Botao
              variante="contorno"
              disabled={ocupado}
              onClick={() =>
                void acao(() => concluir({ data: { id: item.followupId! } }), "Follow-up feito.")
              }
            >
              Feito
            </Botao>
          ) : null}
          {urgente && item.avisoId ? (
            <Botao
              variante="contorno"
              disabled={ocupado}
              onClick={() =>
                void acao(() => resolverAviso({ data: { id: item.avisoId! } }), "Resolvido.")
              }
            >
              Resolvido
            </Botao>
          ) : null}
        </div>
      </div>
      {(urgente || item.secao === "followup") && item.leadId ? (
        <Destino
          leadId={item.leadId}
          aoConcluir={async () => {
            if (item.followupId) await concluir({ data: { id: item.followupId } });
            if (item.avisoId) await resolverAviso({ data: { id: item.avisoId } });
            await qc.invalidateQueries({ queryKey: CHAVE });
          }}
        />
      ) : null}
    </li>
  );
}
