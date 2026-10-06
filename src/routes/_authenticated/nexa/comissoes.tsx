import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { brl, currentMonth, monthEnd, monthLabelPT, monthStart, parseNumberBR } from "@/lib/format";
import { useContextoTenant } from "@/lib/tenant";
import { fetchServiceMonthRevenue } from "@/lib/reports";
import {
  repasseAtendentes,
  resumoNexaDaEmpresa,
  textoPercentuais,
  type ResumoNexaEmpresa,
} from "@/lib/comissao-nexa";

export const Route = createFileRoute("/_authenticated/nexa/comissoes")({
  head: () => ({
    meta: [
      { title: "Comissão da Nexa — Nexa OS" },
      {
        name: "description",
        content: "Comissão que cada empresa paga à Nexa e o repasse às atendentes.",
      },
    ],
  }),
  component: ComissoesNexa,
});

/** Percentual que a Nexa repassa às atendentes (configuração da plataforma). */
const CHAVE_REPASSE = "comissao_atendente_nexa_percentual";
const REPASSE_INICIAL = 3;

type LinhaEmpresa = {
  id: string;
  nome: string;
  contrato: number | null;
  resumo: ResumoNexaEmpresa;
};

function pct(n: number) {
  return `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
}

function ComissoesNexa() {
  const qc = useQueryClient();
  const { data: ctx } = useContextoTenant();
  const souNexa = ctx?.souNexa ?? false;
  const [mes, setMes] = useState(currentMonth());
  const [repasseTexto, setRepasseTexto] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const repasse = useQuery({
    queryKey: ["nexa_repasse_atendentes"],
    enabled: souNexa,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes_plataforma")
        .select("valor")
        .eq("chave", CHAVE_REPASSE)
        .maybeSingle();
      if (error) throw error;
      return { pct: data ? Number(data.valor) : REPASSE_INICIAL, salvo: Boolean(data) };
    },
  });

  const from = monthStart(mes);
  const to = monthEnd(mes);
  const empresas = useQuery({
    queryKey: ["nexa_comissoes", from, to],
    enabled: souNexa,
    queryFn: async (): Promise<LinhaEmpresa[]> => {
      const [lista, contratos] = await Promise.all([
        supabase.from("empresas").select("id, nome").eq("ativo", true).order("nome"),
        supabase
          .from("contratos_comissao")
          .select("empresa_id, percentual, vigencia_inicio, vigencia_fim"),
      ]);
      if (lista.error) throw lista.error;
      if (contratos.error) throw contratos.error;
      // Uma empresa por vez, cada uma no próprio contexto (o mesmo cálculo do DRE dela).
      return Promise.all(
        (lista.data ?? []).map(async (e) => {
          const base = await fetchServiceMonthRevenue(from, to, undefined, e.id);
          // Contrato que valia no fim do mês.
          const contrato = (contratos.data ?? []).find(
            (c) =>
              c.empresa_id === e.id &&
              c.vigencia_inicio <= to &&
              (c.vigencia_fim === null || c.vigencia_fim >= to),
          );
          return {
            id: e.id,
            nome: e.nome,
            contrato: contrato ? Number(contrato.percentual) : null,
            resumo: resumoNexaDaEmpresa(base.allocations),
          };
        }),
      );
    },
  });

  if (ctx && !souNexa) {
    return <EmptyState title="Acesso restrito à Nexa" />;
  }

  const pctRepasse = repasse.data?.pct ?? REPASSE_INICIAL;
  const linhas = empresas.data ?? [];
  const atendentes = repasseAtendentes(linhas, pctRepasse);
  const nexaRecebe = linhas.reduce((s, l) => s + l.resumo.comissao, 0);
  const repasseTotal = atendentes.reduce((s, a) => s + a.repasse, 0);

  async function salvarRepasse() {
    const valor = parseNumberBR(repasseTexto ?? "");
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
      toast.error("Percentual inválido.");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("configuracoes_plataforma").upsert(
      {
        chave: CHAVE_REPASSE,
        valor,
        descricao: "Percentual que a Nexa repassa às atendentes sobre o que cada uma vendeu",
      } as never,
      { onConflict: "chave" },
    );
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar o percentual.");
      return;
    }
    toast.success("Percentual das atendentes atualizado.");
    setRepasseTexto(null);
    void qc.invalidateQueries({ queryKey: ["nexa_repasse_atendentes"] });
  }

  return (
    <>
      <PageHeader
        title="Comissão da Nexa"
        description="O que cada empresa paga à Nexa pelas vendas das atendentes da Nexa e quanto vai para cada atendente. Mesma conta do DRE: recebido dos serviços concluídos no mês."
      />

      <section className="card-surface mb-6 grid gap-4 p-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mes-nexa">Mês</Label>
          <Input
            id="mes-nexa"
            type="month"
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repasse-nexa">Comissão das atendentes (paga pela Nexa)</Label>
          <div className="flex gap-2">
            <Input
              id="repasse-nexa"
              inputMode="decimal"
              className="w-[96px]"
              value={repasseTexto ?? String(pctRepasse).replace(".", ",")}
              onChange={(e) => setRepasseTexto(e.target.value)}
            />
            <span className="self-center text-sm text-muted-foreground">%</span>
            {repasseTexto !== null || (repasse.data && !repasse.data.salvo) ? (
              <Button disabled={salvando} onClick={salvarRepasse}>
                Salvar
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {empresas.isLoading ? (
        <p className="text-sm text-muted-foreground">Calculando…</p>
      ) : empresas.error ? (
        <p className="text-sm text-destructive">Não foi possível calcular a comissão do mês.</p>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Total titulo="A Nexa recebe das empresas" valor={nexaRecebe} />
            <Total titulo={`Comissão das atendentes (${pct(pctRepasse)})`} valor={repasseTotal} />
            <Total titulo="Fica para a Nexa" valor={nexaRecebe - repasseTotal} destaque />
          </div>

          <section className="card-surface mb-6 p-5">
            <h2 className="mb-1 text-lg font-semibold">Por empresa — {monthLabelPT(mes)}</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Recebido dos serviços vendidos pelas atendentes da Nexa e a comissão que a empresa
              paga (a mesma linha "Comissão Nexa" do DRE dela).
            </p>
            <div className="space-y-3">
              {linhas.map((l) => (
                <div key={l.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">{l.nome}</p>
                    <p className="font-semibold">{brl(l.resumo.comissao)}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Contrato {l.contrato !== null ? pct(l.contrato) : "não definido"} · recebido{" "}
                    {brl(l.resumo.recebido)}
                    {l.resumo.percentuais.length &&
                    !(l.resumo.percentuais.length === 1 && l.resumo.percentuais[0] === l.contrato)
                      ? ` · nas OS: ${textoPercentuais(l.resumo.percentuais)}`
                      : ""}
                  </p>
                  {Object.keys(l.resumo.porVendedora).length ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {Object.entries(l.resumo.porVendedora)
                        .sort((a, b) => b[1].recebido - a[1].recebido)
                        .map(([nome, v]) => (
                          <li key={nome} className="flex justify-between gap-2">
                            <span>
                              {nome} vendeu {brl(v.recebido)}
                            </span>
                            <span className="text-muted-foreground">{brl(v.comissao)}</span>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Nenhuma venda de atendente da Nexa recebida no mês.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="card-surface mb-6 p-5">
            <h2 className="mb-1 text-lg font-semibold">Por atendente</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              O que cada uma vendeu em todas as empresas e a comissão dela ({pct(pctRepasse)}), paga
              pela Nexa. A IA não entra.
            </p>
            {atendentes.length ? (
              <div className="space-y-3">
                {atendentes.map((a) => (
                  <div key={a.nome} className="rounded-lg border border-border p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-medium">{a.nome}</p>
                      <p className="font-semibold">{brl(a.repasse)}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">Vendeu {brl(a.recebido)}</p>
                    <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                      {a.porEmpresa.map((p) => (
                        <li key={p.empresa}>
                          {p.empresa}: {brl(p.recebido)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma venda no mês.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Total({ titulo, valor, destaque }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className="card-surface p-4">
      <p className="text-sm text-muted-foreground">{titulo}</p>
      <p className={destaque ? "font-titulo text-2xl text-marca" : "font-titulo text-2xl"}>
        {brl(valor)}
      </p>
    </div>
  );
}
