// Painel Nexa › Consumo das empresas (Fase B, item 7): IA da Alice, áudio e mensagens automáticas
// de cada empresa no mês. A agenda dos técnicos não usa IA: entra só como mensagens enviadas.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Botao, CabecalhoDeTela, Card, Chip, NumeroGrande } from "@/components/nexa";
import { EmptyState } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { brl, currentMonth, monthLabelPT, monthStart, shiftMonth } from "@/lib/format";
import { useContextoTenant } from "@/lib/tenant";
import {
  lerConsumo,
  mensagensAutomaticas,
  totaisDoConsumo,
  type ConsumoEmpresa,
} from "@/lib/consumo";

export const Route = createFileRoute("/_authenticated/nexa/consumo")({
  head: () => ({ meta: [{ title: "Consumo das empresas — Nexa OS" }] }),
  component: ConsumoNexa,
});

const usd = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const int = (v: number) => v.toLocaleString("pt-BR");

function ConsumoNexa() {
  const { data: ctx } = useContextoTenant();
  const souNexa = Boolean(ctx?.souNexa);
  const [mes, setMes] = useState(currentMonth());
  const q = useQuery({
    queryKey: ["nexa_consumo", mes],
    enabled: souNexa,
    queryFn: async (): Promise<ConsumoEmpresa[]> => {
      const { data, error } = await supabase.rpc(
        "consumo_empresas" as never,
        {
          _mes: monthStart(mes),
        } as never,
      );
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(lerConsumo);
    },
  });

  if (ctx && !souNexa) return <EmptyState title="Acesso restrito à Nexa" />;
  const lista = q.data ?? [];
  const t = totaisDoConsumo(lista);
  const futuro = mes >= currentMonth();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Consumo das empresas"
        descricao="IA da Alice, áudio e mensagens automáticas de cada empresa no mês."
      />

      <div className="flex items-center justify-between gap-2">
        <Botao
          variante="neutro"
          tamanho="icone"
          aria-label="Mês anterior"
          onClick={() => setMes(shiftMonth(mes, -1))}
        >
          <ChevronLeft aria-hidden />
        </Botao>
        <p className="text-base font-bold capitalize">{monthLabelPT(mes)}</p>
        <Botao
          variante="neutro"
          tamanho="icone"
          aria-label="Próximo mês"
          disabled={futuro}
          onClick={() => setMes(shiftMonth(mes, 1))}
        >
          <ChevronRight aria-hidden />
        </Botao>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumeroGrande valor={int(t.iaRespostas)} legenda="Respostas da Alice" tamanho="pequeno" />
          <NumeroGrande valor={usd(t.iaCustoUsd)} legenda="Custo da IA" tamanho="pequeno" />
          <NumeroGrande valor={brl(t.audioCustoReais)} legenda="Custo de áudio" tamanho="pequeno" />
          <NumeroGrande
            valor={int(t.automaticas)}
            legenda="Mensagens automáticas"
            tamanho="pequeno"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Totais sem as empresas de teste. Mensagens automáticas (campanhas, pós-atendimento e
          agenda dos técnicos) não usam IA; o custo delas na Meta é da própria empresa.
        </p>
      </Card>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : q.error ? (
        <Card className="text-sm text-problema-foreground">
          Não foi possível carregar o consumo.
        </Card>
      ) : lista.length === 0 ? (
        <EmptyState title="Nenhuma empresa ativa" />
      ) : (
        lista.map((c) => (
          <Card key={c.empresa_id} as="article">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-base font-bold">{c.nome}</h2>
              {c.eh_teste ? <Chip>Teste · fora dos totais</Chip> : null}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Item rotulo="Respostas da Alice" valor={int(c.ia_respostas)} />
              <Item rotulo="Mensagens da Alice" valor={int(c.ia_mensagens)} />
              <Item rotulo="Custo da IA" valor={usd(c.ia_custo_usd)} />
              <Item
                rotulo="Áudios da Alice"
                valor={`${int(c.audios)} · ${brl(c.audio_custo_reais)}`}
              />
              <Item rotulo="Campanhas e lembretes" valor={int(c.mkt_mensagens)} />
              <Item rotulo="Pós-atendimento" valor={int(c.pos_atendimento_mensagens)} />
              <Item rotulo="Agenda dos técnicos" valor={int(c.agenda_mensagens)} />
              <Item rotulo="Automáticas no total" valor={int(mensagensAutomaticas(c))} />
            </dl>
          </Card>
        ))
      )}
    </div>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}
