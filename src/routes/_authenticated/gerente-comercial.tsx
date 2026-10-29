// Gerente comercial (só admin; ligado por empresa): fichas da análise dos atendimentos, perdas
// para confirmar (nada vira perdido sem clique), perdidos depois do orçamento, quem ainda dá para
// recuperar (mensagem só para copiar: nada é enviado), fila de encaixe e o custo da análise.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Botao, CabecalhoDeTela, Card, Chip, Recolhido } from "@/components/nexa";
import {
  confirmarPerdaFn,
  gerenteComercialFn,
  marcarEncaixeFn,
  naoPerdeuFn,
  type AnaliseTela,
  type GerenteComercial,
} from "@/lib/comercial.functions";
import { NOME_REGRA } from "@/lib/comercial/ficha";
import {
  conversaoPor,
  custos,
  funil,
  mediaNota,
  perdasPorMotivo,
  regrasQuebradas,
  servicoPrincipal,
} from "@/lib/comercial/resumo";
import { brl, dateBR } from "@/lib/format";
import { usePapel } from "@/lib/tenant";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/gerente-comercial")({
  head: () => ({ meta: [{ title: "Gerente comercial — Nexa OS" }] }),
  component: GerenteComercialTela,
});

const CHAVE = ["gerente-comercial"];
/** Receptivos de outubro na Turbine (escopo da fase 1), para a estimativa de custo total. */
const LEADS_PREVISTOS = 176;

const ABAS = [
  { id: "resumo", rotulo: "Resumo" },
  { id: "confirmar", rotulo: "Confirmar perdas" },
  { id: "perdidos", rotulo: "Perdidos após orçamento" },
  { id: "recuperar", rotulo: "Ainda dá para recuperar" },
  { id: "encaixe", rotulo: "Fila de encaixe" },
  { id: "fichas", rotulo: "Fichas" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

const RESULTADO: Record<NonNullable<AnaliseTela["resultado"]>, string> = {
  vendeu: "Vendeu",
  perdeu: "Perdeu",
  sem_desfecho: "Sem desfecho",
  sem_orcamento: "Sem orçamento",
};
const QUEM: Record<string, string> = {
  alice: "Alice",
  equipe: "Equipe",
  alice_e_equipe: "Alice e equipe",
  nao_identificado: "Não identificado",
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;
const mes = (iso: string | null) => (iso ? iso.slice(0, 7) : "");

function nomeLead(a: AnaliseTela) {
  return `${a.leadNome || "Sem nome"}${a.telefoneFinal ? ` · final ${a.telefoneFinal}` : ""}`;
}

function GerenteComercialTela() {
  const { papel } = usePapel();
  const admin = papel === "admin";
  const fn = useServerFn(gerenteComercialFn);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => fn(), enabled: admin });
  const [aba, setAba] = useState<Aba>("resumo");

  if (papel && !admin)
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Card className="text-center text-sm">Só o administrador vê esta tela.</Card>
      </div>
    );
  const d = q.data;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoDeTela
        sobretitulo="Vendas"
        titulo="Gerente comercial"
        descricao="Análise dos atendimentos, lead a lead. Só leitura: nada é enviado aos clientes e nada muda na Alice."
      />
      {q.isLoading ? <Card className="text-sm">Carregando…</Card> : null}
      {q.error ? (
        <Card className="text-sm text-problema-foreground">
          {q.error instanceof Error ? q.error.message : "Não foi possível carregar."}
        </Card>
      ) : null}
      {d && !d.ligado ? (
        <Card className="text-sm">O gerente comercial ainda não está ligado nesta empresa.</Card>
      ) : null}
      {d && d.ligado ? (
        <>
          <Custos d={d} />
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAba(a.id)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border border-border px-4 text-sm font-semibold",
                  aba === a.id ? "border-marca bg-marca text-marca-foreground" : "bg-card",
                )}
              >
                {a.rotulo}
                <Contagem aba={a.id} d={d} />
              </button>
            ))}
          </div>
          {aba === "resumo" ? <Resumo d={d} /> : null}
          {aba === "confirmar" ? <ConfirmarPerdas d={d} /> : null}
          {aba === "perdidos" ? <Perdidos d={d} /> : null}
          {aba === "recuperar" ? <Recuperar d={d} /> : null}
          {aba === "encaixe" ? <Encaixe d={d} /> : null}
          {aba === "fichas" ? <Fichas d={d} /> : null}
        </>
      ) : null}
    </div>
  );
}

