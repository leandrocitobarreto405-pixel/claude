import { mensagemDeErro } from "@/lib/erros";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronRight, Plus } from "lucide-react";
import { AvatarEmpresa, Botao, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { FaixaHorariosLivres } from "@/components/agenda/faixa-horarios-livres";
import { Atalhos } from "@/components/painel/atalhos";
import { CartaoNumero } from "@/components/painel/cartao-numero";
import {
  FunilMini,
  GraficoVendasPorOrigem,
  GraficoVendidoPorSemana,
} from "@/components/painel/graficos";
import { MetaDoMes } from "@/components/painel/meta-do-mes";
import { SeletorPeriodo } from "@/components/painel/seletor-periodo";
import {
  brl,
  currentMonth,
  monthEnd,
  monthStart,
  pct,
  todayISO,
  tomorrowISO,
  weekdayPT,
} from "@/lib/format";
import { VendasPorEquipe } from "@/components/painel/vendas-por-equipe";
import { dataPorExtenso, horaEmSaoPaulo, primeiroNome, saudacao } from "@/lib/inicio";
import { variacao, type Periodo } from "@/lib/painel";
import { resumoPainel } from "@/lib/painel.functions";
import { displayName, useProfile, useSession } from "@/lib/session";
import { podeAcessar, useContextoTenant, usePapel } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/inicio")({
  // `?avisos=1` abre o painel de avisos (links antigos de /avisos e notificações).
  validateSearch: (s: Record<string, unknown>): { avisos?: string } =>
    s["avisos"] === "1" ? { avisos: "1" } : {},
  head: () => ({
    meta: [
      { title: "Início — Nexa OS" },
      {
        name: "description",
        content: "Painel do dia: vendido, realizado, recebido, a receber, meta e atalhos.",
      },
      { property: "og:title", content: "Início — Nexa OS" },
      {
        property: "og:description",
        content: "Painel do dia: vendido, realizado, recebido, a receber, meta e atalhos.",
      },
    ],
  }),
  component: Inicio,
});

const CHAVE_PERIODO = "nexa.painel.periodo";

function periodoSalvo(): Periodo {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(CHAVE_PERIODO) : null;
    return v === "hoje" || v === "semana" || v === "mes" ? v : "mes";
  } catch {
    return "mes";
  }
}

// Decisão E: Vendas (o que a equipe Nexa acompanha) e Operacional (serviços e caixa da empresa).
type AbaInicio = "vendas" | "operacional";
const CHAVE_ABA = "nexa.painel.aba";

function abaSalva(): AbaInicio | null {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(CHAVE_ABA) : null;
    return v === "vendas" || v === "operacional" ? v : null;
  } catch {
    return null;
  }
}

