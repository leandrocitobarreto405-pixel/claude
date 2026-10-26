// Painel Nexa › Consumo das empresas (Fase B, item 7): IA da Alice, áudio e mensagens automáticas
// de cada empresa no mês. A agenda dos técnicos não usa IA: entra só como mensagens enviadas.
// Franquia da Alice (26/10): conversas do mês x incluídas, excedente, conversas mais caras e a
// cotação do dólar (a Nexa edita; aviso se não for revista há mais de 30 dias).
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Botao, CabecalhoDeTela, Card, Chip, NumeroGrande } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { brl, currentMonth, dateTimeBR, monthLabelPT, monthStart, shiftMonth } from "@/lib/format";
import { useContextoTenant } from "@/lib/tenant";
import {
  cotacaoVencida,
  DIAS_REVISAR_COTACAO,
  lerConsumo,
  lerCotacao,
  lerFranquia,
  mensagensAutomaticas,
  totaisDoConsumo,
  type ConsumoEmpresa,
  type FranquiaEmpresa,
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

  const franquias = useQuery({
    queryKey: ["nexa_franquia_alice", mes],
    enabled: souNexa,
    queryFn: async (): Promise<Map<string, FranquiaEmpresa>> => {
      const { data, error } = await supabase.rpc("alice_franquia_empresas", {
        _mes: monthStart(mes),
      });
      if (error) throw error;
      return new Map(
        ((data ?? []) as Record<string, unknown>[]).map((l) => [
          String(l["empresa_id"]),
          lerFranquia(l),
        ]),
      );
    },
  });
  const caras = useQuery({
    queryKey: ["nexa_conversas_caras", mes],
    enabled: souNexa,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("alice_conversas_caras", {
        _mes: monthStart(mes),
        _limite: 10,
      });
      if (error) throw error;
      return data ?? [];
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

      <Cotacao />

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
              <ItemFranquia f={franquias.data?.get(c.empresa_id)} />
            </dl>
          </Card>
        ))
      )}

      <Card>
        <h2 className="text-base font-bold">Conversas mais caras da Alice no mês</h2>
        {caras.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !caras.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma conversa neste mês.</p>
        ) : (
          <ol className="grid gap-2">
            {caras.data.map((c) => (
              <li
                key={`${c.empresa_id}-${c.conversa_id}`}
                className="grid gap-0.5 rounded-card border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{c.empresa}</span>
                  <span className="font-bold tabular-nums">{brl(c.custo_reais)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.primeira_resposta_em ? dateTimeBR(c.primeira_resposta_em) : "sem resposta"} ·{" "}
                  {int(c.respostas)} resposta(s) · {usd(Number(c.custo_usd))} · conversa{" "}
                  {c.conversa_id.slice(0, 8)}
                  {c.para_equipe_motivo ? ` · foi para a equipe (${c.para_equipe_motivo})` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          Sem nome nem telefone do cliente. No Profissional + Alice, a conversa que passa de R$ 5
          vai para a equipe; na Interna e no Nexa Gestão, só aparece aqui.
        </p>
      </Card>
    </div>
  );
}

function ItemFranquia({ f }: { f: FranquiaEmpresa | undefined }) {
  if (!f) return null;
  const valor = f.franquia ? `${int(f.conversas)} de ${int(f.franquia)}` : int(f.conversas);
  return (
    <>
      <Item
        rotulo={f.trava ? "Conversas da Alice (franquia)" : "Conversas da Alice (só mede)"}
        valor={valor}
      />
      {f.trava ? (
        <Item
          rotulo="Excedente (próxima fatura)"
          valor={`${int(f.excedentes)} · ${brl(f.valor_excedente)}`}
        />
      ) : null}
      {f.para_equipe ? <Item rotulo="Foram para a equipe" valor={int(f.para_equipe)} /> : null}
    </>
  );
}

/** Cotação do dólar usada no custo da Alice em reais (só a Nexa edita). */
function Cotacao() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const q = useQuery({
    queryKey: ["alice_cotacao_dolar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes_plataforma")
        .select("valor, updated_at")
        .eq("chave", "alice_cotacao_dolar")
        .maybeSingle();
      if (error) throw error;
      return data
        ? { valor: Number(data.valor), atualizadaEm: data.updated_at as string | null }
        : null;
    },
  });
  async function salvar() {
    const v = lerCotacao(texto);
    if (v === null) {
      toast.error("Informe a cotação (ex.: 5,65).");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("configuracoes_plataforma").upsert({
      chave: "alice_cotacao_dolar",
      valor: v,
      descricao: "Cotação do dólar para o custo da Alice em reais (revise a cada 30 dias)",
      updated_at: new Date().toISOString(),
    });
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar a cotação.");
      return;
    }
    toast.success("Cotação salva.");
    setEditando(false);
    await qc.invalidateQueries({ queryKey: ["alice_cotacao_dolar"] });
    await qc.invalidateQueries({ queryKey: ["nexa_conversas_caras"] });
  }
  const c = q.data;
  const vencida = c ? cotacaoVencida(c.atualizadaEm, new Date()) : false;
  return (
    <Card className="gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Cotação do dólar (custo da Alice em R$):{" "}
          <strong className="tabular-nums">
            {c ? c.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "—"}
          </strong>
          {c?.atualizadaEm ? (
            <span className="text-muted-foreground">
              {" "}
              · revista em {dateTimeBR(c.atualizadaEm)}
            </span>
          ) : null}
        </p>
        {!editando ? (
          <Botao
            variante="neutro"
            onClick={() => {
              setTexto(c ? String(c.valor).replace(".", ",") : "");
              setEditando(true);
            }}
          >
            Editar
          </Botao>
        ) : null}
      </div>
      {vencida ? (
        <p className="rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground">
          A cotação não é revista há mais de {DIAS_REVISAR_COTACAO} dias. Confira e salve de novo.
        </p>
      ) : null}
      {editando ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="cotacao-dolar">Cotação (R$ por US$ 1)</Label>
            <Input
              id="cotacao-dolar"
              inputMode="decimal"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="w-32"
            />
          </div>
          <Botao disabled={salvando} onClick={() => void salvar()}>
            Salvar
          </Botao>
          <Botao variante="neutro" onClick={() => setEditando(false)}>
            Cancelar
          </Botao>
        </div>
      ) : null}
    </Card>
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