const paraConfirmar = (d: GerenteComercial) =>
  d.analises.filter(
    (a) =>
      a.status === "ok" &&
      a.resultado === "sem_desfecho" &&
      !a.perdaSituacao &&
      !a.leadPerdidoEm &&
      a.motivoSugeridoId,
  );
const paraRecuperar = (d: GerenteComercial) =>
  d.analises.filter(
    (a) =>
      a.status === "ok" &&
      a.aindaVale &&
      a.mensagemSugerida &&
      a.resultado !== "vendeu" &&
      a.perdaSituacao !== "confirmada" &&
      a.perdaSituacao !== "trocada",
  );
const naFila = (d: GerenteComercial) =>
  d.analises.filter((a) => a.encaixePedidoEm || (a.pediuEncaixe && a.resultado !== "vendeu"));

function Contagem({ aba, d }: { aba: Aba; d: GerenteComercial }) {
  const n =
    aba === "confirmar"
      ? paraConfirmar(d).length
      : aba === "recuperar"
        ? paraRecuperar(d).length
        : aba === "encaixe"
          ? naFila(d).length
          : 0;
  return n ? <span className="ml-1.5 tabular-nums opacity-80">{n}</span> : null;
}

function Custos({ d }: { d: GerenteComercial }) {
  const c = custos(d.analises, LEADS_PREVISTOS);
  const rodando = d.lotes.find((l) => l.status === "rodando" || l.status === "pendente");
  return (
    <Card className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p>
          <span className="font-bold">{c.analisadas}</span> fichas
        </p>
        <p>
          Gasto <span className="font-bold">{usd(d.gastoUsd)}</span> de {usd(d.tetoUsd)} (teto)
        </p>
        <p>
          Média por ficha <span className="font-bold">{usd(c.medio)}</span>
        </p>
        <p className="text-muted-foreground">
          Estimativa para os {LEADS_PREVISTOS} receptivos de outubro: {usd(c.estimativaTotal)}
        </p>
      </div>
      {rodando ? (
        <p className="text-muted-foreground">
          Lote “{rodando.descricao || "análise"}”: {rodando.processados} de {rodando.total} (
          {rodando.status === "pendente" ? "na fila" : "rodando"}; avança a cada 5–10 min).
        </p>
      ) : null}
      {d.lotes.some((l) => l.status === "parado_teto") ? (
        <p className="text-atencao-foreground">Um lote parou perto do teto de gasto.</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Rotina diária: {d.rotinaDiaria ? "ligada" : "desligada"}.
      </p>
    </Card>
  );
}

function Tabela({
  cabecalho,
  linhas,
}: {
  cabecalho: string[];
  linhas: Array<Array<React.ReactNode>>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
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
  );
}

function Resumo({ d }: { d: GerenteComercial }) {
  const ok = d.analises.filter((a) => a.status === "ok");
  if (!ok.length)
    return <Card className="text-sm">Nenhuma ficha pronta ainda. O lote avança sozinho.</Card>;
  const grupos = (["google", "outras"] as const).map((g) => {
    const fs = ok.filter((a) => a.grupo === g);
    const vendas = fs.filter((a) => a.resultado === "vendeu").length;
    return [
      g === "google" ? "Google" : "Outras origens",
      fs.length,
      fs.filter((a) => a.resultado !== "sem_orcamento").length,
      vendas,
      fs.length ? pct(vendas / fs.length) : "—",
      mediaNota(fs)?.toFixed(1).replace(".", ",") ?? "—",
    ];
  });
  const porServico = conversaoPor(ok, (a) => servicoPrincipal(a.servico));
  const porOrigem = conversaoPor(ok, (a) => a.origem ?? "Sem origem");
  const motivos = perdasPorMotivo(ok).slice(0, 5);
  const regras = regrasQuebradas(ok);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <h2 className="font-bold">Google × outras origens</h2>
        <Tabela
          cabecalho={["Grupo", "Leads", "Com orçamento", "Vendas", "Conversão", "Nota média"]}
          linhas={grupos}
        />
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">Onde os leads somem</h2>
        <Tabela cabecalho={["Etapa", "Leads"]} linhas={funil(ok).map((f) => [f.etapa, f.n])} />
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">Top 5 motivos de perda (R$ orçado)</h2>
        <Tabela
          cabecalho={["Motivo", "Leads", "Valor"]}
          linhas={motivos.map((m) => [m.motivo, m.n, brl(m.valor)])}
        />
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <h2 className="font-bold">Conversão por serviço</h2>
        <Tabela
          cabecalho={["Serviço", "Leads", "Vendas", "Conversão", "Vendido"]}
          linhas={porServico.map((l) => [
            l.chave,
            l.leads,
            l.vendas,
            pct(l.conversao),
            brl(l.vendido),
          ])}
        />
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <h2 className="font-bold">Conversão por origem</h2>
        <Tabela
          cabecalho={["Origem", "Leads", "Vendas", "Conversão", "Vendido"]}
          linhas={porOrigem.map((l) => [
            l.chave,
            l.leads,
            l.vendas,
            pct(l.conversao),
            brl(l.vendido),
          ])}
        />
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <h2 className="font-bold">Regras quebradas (Alice × equipe)</h2>
        <Tabela
          cabecalho={["Regra", "Avaliadas", "Alice quebrou", "Equipe quebrou"]}
          linhas={regras.map((r) => [r.nome, r.avaliadas, r.alice, r.equipe])}
        />
      </Card>
      {d.relatorio ? (
        <Relatorio r={d.relatorio} />
      ) : (
        <Card className="text-xs text-muted-foreground lg:col-span-2">
          O relatório completo (padrões das vendas, perfil de quem mais fecha, erros com exemplos e
          sugestões) sai quando todas as fichas estiverem prontas.
        </Card>
      )}
    </div>
  );
}

function Relatorio({ r }: { r: NonNullable<GerenteComercial["relatorio"]> }) {
  const l = r.leitura;
  const lista = (itens: string[]) => (
    <ul className="ml-4 list-disc space-y-1 text-sm">
      {itens.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
  return (
    <>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <h2 className="font-bold">Defeitos da Alice para corrigir</h2>
        <p className="text-xs text-muted-foreground">
          Leads que começaram antes de 28/10: {r.numeros.leadsAntesDepois.antes} · depois:{" "}
          {r.numeros.leadsAntesDepois.depois}.
        </p>
        <Tabela
          cabecalho={["Defeito", "Antes de 28/10", "Depois", "Total"]}
          linhas={r.numeros.defeitosAlice.map((x) => [x.nome, x.antes, x.depois, x.total])}
        />
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">Padrões das vendas</h2>
        {lista(l.padroes_vendas.map((p) => `${p.padrao} (${p.casos} casos)`))}
        <h3 className="mt-2 font-bold">Perfil de quem mais fecha</h3>
        <p className="text-sm">{l.perfil_que_mais_fecha}</p>
        <h3 className="mt-2 font-bold">Onde os leads somem</h3>
        <p className="text-sm">{l.onde_somem}</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">Vendeu × não vendeu</h2>
        {lista(l.vendeu_x_nao_vendeu.map((v) => `${v.servico}: ${v.diferenca}`))}
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <h2 className="font-bold">Erros recorrentes</h2>
        {(["alice", "equipe"] as const).map((q) => (
          <div key={q}>
            <h3 className="font-semibold">{q === "alice" ? "Alice" : "Equipe"}</h3>
            {lista(
              l.erros_recorrentes
                .filter((e) => e.quem === q)
                .map((e) => `${e.erro} (${e.casos} casos). Ex.: ${e.exemplos.join(" · ")}`),
            )}
          </div>
        ))}
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <h2 className="font-bold">Sugestões</h2>
        <ul className="flex flex-col gap-1.5 text-sm">
          {l.sugestoes.map((s, i) => (
            <li key={i}>
              <Chip tom={s.forca === "forte" ? "sucesso" : "neutro"}>
                {s.forca === "forte" ? "Forte" : "Hipótese"}
              </Chip>{" "}
              {s.sugestao} <span className="text-muted-foreground">({s.casos} casos)</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3 lg:col-span-2">
        <h2 className="font-bold">Mudanças sugeridas na Alice (não aplicadas)</h2>
        {l.mudancas_alice.map((m, i) => (
          <div key={i} className="flex flex-col gap-1 text-sm">
            <p className="font-semibold">
              {m.tema} <span className="font-normal text-muted-foreground">({m.casos} casos)</span>
            </p>
            <p className="whitespace-pre-wrap rounded-botao bg-background p-2">
              <span className="font-semibold">Antes: </span>
              {m.antes}
            </p>
            <p className="whitespace-pre-wrap rounded-botao bg-marca-claro p-2">
              <span className="font-semibold">Depois: </span>
              {m.depois}
            </p>
          </div>
        ))}
      </Card>
      <Card className="text-xs text-muted-foreground lg:col-span-2">
        {r.periodo} · relatório de {dateBR(r.criadoEm.slice(0, 10))} · custo do relatório{" "}
        {usd(r.custoUsd)} · rotina diária estimada:{" "}
        {r.estimativaMensal.map((e) => `${e.empresa} ${usd(e.usdMes)}/mês`).join(" · ")}
      </Card>
    </>
  );
}

function ConfirmarPerdas({ d }: { d: GerenteComercial }) {
  const lista = paraConfirmar(d);
  if (!lista.length) return <Card className="text-sm">Nenhuma perda esperando confirmação.</Card>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Orçamento enviado e sem desfecho: a IA sugere o motivo. Nada vira perdido sem o seu clique.
      </p>
      {lista.map((a) => (
        <CartaoPerda key={a.id} a={a} motivos={d.motivos} />
      ))}
    </div>
  );
}

function CartaoPerda({ a, motivos }: { a: AnaliseTela; motivos: GerenteComercial["motivos"] }) {
  const qc = useQueryClient();
  const confirmar = useServerFn(confirmarPerdaFn);
  const naoPerdeu = useServerFn(naoPerdeuFn);
  const [trocando, setTrocando] = useState(false);
  const [motivo, setMotivo] = useState(a.motivoSugeridoId ?? "");
  const [data, setData] = useState("");
  const [salvando, setSalvando] = useState(false);
  const escolhido = motivos.find((m) => m.id === motivo);

  async function agir(f: () => Promise<unknown>, ok: string) {
    setSalvando(true);
    try {
      await f();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }
  const enviar = () => {
    if (escolhido?.pedeData === "retorno" && !data) {
      toast.error("Informe a data para voltar a falar com o cliente.");
      return;
    }
    void agir(
      () => confirmar({ data: { analiseId: a.id, motivoId: motivo, data: data || null } }),
      "Perda registrada.",
    );
  };

  return (
    <Card className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">{nomeLead(a)}</p>
        <span className="text-muted-foreground">
          {servicoPrincipal(a.servico)} · {brl(a.valorOrcado ?? 0)}
        </span>
      </div>
      <p>
        Motivo sugerido: <Chip tom="atencao">{a.motivoSugerido}</Chip>
      </p>
      {a.fraseCliente ? <p className="italic text-muted-foreground">“{a.fraseCliente}”</p> : null}
      {trocando || escolhido?.pedeData ? (
        <div className="flex flex-wrap items-end gap-2">
          {trocando ? (
            <select
              aria-label="Motivo"
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            >
              {motivos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          ) : null}
          {escolhido?.pedeData ? (
            <label className="flex flex-col gap-1 text-xs">
              {escolhido.pedeData === "retorno" ? "Voltar a falar em" : "Data que o cliente queria"}
              <input
                type="date"
                className="min-h-11 rounded-md border border-input bg-background px-3"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Botao onClick={enviar} disabled={salvando || !motivo}>
          {trocando ? "Confirmar este motivo" : "Confirmar"}
        </Botao>
        {trocando ? null : (
          <Botao variante="contorno" onClick={() => setTrocando(true)} disabled={salvando}>
            Trocar motivo
          </Botao>
        )}
        <Botao
          variante="neutro"
          disabled={salvando}
          onClick={() =>
            void agir(() => naoPerdeu({ data: { analiseId: a.id } }), "Marcado: ainda não perdeu.")
          }
        >
          Ainda não perdeu
        </Botao>
      </div>
    </Card>
  );
}

function Perdidos({ d }: { d: GerenteComercial }) {
  const base = d.analises.filter(
    (a) =>
      a.status === "ok" &&
      a.resultado !== "sem_orcamento" &&
      a.resultado !== "vendeu" &&
      (a.leadPerdidoEm || a.perdaSituacao === "confirmada" || a.perdaSituacao === "trocada"),
  );
  const [motivo, setMotivo] = useState("");
  const [servico, setServico] = useState("");
  const [mesSel, setMesSel] = useState("");
  const motivoDe = (a: AnaliseTela) => a.perdaMotivoFinal ?? a.motivoRegistrado ?? "Sem motivo";
  const opcoes = useMemo(
    () => ({
      motivos: [...new Set(base.map(motivoDe))].sort(),
      servicos: [...new Set(base.map((a) => servicoPrincipal(a.servico)))].sort(),
      meses: [...new Set(base.map((a) => mes(a.criadoEm)).filter(Boolean))].sort().reverse(),
    }),
    [base],
  );
  const lista = base.filter(
    (a) =>
      (!motivo || motivoDe(a) === motivo) &&
      (!servico || servicoPrincipal(a.servico) === servico) &&
      (!mesSel || mes(a.criadoEm) === mesSel),
  );
  const filtro = (rot: string, v: string, set: (s: string) => void, ops: string[]) => (
    <select
      aria-label={rot}
      className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
      value={v}
      onChange={(e) => set(e.target.value)}
    >
      <option value="">{rot}: todos</option>
      {ops.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {filtro("Motivo", motivo, setMotivo, opcoes.motivos)}
        {filtro("Serviço", servico, setServico, opcoes.servicos)}
        {filtro("Mês", mesSel, setMesSel, opcoes.meses)}
      </div>
      <p className="text-sm text-muted-foreground">
        {lista.length} perdidos · {brl(lista.reduce((s, a) => s + (a.valorOrcado ?? 0), 0))} orçados
      </p>
      {lista.map((a) => (
        <Card key={a.id} className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{nomeLead(a)}</p>
            <span className="text-muted-foreground">
              {servicoPrincipal(a.servico)} · {brl(a.valorOrcado ?? 0)}
            </span>
          </div>
          <p>
            <Chip>{motivoDe(a)}</Chip>
            {a.perdaSituacao === "trocada" ? (
              <span className="ml-2 text-xs text-muted-foreground">
                (sugerido: {a.motivoSugerido})
              </span>
            ) : null}
          </p>
          {a.fraseCliente ? (
            <p className="italic text-muted-foreground">“{a.fraseCliente}”</p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function Recuperar({ d }: { d: GerenteComercial }) {
  const lista = paraRecuperar(d);
  if (!lista.length) return <Card className="text-sm">Ninguém para recuperar por enquanto.</Card>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Mensagens sugeridas só para copiar: nada é enviado daqui.
      </p>
      {lista.map((a) => (
        <Card key={a.id} className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{nomeLead(a)}</p>
            <span className="text-muted-foreground">
              {servicoPrincipal(a.servico)} · {brl(a.valorOrcado ?? 0)}
            </span>
          </div>
          <p className="whitespace-pre-wrap rounded-botao bg-background p-3">
            {a.mensagemSugerida}
          </p>
          <Botao
            variante="contorno"
            className="self-start"
            onClick={() =>
              void navigator.clipboard
                .writeText(a.mensagemSugerida ?? "")
                .then(() => toast.success("Mensagem copiada."))
                .catch(() => toast.error("Não foi possível copiar."))
            }
          >
            <Copy aria-hidden /> Copiar
          </Botao>
        </Card>
      ))}
    </div>
  );
}

function Encaixe({ d }: { d: GerenteComercial }) {
  const qc = useQueryClient();
  const marcar = useServerFn(marcarEncaixeFn);
  const lista = naFila(d);
  async function mudar(a: AnaliseTela, pediu: boolean) {
    try {
      await marcar({ data: { leadId: a.leadId, pediu, obs: a.fraseCliente ?? "" } });
      await qc.invalidateQueries({ queryKey: CHAVE });
      toast.success(pediu ? "Entrou na fila de encaixe." : "Saiu da fila de encaixe.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }
  if (!lista.length) return <Card className="text-sm">Ninguém pediu encaixe.</Card>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Quem pediu um horário que não tinha (manhã, sábado, data cheia). Os sugeridos pela análise
        só entram na fila com o seu clique.
      </p>
      {lista.map((a) => (
        <Card key={a.id} className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{nomeLead(a)}</p>
            {a.encaixePedidoEm ? (
              <Chip tom="sucesso">Na fila desde {dateBR(a.encaixePedidoEm.slice(0, 10))}</Chip>
            ) : (
              <Chip tom="atencao">Sugerido pela análise</Chip>
            )}
          </div>
          {a.encaixeObs || a.fraseCliente ? (
            <p className="italic text-muted-foreground">“{a.encaixeObs || a.fraseCliente}”</p>
          ) : null}
          <Botao
            variante={a.encaixePedidoEm ? "neutro" : "contorno"}
            className="self-start"
            onClick={() => void mudar(a, !a.encaixePedidoEm)}
          >
            {a.encaixePedidoEm ? "Tirar da fila" : "Marcar: pediu encaixe"}
          </Botao>
        </Card>
      ))}
    </div>
  );
}

function Fichas({ d }: { d: GerenteComercial }) {
  const [grupo, setGrupo] = useState<"" | "google" | "outras">("");
  const lista = d.analises.filter((a) => !grupo || a.grupo === grupo);
  return (
    <div className="flex flex-col gap-3">
      <select
        aria-label="Grupo"
        className="min-h-11 self-start rounded-md border border-input bg-background px-3 text-sm"
        value={grupo}
        onChange={(e) => setGrupo(e.target.value as typeof grupo)}
      >
        <option value="">Google e outras</option>
        <option value="google">Só Google</option>
        <option value="outras">Só outras origens</option>
      </select>
      {lista.map((a) => (
        <Recolhido
          key={a.id}
          titulo={
            <span className="flex flex-col">
              <span>{nomeLead(a)}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {servicoPrincipal(a.servico)} · {a.resultado ? RESULTADO[a.resultado] : "—"}
                {a.nota !== null ? ` · nota ${a.nota}` : ""}
              </span>
            </span>
          }
          extra={a.status === "erro" ? <Chip tom="problema">Erro</Chip> : null}
        >
          <DetalheFicha a={a} />
        </Recolhido>
      ))}
    </div>
  );
}

function DetalheFicha({ a }: { a: AnaliseTela }) {
  if (a.status === "erro") return <p className="p-4 text-sm">Não analisada: {a.erro}</p>;
  const f = a.ficha;
  const t = a.fatos;
  if (!f || !t) return <p className="p-4 text-sm">Ficha ainda não pronta.</p>;
  const linha = (rot: string, v: React.ReactNode) => (
    <p>
      <span className="font-semibold">{rot}: </span>
      {v || "—"}
    </p>
  );
  const min = (m: number | null) =>
    m === null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  return (
    <div className="flex flex-col gap-1.5 p-4 text-sm">
      {linha("Origem", `${a.grupo === "google" ? "Google" : "Outras"} · ${a.origem ?? "—"}`)}
      {linha(
        "Perfil",
        `${f.perfil.tipo === "empresa" ? "Empresa" : f.perfil.tipo === "residencia" ? "Residência" : "Não dá para saber"} · ${f.perfil.motivo} · urgência ${f.perfil.urgencia.replace("_", " ")}`,
      )}
      {linha("Objeção principal", f.objecao_principal)}
      {linha(
        "Preço enviado",
        t.precoEnviado
          ? `${brl(t.precoEnviado.total ?? t.precoEnviado.cartao ?? 0)}${t.precoEnviado.pix ? ` (Pix ${brl(t.precoEnviado.pix)})` : ""} · ${min(t.tempoAtePrecoMin)} até o preço`
          : "não enviou",
      )}
      {linha(
        "1ª resposta",
        `${min(t.primeiraRespostaMin)}${t.primeiraRespostaDe ? ` (${QUEM[t.primeiraRespostaDe]})` : ""}`,
      )}
      {linha("Quem atendeu", QUEM[a.quemAtendeu ?? ""] ?? "—")}
      {linha("Follow-ups", `${t.followups.total} (${t.followups.respondidos} respondidos)`)}
      <div className="mt-1">
        <p className="font-semibold">Regras</p>
        <ul className="mt-1 flex flex-col gap-1">
          {f.regras.map((r) => (
            <li key={r.regra}>
              <Chip
                tom={
                  r.situacao === "seguiu"
                    ? "sucesso"
                    : r.situacao === "quebrou"
                      ? "problema"
                      : "neutro"
                }
              >
                {r.situacao === "seguiu"
                  ? "Seguiu"
                  : r.situacao === "quebrou"
                    ? "Quebrou"
                    : "Não se aplica"}
              </Chip>{" "}
              {NOME_REGRA[r.regra]}
              {r.quem !== "nao_se_aplica" ? ` (${QUEM[r.quem]})` : ""}
              {r.evidencia ? <span className="text-muted-foreground"> — {r.evidencia}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      {linha("Esfriou", f.momento_esfriou)}
      {linha("Resultado", `${a.resultado ? RESULTADO[a.resultado] : "—"} · ${f.resumo_resultado}`)}
      {a.resultado === "vendeu"
        ? linha("O que ajudou a vender", f.o_que_ajudou_a_vender)
        : linha("Motivo sugerido", a.motivoSugerido ?? f.motivo_perda_sugerido)}
      {f.frase_cliente ? linha("Frase do cliente", `“${f.frase_cliente}”`) : null}
      {linha("O que poderia ter sido feito", f.o_que_poderia_ter_sido_feito)}
      {f.erros.length ? (
        <div>
          <p className="font-semibold">Erros</p>
          <ul className="ml-4 list-disc">
            {f.erros.map((e, i) => (
              <li key={i}>
                {QUEM[e.quem]}: {e.erro}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {linha("Nota", `${f.nota}/10`)}
      {linha("Ainda vale chamar", f.ainda_vale_chamar ? `Sim — “${f.mensagem_sugerida}”` : "Não")}
      <p className="text-xs text-muted-foreground">
        Custo da análise: {usd(a.custoUsd)}
        {a.analisadoEm ? ` · ${dateBR(a.analisadoEm.slice(0, 10))}` : ""}
      </p>
    </div>
  );
}
