// Tatiana › Mês (só admin): meta do mês com ritmo por dia útil, previsão pelos orçamentos abertos,
// agenda livre até o fim do mês, leads por origem, conversão por serviço e os alertas de gerente.
// Tudo calculado na hora pelo servidor, sem IA. Nada é enviado daqui.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Card, Chip, NumeroGrande, Recolhido } from "@/components/nexa";
import { NOME_SERVICO } from "@/lib/comercial/mes";
import { PlanoTatiana } from "@/components/comercial/plano-tatiana";
import { mesTatianaFn } from "@/lib/tatiana.functions";
import { brl, dateBR } from "@/lib/format";

const CHAVE_MES = ["tatiana", "mes"];
const pct = (v: number | null) => (v === null ? "—" : `${String(v).replace(".", ",")}%`);
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const curta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaSemana = (iso: string) => DIA[new Date(`${iso}T12:00:00Z`).getUTCDay()];

export function MesTatiana() {
  const fn = useServerFn(mesTatianaFn);
  const q = useQuery({ queryKey: CHAVE_MES, queryFn: () => fn() });
  if (q.isLoading) return <Card className="text-sm">Carregando…</Card>;
  if (q.error || !q.data)
    return (
      <Card className="text-sm text-problema-foreground">
        {q.error instanceof Error ? q.error.message : "Não foi possível carregar."}
      </Card>
    );
  const m = q.data;
  const meta = m.meta;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PlanoTatiana />
      {m.alertas.length ? (
        <Card className="flex min-w-0 flex-col gap-2">
          <h2 className="font-titulo text-xl">Alertas de hoje</h2>
          <ul className="flex min-w-0 flex-col gap-2">
            {m.alertas.map((a) => (
              <li key={a.chave} className="flex min-w-0 items-start gap-2 text-sm">
                <Chip tom={a.gravidade === "alta" ? "problema" : "atencao"} className="shrink-0">
                  {a.gravidade === "alta" ? "Agir hoje" : "Olhar"}
                </Chip>
                <span className="min-w-0">
                  <span className="font-semibold">{a.titulo}.</span> {a.texto}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            A Tatiana avisa o admin às 8h (no app e por push), uma vez por alerta.
          </p>
        </Card>
      ) : (
        <Card className="text-sm">Nenhum alerta hoje.</Card>
      )}

      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="font-titulo text-xl">Meta de {mesPorExtenso(m.mes)}</h2>
          {meta.meta === null ? (
            <Link
              to="/configuracoes/empresa"
              className="text-sm font-semibold text-marca underline-offset-2 hover:underline"
            >
              Cadastrar meta
            </Link>
          ) : null}
        </div>
        <p className="text-sm">{m.frase}</p>
        <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
          <Card className="min-w-0">
            <NumeroGrande
              tamanho="pequeno"
              valor={brl(meta.vendidoServico)}
              legenda={`serviço no mês${meta.pct !== null ? ` (${pct(meta.pct)} da meta)` : ""}`}
            />
          </Card>
          <Card className="min-w-0">
            <NumeroGrande
              tamanho="pequeno"
              valor={brl(meta.vendidoVenda)}
              legenda="fechado no mês (data da venda)"
            />
          </Card>
          <Card className="min-w-0">
            <NumeroGrande
              tamanho="pequeno"
              valor={meta.ritmoNecessario === null ? "—" : brl(meta.ritmoNecessario)}
              legenda={`por dia útil · ${meta.diasUteisRestantes} ${meta.diasUteisRestantes === 1 ? "restante" : "restantes"}`}
            />
          </Card>
          <Card className="min-w-0">
            <NumeroGrande
              tamanho="pequeno"
              valor={brl(meta.ritmoAtual)}
              legenda={`ritmo até agora, por dia útil (${meta.diasUteisPassados} ${meta.diasUteisPassados === 1 ? "passado" : "passados"})`}
            />
          </Card>
        </div>
        <p className="text-xs text-muted-foreground">
          Serviço no mês = realizado {brl(meta.realizado)} + agendado {brl(meta.agendado)} +
          atrasado {brl(meta.atrasado)}, pela data do serviço, líquido do repasse. Dias úteis pelo
          horário de atendimento (Noites e teste).
        </p>
      </Card>

      <Card className="flex min-w-0 flex-col gap-3">
        <h2 className="font-titulo text-xl">Previsão pelos orçamentos abertos</h2>
        <p className="text-sm">
          {m.previsao.porServico.length
            ? `Se os orçamentos abertos fecharem como o histórico, entram mais ${brl(m.previsao.total)}: o mês chega a ${brl(m.previsao.chegaA)}${m.previsao.pctDaMeta !== null ? ` (${pct(m.previsao.pctDaMeta)} da meta)` : ""}.`
            : "Nenhum orçamento aberto (enviado nos últimos 30 dias ou ainda válido)."}
        </p>
        {m.previsao.porServico.length ? (
          <ul className="flex min-w-0 flex-col gap-1.5 text-sm">
            {m.previsao.porServico.map((p) => (
              <li key={p.servico} className="flex min-w-0 flex-wrap justify-between gap-x-3">
                <span className="min-w-0">
                  <span className="font-semibold">{p.nome}</span>: {p.orcamentos}{" "}
                  {p.orcamentos === 1 ? "orçamento" : "orçamentos"} · {brl(p.valor)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  × {pct0(p.conversao)}
                  {p.base === "servico" ? "" : p.base === "geral" ? " (geral)" : " (padrão)"} ={" "}
                  {brl(p.previsto)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Conversão histórica = de quem recebeu orçamento nas fichas da Tatiana (90 dias), por
          serviço; "geral" usa a empresa toda quando o serviço tem menos de 5 fichas, e "padrão"
          (30%) quando não há histórico nenhum.
        </p>
      </Card>

      <Card className="flex min-w-0 flex-col gap-3">
        <h2 className="font-titulo text-xl">Agenda até o fim do mês</h2>
        <p className="text-sm">
          {m.agenda.base
            ? `${m.agenda.livres} de ${m.agenda.base} horários livres nos dias úteis até ${curta(m.agenda.dias[m.agenda.dias.length - 1]?.data ?? m.hoje)}.`
            : "Sem horários base cadastrados (Configurações › Agenda)."}
          {m.agenda.vazios.length
            ? ` Agenda vazia em ${m.agenda.vazios.map((d) => `${diaSemana(d.data)} ${curta(d.data)}`).join(", ")}.`
            : ""}
        </p>
        {m.agenda.dias.length ? (
          <ul className="grid min-w-0 grid-cols-2 gap-1.5 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {m.agenda.dias.slice(0, 15).map((d) => (
              <li
                key={d.data}
                title={d.feriado ? `Feriado: ${d.feriado}` : undefined}
                className={`flex min-w-0 justify-between gap-2 rounded-botao px-2 py-1 ${
                  d.feriado
                    ? "bg-muted text-muted-foreground line-through"
                    : d.base > 0 && d.ocupados === 0
                      ? "bg-atencao text-atencao-foreground"
                      : "bg-muted"
                }`}
              >
                <span>
                  {diaSemana(d.data)} {curta(d.data)}
                </span>
                <span className="tabular-nums">
                  {d.feriado ? "feriado" : `${d.ocupados}/${d.base}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Ocupados/horários base por dia (próximos 15 dias úteis). Um atendimento ocupa o técnico
          pela duração configurada; o dia fica inteiro a partir do valor configurado ou quando a
          visita está marcada "ocupa o dia". Feriado sem "vamos trabalhar" fica fora.
        </p>
      </Card>

      <Recolhido titulo="Leads por origem e conversão por serviço">
        <div className="flex min-w-0 flex-col gap-4 p-4 text-sm">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="font-bold">
              Leads por origem: últimos 7 dias × média das 4 semanas anteriores
            </h3>
            {m.leadsPorOrigem.map((l) => (
              <p key={l.origem} className="flex min-w-0 justify-between gap-3">
                <span className="min-w-0 truncate">{l.origem}</span>
                <span className="tabular-nums">
                  {l.atual}{" "}
                  <span className="text-muted-foreground">
                    × {String(l.media4).replace(".", ",")}
                  </span>
                </span>
              </p>
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="font-bold">
              Conversão de quem recebeu orçamento: 28 dias × 28 anteriores
            </h3>
            {m.conversaoPorServico.length ? (
              m.conversaoPorServico.map((c) => (
                <p key={c.servico} className="flex min-w-0 justify-between gap-3">
                  <span className="min-w-0 truncate">{NOME_SERVICO[c.servico]}</span>
                  <span className="tabular-nums">
                    {c.atual.vendas}/{c.atual.comOrcamento}{" "}
                    <span className="text-muted-foreground">
                      × {c.anterior.vendas}/{c.anterior.comOrcamento}
                    </span>
                  </span>
                </p>
              ))
            ) : (
              <p className="text-muted-foreground">Ainda sem fichas suficientes.</p>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="font-bold">
              Objeções e motivos de perda (14 dias, {m.perdidos14d} perdas)
            </h3>
            {m.objecoes.length ? (
              m.objecoes.slice(0, 5).map((o) => (
                <p key={o.nome} className="flex min-w-0 justify-between gap-3">
                  <span className="min-w-0 truncate">{o.nome}</span>
                  <span className="tabular-nums">{o.n}</span>
                </p>
              ))
            ) : (
              <p className="text-muted-foreground">Nenhuma perda com motivo nos últimos 14 dias.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Calculado em {dateBR(m.hoje)}.</p>
        </div>
      </Recolhido>
    </div>
  );
}

function mesPorExtenso(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
