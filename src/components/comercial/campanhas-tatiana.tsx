// Tatiana › Campanhas (só admin): desempenho de cada campanha de WhatsApp enviada, por 7 dias:
// números, respostas mais comuns e as sugestões da Tatiana para a próxima. Nada é enviado daqui.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, Chip, NumeroGrande, Recolhido } from "@/components/nexa";
import { NOME_TIPO_SUGESTAO } from "@/lib/comercial/campanhas";
import { campanhasTatianaFn, type CampanhaTela } from "@/lib/tatiana.functions";
import { brl, dateBR } from "@/lib/format";

const CHAVE_CAMPANHAS = ["tatiana", "campanhas"];

const pct = (v: number | null) => (v === null ? "—" : `${String(v).replace(".", ",")}%`);
const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

export function CampanhasTatiana() {
  const fn = useServerFn(campanhasTatianaFn);
  const q = useQuery({ queryKey: CHAVE_CAMPANHAS, queryFn: () => fn() });
  if (q.isLoading) return <Card className="text-sm">Carregando…</Card>;
  if (q.error)
    return (
      <Card className="text-sm text-problema-foreground">
        {q.error instanceof Error ? q.error.message : "Não foi possível carregar."}
      </Card>
    );
  const lista = q.data ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Cada campanha enviada é acompanhada por 7 dias a partir do primeiro envio. Respostas contam
        nesses 7 dias; orçamentos e vendas ligados à campanha contam em até 30 dias (regra do
        Marketing). O WhatsApp não devolve a confirmação de entrega, então "enviados" é o que saiu
        sem erro. A Tatiana atualiza os números toda noite, às 22h.
      </p>
      {!lista.length ? (
        <Card className="text-sm">
          Nenhuma campanha acompanhada ainda. As campanhas enviadas nos últimos 45 dias entram na
          próxima passada da noite.
        </Card>
      ) : null}
      {lista.map((c) => (
        <Campanha key={c.id} c={c} />
      ))}
    </div>
  );
}

function Campanha({ c }: { c: CampanhaTela }) {
  const n = c.numeros;
  const maior = Math.max(1, ...c.classes.map((x) => x.n));
  const periodo = c.datas.length
    ? c.datas.length === 1
      ? dateBR(c.datas[0]!)
      : `${dateBR(c.datas[0]!)} a ${dateBR(c.datas[c.datas.length - 1]!)}`
    : dateBR(c.janelaInicio.slice(0, 10));
  return (
    <Card className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="font-titulo text-xl">{c.nome}</h2>
        <Chip tom={c.encerrada ? "neutro" : "sucesso"}>
          {c.encerrada ? "7 dias fechados" : `dia ${c.dia} de 7`}
        </Chip>
        <span className="text-xs text-muted-foreground">
          enviada em {periodo}
          {c.tema ? ` · ${c.tema}` : ""}
        </span>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="min-w-0">
          <NumeroGrande tamanho="pequeno" valor={n.enviados} legenda="enviados" />
        </Card>
        <Card className="min-w-0">
          <NumeroGrande
            tamanho="pequeno"
            valor={n.responderam}
            legenda={`responderam (${pct(n.pctResposta)})`}
          />
        </Card>
        <Card className="min-w-0">
          <NumeroGrande tamanho="pequeno" valor={n.orcamentos} legenda="pediram orçamento" />
        </Card>
        <Card className="min-w-0">
          <NumeroGrande
            tamanho="pequeno"
            valor={n.fecharam}
            legenda={`fecharam (${pct(n.pctVenda)})`}
          />
        </Card>
        <Card className="min-w-0">
          <NumeroGrande tamanho="pequeno" valor={brl(n.vendido)} legenda="vendido" />
        </Card>
        <Card className="min-w-0">
          <NumeroGrande
            tamanho="pequeno"
            valor={n.retorno === null ? "—" : `${String(n.retorno).replace(".", ",")}x`}
            legenda={`retorno · custo ${brl(n.custo)}`}
          />
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        {n.erros ? `${n.erros} com erro de envio · ` : ""}
        {n.descadastros} {n.descadastros === 1 ? "descadastro" : "descadastros"}
        {n.bloqueios ? ` · ${n.bloqueios} bloqueados pela trava` : ""}
        {c.semTexto
          ? ` · ${c.semTexto} ${c.semTexto === 1 ? "resposta" : "respostas"} sem texto`
          : ""}
      </p>

      {c.classes.length ? (
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-bold">Respostas mais comuns</h3>
          <ul className="flex min-w-0 flex-col gap-1.5">
            {c.classes.map((x) => (
              <li key={x.classe} className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="flex justify-between gap-2">
                  <span>{x.nome}</span>
                  <span className="tabular-nums text-muted-foreground">{x.n}</span>
                </span>
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-marca"
                    style={{ width: `${Math.round((x.n / maior) * 100)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {n.responderam ? "Respostas ainda sem classe." : "Ninguém respondeu ainda."}
        </p>
      )}

      {c.encerrada && c.sugestoes.length ? (
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-bold">Para a próxima campanha</h3>
          {c.leitura ? <p className="text-sm">{c.leitura}</p> : null}
          <ul className="flex min-w-0 flex-col gap-2">
            {c.sugestoes.map((s, i) => (
              <li key={i} className="flex min-w-0 items-start gap-2 text-sm">
                <Chip tom="neutro" className="shrink-0">
                  {NOME_TIPO_SUGESTAO[s.tipo] ?? s.tipo}
                </Chip>
                <span className="min-w-0 break-words">{s.sugestao}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Sugestões só para ler: nada é aplicado nem enviado sem o seu OK no Marketing.
          </p>
        </div>
      ) : !c.encerrada ? (
        <p className="text-sm text-muted-foreground">
          As sugestões para a próxima campanha saem quando os 7 dias fecharem (
          {dateBR(c.janelaFim.slice(0, 10))}).
        </p>
      ) : null}

      <Recolhido titulo="Detalhes">
        <p className="p-4 text-xs text-muted-foreground">
          Janela: {dateBR(c.janelaInicio.slice(0, 10))} a {dateBR(c.janelaFim.slice(0, 10))} ·
          atualizado em {dateBR(c.atualizadoEm.slice(0, 10))} · custo da IA {usd(c.custoUsd)} ·
          situação no Marketing: {c.status || "—"}
        </p>
      </Recolhido>
    </Card>
  );
}
