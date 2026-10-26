import { SELECT_LEADS_ALICE_NEXA } from "@/lib/consultas";
import { EnsaioNome } from "@/components/alice/ensaio-nome";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { EMPRESA_HEADER } from "@/lib/empresa-ativa";
import { brl, currentMonth, monthEnd, monthLabelPT, monthStart, parseNumberBR } from "@/lib/format";
import { useContextoTenant } from "@/lib/tenant";
import { fetchRecebidoDoPeriodo } from "@/lib/reports";
import { resumoNexaDaEmpresa } from "@/lib/comissao-nexa";
import {
  resumirAlice,
  taxa,
  valorOsVendida,
  type ExecucaoAlice,
  type LeadAlice,
  type MetricasAlice,
} from "@/lib/alice-metricas";

export const Route = createFileRoute("/_authenticated/nexa/alice")({
  head: () => ({
    meta: [
      { title: "Alice: custo e resultado — Nexa OS" },
      {
        name: "description",
        content: "Leads atendidos pela Alice, vendas, custo da IA e comissão da Nexa por empresa.",
      },
    ],
  }),
  component: AliceNexa,
});

/** Cotação lembrada só neste navegador (não é dado da empresa). */
const CHAVE_COTACAO = "nexa_alice_cotacao_usd";
const COTACAO_INICIAL = 5.5;

type LinhaEmpresa = {
  id: string;
  nome: string;
  m: MetricasAlice;
  /** Comissão da Nexa pelas vendas da Alice (IA) no mês, como no DRE. */
  comissaoAlice: number;
  /** Comissão da Nexa de todas as atendentes da Nexa (inclui a Alice). */
  comissaoTotal: number;
};

function lerCotacao() {
  try {
    const v = Number(localStorage.getItem(CHAVE_COTACAO));
    return v > 0 ? v : COTACAO_INICIAL;
  } catch {
    return COTACAO_INICIAL;
  }
}

