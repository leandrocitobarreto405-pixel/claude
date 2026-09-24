import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { brl, pct } from "@/lib/format";
import {
  avaliarMargem,
  lucroOrcamento,
  type AvaliacaoMargem,
  type CustosOrcamento,
  type ModoMargem,
} from "@/lib/quotes";

const ESTILO: Record<AvaliacaoMargem["status"], { box: string; Icon: typeof CheckCircle2 }> = {
  verde: { box: "border-emerald-300 bg-emerald-50 text-emerald-800", Icon: CheckCircle2 },
  amarelo: { box: "border-amber-300 bg-amber-50 text-amber-800", Icon: AlertTriangle },
  vermelho: { box: "border-destructive/40 bg-destructive/10 text-destructive", Icon: XCircle },
};

type Props = {
  total: number;
  custos: CustosOrcamento;
  taxaPct: number;
  impostoPct: number;
  alvoPct: number;
  minPct: number;
  contribMinPct: number;
  contribWarnPct: number;
  modo: ModoMargem;
  custoFixoFonte?:
    | {
        valor: number;
        fixasMes: number;
        mediaServicos: number;
        mesesCompletos: number;
        mediaHistorico: number;
        fonte: string;
      }
    | undefined;
};

/** Painel interno "Pode fechar?": contribuição, lucro final e desconto aplicável. */
export function MargemOrcamento({
  total,
  custos,
  taxaPct,
  impostoPct,
  alvoPct,
  minPct,
  contribMinPct,
  contribWarnPct,
  modo,
  custoFixoFonte,
}: Props) {
  const { custoTotal, lucro, lucroPct, contribuicao, contribuicaoPct } = lucroOrcamento(total, custos);
  const custosVariaveisDoServico = custos.deslocamento + custos.produtos + custos.maoObra;
  const avaliacao = avaliarMargem({
    total,
    lucroPct,
    contribuicaoPct,
    custosFixosNaoPercentuais: custosVariaveisDoServico + custos.fixo,
    custosVariaveisDoServico,
    taxaPct,
    impostoPct,
    alvoPct,
    minPct,
    contribMinPct,
    contribWarnPct,
    modo,
  });
  const { box, Icon } = ESTILO[avaliacao.status];
  const agenda = modo === "agenda";

  const linhas: [string, number][] = [
    ["Deslocamento", custos.deslocamento],
    ["Produtos", custos.produtos],
    ["Mão de obra", custos.maoObra],
    [`Taxa do cartão (${pct(taxaPct, 1)})`, custos.taxa],
    [`Imposto (${pct(impostoPct, 0)})`, custos.imposto],
    ["Custos fixos (rateio)", custos.fixo],
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className={`flex items-start gap-3 rounded-xl border p-4 ${box}`}>
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">{avaliacao.rotulo}</p>
          {agenda ? (
            <p className="text-sm">
              Margem de contribuição de {brl(contribuicao)} ({pct(contribuicaoPct, 1)}). Mínimo para
              preencher agenda: {pct(contribMinPct, 0)}.
            </p>
          ) : (
            <p className="text-sm">
              Lucro de {brl(lucro)} ({pct(lucroPct, 1)}). Meta: {pct(alvoPct, 0)} ou mais; mínimo
              aceitável {pct(minPct, 1)}.
            </p>
          )}
        </div>
      </div>

      {agenda ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-900">
          Serviço de preenchimento de agenda: ele não cobre o rateio de custos fixos
          {custos.fixo > 0 ? ` (${brl(custos.fixo)} por serviço)` : ""}, então deve ser exceção — só
          para ocupar horário que ficaria ocioso.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Receita</p>
          <p className="text-lg font-medium">{brl(total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Custos do serviço</p>
          <p className="text-lg font-medium">{brl(round(total - contribuicao))}</p>
        </div>
        <div className={agenda ? "rounded-lg bg-background p-2 ring-1 ring-border" : ""}>
          <p className="text-xs text-muted-foreground">Margem de contribuição</p>
          <p className="text-lg font-semibold">
            {brl(contribuicao)} · {pct(contribuicaoPct, 1)}
          </p>
        </div>
        <div className={agenda ? "" : "rounded-lg bg-background p-2 ring-1 ring-border"}>
          <p className="text-xs text-muted-foreground">Lucro final (com rateio)</p>
          <p className="text-lg font-semibold">
            {brl(lucro)} · {pct(lucroPct, 1)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 p-4">
        <p className="text-sm font-medium">Desconto aplicável</p>
        {avaliacao.pisoPreco === null ? (
          <p className="mt-1 text-sm text-destructive">
            Com essas taxas não é possível atingir o mínimo — revise taxa/imposto.
          </p>
        ) : avaliacao.descontoAplicavel > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Você ainda pode dar até <strong>{brl(avaliacao.descontoAplicavel)}</strong> de desconto.
            O valor mínimo deste orçamento é <strong>{brl(avaliacao.pisoPreco)}</strong>
            {agenda ? " (piso de contribuição para preencher agenda)" : ""}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-destructive">
            Sem margem para desconto. O valor mínimo é{" "}
            <strong>{brl(avaliacao.pisoPreco)}</strong> — falta subir{" "}
            {brl(avaliacao.pisoPreco - total)}.
          </p>
        )}
      </div>

      <details className="rounded-xl border border-border/70 p-4">
        <summary className="cursor-pointer text-sm font-medium">Quebra dos custos</summary>
        <ul className="mt-3 space-y-1.5 text-sm">
          {linhas.map(([nome, valor]) => (
            <li key={nome} className="flex justify-between">
              <span className="text-muted-foreground">{nome}</span>
              <span>{brl(valor)}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-border/70 pt-1.5 font-medium">
            <span>Total de custos</span>
            <span>{brl(custoTotal)}</span>
          </li>
        </ul>
        {custoFixoFonte ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Rateio de custos fixos: {brl(custoFixoFonte.fixasMes)} de despesas fixas do mês ÷{" "}
            {custoFixoFonte.mediaServicos} serviços/mês
            {custoFixoFonte.fonte === "estimativa"
              ? " (média informada por você nas Configurações)"
              : custoFixoFonte.fonte === "manual"
                ? " (valor definido manualmente nas Configurações)"
                : ` (média automática de ${custoFixoFonte.mesesCompletos} ${
                    custoFixoFonte.mesesCompletos === 1 ? "mês cheio" : "meses cheios"
                  })`}{" "}
            = {brl(custoFixoFonte.valor)} por serviço.
          </p>
        ) : null}
      </details>
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