function AbasInicio({ valor, aoMudar }: { valor: AbaInicio; aoMudar: (a: AbaInicio) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Início"
      className="grid grid-cols-2 gap-1 rounded-botao bg-muted p-1"
    >
      {(
        [
          ["vendas", "Vendas"],
          ["operacional", "Operacional"],
        ] as const
      ).map(([id, rotulo]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={valor === id}
          onClick={() => aoMudar(id)}
          className={
            valor === id
              ? "min-h-11 rounded-botao bg-card text-sm font-bold text-foreground shadow-card"
              : "min-h-11 rounded-botao text-sm font-medium text-muted-foreground"
          }
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

const n = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;

function Inicio() {
  const hoje = todayISO();
  const amanha = tomorrowISO();
  const profile = useProfile();
  const { user } = useSession();
  const { papel } = usePapel();
  const { data: tenant } = useContextoTenant();
  const souNexa = tenant?.souNexa === true;
  const [periodo, setPeriodo] = useState<Periodo>(periodoSalvo);
  // Padrão: Vendas para quem vende (atendente e equipe Nexa); Operacional para o admin da empresa.
  const [abaEscolhida, setAba] = useState<AbaInicio | null>(abaSalva);
  const aba: AbaInicio = abaEscolhida ?? (papel === "admin" && !souNexa ? "operacional" : "vendas");
  const buscar = useServerFn(resumoPainel);
  const {
    data: r,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["painel", periodo],
    queryFn: () => buscar({ data: { periodo } }),
  });

  const pode = (to: string) => (papel ? podeAcessar(papel, to, souNexa) : false);
  // Telas do Financeiro só para o admin: a atendente vê os números, mas não entra nas listas.
  const financeiro = papel === "admin" || souNexa;
  const nome = primeiroNome(displayName(profile, user?.email));
  const carregando = isLoading && !r;

  function mudarAba(a: AbaInicio) {
    setAba(a);
    try {
      window.localStorage.setItem(CHAVE_ABA, a);
    } catch {
      // Sem localStorage: a escolha vale só para esta aba.
    }
  }

  function mudarPeriodo(p: Periodo) {
    setPeriodo(p);
    try {
      window.localStorage.setItem(CHAVE_PERIODO, p);
    } catch {
      // Sem localStorage: a escolha vale só para esta aba.
    }
  }

  const comparacao = r
    ? `Variação em relação ${r.comparacao === "ontem" ? "a ontem" : r.comparacao === "semana passada" ? "à semana passada" : "ao mês passado"}.`
    : "";
  const semRecebimento = r?.semRecebimento ?? { valor: 0, quantidade: 0 };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {tenant?.ativa ? (
        <div className="flex items-center gap-3">
          <AvatarEmpresa
            empresaId={tenant.ativa.empresa.id}
            nome={tenant.ativa.empresa.nome}
            tamanho={44}
          />
          <p className="truncate text-sm font-semibold text-muted-foreground">
            {tenant.ativa.empresa.nome}
          </p>
        </div>
      ) : null}
      <CabecalhoDeTela
        sobretitulo={`${weekdayPT(hoje)}, ${dataPorExtenso(hoje)}`}
        titulo={`${saudacao(horaEmSaoPaulo())}${nome ? `, ${nome}` : ""}`}
        acao={
          pode("/nova-os") ? (
            <Botao asChild>
              <Link to="/nova-os">
                <Plus /> Nova OS
              </Link>
            </Botao>
          ) : null
        }
      />

      <AbasInicio valor={aba} aoMudar={mudarAba} />

      {aba === "operacional" && pode("/promocao") ? <FaixaHorariosLivres /> : null}

      <section className="flex flex-col gap-3" aria-labelledby="painel-titulo">
        <h2 id="painel-titulo" className="sr-only">
          Painel financeiro
        </h2>
        <SeletorPeriodo valor={periodo} aoMudar={mudarPeriodo} />

        {error ? (
          <Card className="text-sm text-problema-foreground">
            {mensagemDeErro(error, "Não deu para carregar os números agora.", "inicio")}
          </Card>
        ) : null}

        {aba === "operacional" ? (
          <>
            {semRecebimento.valor > 0 ? (
              <Card className="flex-row items-center gap-3 border-atencao-foreground/30 bg-atencao">
                <AlertTriangle className="size-5 shrink-0 text-atencao-foreground" aria-hidden />
                <p className="min-w-0 flex-1 text-sm text-atencao-foreground">
                  <strong>{brl(semRecebimento.valor)}</strong> em{" "}
                  {n(semRecebimento.quantidade, "serviço concluído", "serviços concluídos")} sem
                  recebimento.
                </p>
                {financeiro ? (
                  <Botao asChild variante="claro" className="shrink-0">
                    <Link to="/a-receber" search={{ aba: "concluido" }}>
                      Registrar
                    </Link>
                  </Botao>
                ) : null}
              </Card>
            ) : null}

            {r && r.vendidoMes.atrasadoQtd > 0 ? (
              <Card className="flex-row items-center gap-3 border-atencao-foreground/30 bg-atencao">
                <AlertTriangle className="size-5 shrink-0 text-atencao-foreground" aria-hidden />
                <p className="min-w-0 flex-1 text-sm text-atencao-foreground">
                  <strong>{brl(r.vendidoMes.atrasado)}</strong> em{" "}
                  {n(r.vendidoMes.atrasadoQtd, "serviço", "serviços")} com data passada não
                  concluídos.
                </p>
                {pode("/servicos") ? (
                  <Botao asChild variante="claro" className="shrink-0">
                    <Link to="/servicos" search={{ aba: "para-concluir" }}>
                      Concluir
                    </Link>
                  </Botao>
                ) : null}
              </Card>
            ) : null}
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {aba === "vendas" ? (
            <>
              <CartaoNumero
                titulo="Vendido"
                valor={brl(r?.vendido.valor)}
                legenda="serviços agendados no período"
                detalhe={
                  r
                    ? `${n(r.vendido.quantidade, "OS", "OS")} · realizado ${brl(r.vendido.realizado)} · agendado ${brl(r.vendido.agendado)}${r.vendido.atrasado > 0 ? ` · atrasado ${brl(r.vendido.atrasado)}` : ""}`
                    : undefined
                }
                nota={
                  r && r.vendido.liquido < r.vendido.valor
                    ? `líquido do repasse: ${brl(r.vendido.liquido)}`
                    : undefined
                }
                variacao={r ? variacao(r.vendido.valor, r.vendido.anterior.valor) : null}
                {...(pode("/oss") ? { to: "/oss" } : {})}
                carregando={carregando}
              />
              <CartaoNumero
                titulo="Ticket médio"
                valor={brl(r?.ticketMedio.valor)}
                detalhe="Vendido ÷ nº de OS"
                variacao={r ? variacao(r.ticketMedio.valor, r.ticketMedio.anterior) : null}
                carregando={carregando}
              />
              <CartaoNumero
                titulo="Conversão de leads"
                valor={r?.conversao.pct === null || !r ? "—" : pct(r.conversao.pct, 0)}
                detalhe={
                  r
                    ? `${r.conversao.os} de ${n(r.conversao.leads, "lead que chamou", "leads que chamaram")} viraram OS${
                        r.conversao.anterior.pct !== null
                          ? ` · ${r.comparacao}: ${pct(r.conversao.anterior.pct, 0)}`
                          : ""
                      }`
                    : undefined
                }
                {...(pode("/crm/funil") ? { to: "/indicadores" } : {})}
                carregando={carregando}
              />
            </>
          ) : (
            <>
              <CartaoNumero
                titulo="Realizado"
                valor={brl(r?.vendido.realizado)}
                legenda="serviços concluídos no período"
                detalhe={r ? `Parte do Vendido do período` : undefined}
                {...(pode("/servicos") ? { to: "/servicos", search: { aba: "realizados" } } : {})}
                carregando={carregando}
              />
              <CartaoNumero
                titulo="Recebido"
                valor={brl(r?.recebido.valor)}
                legenda="entrou no caixa no período"
                detalhe={r ? n(r.recebido.quantidade, "pagamento", "pagamentos") : undefined}
                variacao={r ? variacao(r.recebido.valor, r.recebido.anterior.valor) : null}
                {...(financeiro ? { to: "/pagamentos" } : {})}
                carregando={carregando}
              />
              <CartaoNumero
                titulo="A receber"
                valor={brl(r?.aReceber.total)}
                legenda="tudo em aberto, de qualquer mês"
                detalhe={
                  r
                    ? `Concluídos ${brl(r.aReceber.concluidos)} · agendados ${brl(r.aReceber.agendados)}`
                    : undefined
                }
                {...(financeiro ? { to: "/a-receber", search: { aba: "concluido" } } : {})}
                carregando={carregando}
              />
              {r?.despesas ? (
                <CartaoNumero
                  titulo="Despesas do mês"
                  valor={brl(r.despesas.pagas)}
                  detalhe={
                    r.despesas.aPagar > 0
                      ? `Pagas · ${brl(r.despesas.aPagar)} ainda a pagar`
                      : "Pagas no mês"
                  }
                  to="/despesas"
                  carregando={carregando}
                />
              ) : null}
              {r && r.lucro !== null ? (
                <CartaoNumero
                  titulo="Lucro estimado"
                  valor={brl(r.lucro)}
                  detalhe="Pelo DRE do mês (só o recebido)"
                  to="/dre"
                  destaque
                  carregando={carregando}
                />
              ) : null}
            </>
          )}
        </div>
        {r ? <p className="text-xs text-muted-foreground">{comparacao}</p> : null}
      </section>

      {aba === "vendas" ? (
        <>
          <MetaDoMes r={r} carregando={carregando} podeDefinir={pode("/configuracoes")} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card aria-label="Vendido por semana">
              <h3 className="text-sm font-bold">Vendido por semana</h3>
              {r ? (
                <GraficoVendidoPorSemana dados={r.vendidoPorSemana} />
              ) : (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              )}
            </Card>
            <Card aria-label="Vendas por origem">
              <h3 className="text-sm font-bold">Vendas por origem</h3>
              {r ? (
                <GraficoVendasPorOrigem dados={r.vendidoPorOrigem} />
              ) : (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              )}
            </Card>
            <Card aria-label="Funil de leads">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold">Leads → orçamento → OS</h3>
                {pode("/crm/funil") ? (
                  <Link
                    to="/crm/funil"
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-success hover:text-marca"
                  >
                    Funil <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </div>
              {r ? (
                <FunilMini c={r.conversao} />
              ) : (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              )}
            </Card>
          </div>

          <VendasPorEquipe de={monthStart(currentMonth())} ate={monthEnd(currentMonth())} />
        </>
      ) : (
        <>
          {/* Hoje · Amanhã · Para concluir: cada chip abre a lista. */}
          <nav aria-label="Serviços" className="grid grid-cols-3 gap-2">
            <ChipLista
              rotulo="Hoje"
              valor={r?.chips.hoje}
              to="/agenda"
              search={{ modo: "dia", tecnico: undefined, status: undefined, dia: undefined }}
            />
            <ChipLista
              rotulo="Amanhã"
              valor={r?.chips.amanha}
              to="/agenda"
              search={{ modo: "dia", tecnico: undefined, status: undefined, dia: amanha }}
            />
            <ChipLista
              rotulo="Para concluir"
              valor={r?.chips.paraConcluir}
              to="/servicos"
              search={{ aba: "para-concluir" }}
              atencao={(r?.chips.paraConcluir ?? 0) > 0}
            />
          </nav>
        </>
      )}

      <section className="flex flex-col gap-2.5" aria-labelledby="atalhos-titulo">
        <h2 id="atalhos-titulo" className="font-titulo text-xl">
          Atalhos
        </h2>
        <Atalhos papel={papel} souNexa={souNexa} />
      </section>
    </div>
  );
}

function ChipLista({
  rotulo,
  valor,
  to,
  search,
  atencao = false,
}: {
  rotulo: string;
  valor: number | undefined;
  to: string;
  search: Record<string, string | undefined>;
  atencao?: boolean;
}) {
  return (
    <Link
      to={to as never}
      search={search as never}
      className="flex min-h-14 items-center justify-between gap-2 rounded-card border border-border bg-card px-3 py-2 hover:border-marca/40"
    >
      <span className="text-sm font-bold">{rotulo}</span>
      <Chip tom={atencao ? "atencao" : "neutro"}>{valor ?? "…"}</Chip>
    </Link>
  );
}