const usd = (n: number, casas = 2) =>
  `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;

async function execucoesDaEmpresa(empresaId: string, de: string, ate: string) {
  const todas: ExecucaoAlice[] = [];
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await supabase
      .from("ia_execucoes")
      .select("crm_lead_id, conversa_id, custo_usd, mensagens_enviadas")
      .eq("empresa_id", empresaId)
      .gte("created_at", de)
      .lt("created_at", ate)
      .order("created_at")
      .range(pagina * 1000, pagina * 1000 + 999)
      .setHeader(EMPRESA_HEADER, empresaId);
    if (error) throw error;
    todas.push(...((data ?? []) as ExecucaoAlice[]));
    if ((data ?? []).length < 1000) return todas;
  }
}

async function leadsDaEmpresa(empresaId: string, ids: string[]) {
  const leads: LeadAlice[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from("crm_leads")
      .select(SELECT_LEADS_ALICE_NEXA)
      .in("id", ids.slice(i, i + 150))
      .setHeader(EMPRESA_HEADER, empresaId);
    if (error) throw error;
    for (const l of data ?? []) {
      const os = Array.isArray(l.os) ? (l.os[0] ?? null) : l.os;
      leads.push({
        id: l.id,
        orcamento_em: l.orcamento_em,
        os_criada_em: l.os_criada_em,
        valor_os: valorOsVendida(os),
      });
    }
  }
  return leads;
}

/** Dia seguinte (fim exclusivo do período), em São Paulo. */
function inicioDoDia(data: string) {
  return `${data}T00:00:00-03:00`;
}
function diaSeguinte(data: string) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function AliceNexa() {
  const { data: ctx } = useContextoTenant();
  const souNexa = ctx?.souNexa ?? false;
  const [mes, setMes] = useState(currentMonth());
  const [cotacao, setCotacao] = useState(lerCotacao);
  const [cotacaoTexto, setCotacaoTexto] = useState<string | null>(null);

  const from = monthStart(mes);
  const to = monthEnd(mes);

  const empresas = useQuery({
    queryKey: ["nexa_alice_metricas", from, to],
    enabled: souNexa,
    queryFn: async (): Promise<LinhaEmpresa[]> => {
      const { data: lista, error } = await supabase
        .from("empresas")
        .select("id, nome")
        .eq("ativo", true)
        .eq("eh_teste", false)
        .order("nome");
      if (error) throw error;
      // Uma empresa por vez, cada uma no próprio contexto.
      return Promise.all(
        (lista ?? []).map(async (e) => {
          const [execs, base] = await Promise.all([
            execucoesDaEmpresa(e.id, inicioDoDia(from), inicioDoDia(diaSeguinte(to))),
            fetchRecebidoDoPeriodo(from, to, undefined, e.id),
          ]);
          const ids = [...new Set(execs.map((x) => x.crm_lead_id).filter((x): x is string => !!x))];
          const leads = await leadsDaEmpresa(e.id, ids);
          const resumo = resumoNexaDaEmpresa(base.allocations);
          const comissaoAlice = Object.values(resumo.porVendedora)
            .filter((v) => v.ia)
            .reduce((s, v) => s + v.comissao, 0);
          return {
            id: e.id,
            nome: e.nome,
            m: resumirAlice(execs, leads),
            comissaoAlice,
            comissaoTotal: resumo.comissao,
          };
        }),
      );
    },
  });

  if (ctx && !souNexa) {
    return <EmptyState title="Acesso restrito à Nexa" />;
  }

  function aplicarCotacao(texto: string) {
    setCotacaoTexto(texto);
    const v = parseNumberBR(texto);
    if (Number.isFinite(v) && v > 0) {
      setCotacao(v);
      try {
        localStorage.setItem(CHAVE_COTACAO, String(v));
      } catch {
        // sem armazenamento no navegador: vale só nesta visita
      }
    }
  }

  // Empresas sem nada da Alice no mês ficam de fora.
  const linhas = (empresas.data ?? []).filter((l) => l.m.execucoes > 0 || l.comissaoAlice > 0);
  const custoTotal = linhas.reduce((s, l) => s + l.m.custoUsd, 0);
  const comissaoTotal = linhas.reduce((s, l) => s + l.comissaoAlice, 0);

  return (
    <>
      <PageHeader
        title="Alice: custo e resultado"
        description="O que a Alice atendeu em cada empresa, quanto virou venda, quanto custou e a comissão da Nexa pelas vendas dela."
      />

      <div className="mb-6">
        <EnsaioNome />
      </div>

      <section className="card-surface mb-6 grid gap-4 p-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mes-alice">Mês</Label>
          <Input
            id="mes-alice"
            type="month"
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cotacao-alice">Cotação do dólar (R$)</Label>
          <Input
            id="cotacao-alice"
            inputMode="decimal"
            className="w-[120px]"
            value={cotacaoTexto ?? String(cotacao).replace(".", ",")}
            onChange={(e) => aplicarCotacao(e.target.value)}
          />
        </div>
      </section>

      {empresas.isLoading ? (
        <p className="text-sm text-muted-foreground">Calculando…</p>
      ) : empresas.error ? (
        <p className="text-sm text-destructive">Não foi possível calcular as métricas do mês.</p>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Total titulo="Custo da IA" valor={brl(custoTotal * cotacao)} extra={usd(custoTotal)} />
            <Total titulo="Comissão da Nexa pela Alice" valor={brl(comissaoTotal)} />
            <Total
              titulo="Comissão menos custo"
              valor={brl(comissaoTotal - custoTotal * cotacao)}
              destaque
            />
          </div>

          <section className="card-surface mb-6 p-5">
            <h2 className="mb-1 text-lg font-semibold">Por empresa — {monthLabelPT(mes)}</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Atendidos: leads a quem a Alice mandou mensagem no mês. Orçamento e venda: o que esses
              leads já alcançaram (OS de teste, cancelada ou excluída não conta; valor sem o repasse
              a parceiros). A comissão é a da linha "Comissão Nexa" do DRE, só das vendas da Alice
              recebidas no mês.
            </p>
            {linhas.length ? (
              <div className="space-y-3">
                {linhas.map((l) => (
                  <CartaoEmpresa key={l.id} l={l} cotacao={cotacao} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">A Alice não atendeu ninguém no mês.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

function CartaoEmpresa({ l, cotacao }: { l: LinhaEmpresa; cotacao: number }) {
  const { m } = l;
  const custoBrl = m.custoUsd * cotacao;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{l.nome}</p>
        <p className="font-semibold">{brl(l.comissaoAlice - custoBrl)}</p>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Item rotulo="Leads atendidos" valor={String(m.leadsAtendidos)} />
        <Item
          rotulo="Chegaram ao orçamento"
          valor={`${m.chegaramOrcamento} (${taxa(m.chegaramOrcamento, m.leadsAtendidos)})`}
        />
        <Item rotulo="Vendidos" valor={`${m.vendidos} (${taxa(m.vendidos, m.leadsAtendidos)})`} />
        <Item rotulo="Valor vendido" valor={brl(m.valorVendido)} />
        <Item rotulo="Custo da IA" valor={`${brl(custoBrl)} · ${usd(m.custoUsd)}`} />
        <Item
          rotulo="Por conversa"
          valor={`${brl(m.custoPorConversaUsd * cotacao)} · ${m.conversas} conversas`}
        />
        <Item
          rotulo="Por mensagem"
          valor={`${brl(m.custoPorMensagemUsd * cotacao)} · ${m.mensagens} mensagens`}
        />
        <Item rotulo="Comissão Nexa (Alice)" valor={brl(l.comissaoAlice)} />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {m.execucoes} execuções · comissão Nexa de todas as atendentes: {brl(l.comissaoTotal)}
      </p>
    </div>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  );
}

function Total({
  titulo,
  valor,
  extra,
  destaque,
}: {
  titulo: string;
  valor: string;
  extra?: string;
  destaque?: boolean;
}) {
  return (
    <div className="card-surface p-4">
      <p className="text-sm text-muted-foreground">{titulo}</p>
      <p className={destaque ? "font-titulo text-2xl text-marca" : "font-titulo text-2xl"}>
        {valor}
      </p>
      {extra ? <p className="text-xs text-muted-foreground">{extra}</p> : null}
    </div>
  );
}
