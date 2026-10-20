import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { AbasDeRota, Botao, Card, Chip } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { comissoesDoMes, quintoDiaUtil, type ComissaoVendedora } from "@/lib/comissoes";
import { marcarComissaoPaga } from "@/lib/comissoes-acoes";
import { mensagemDeErro } from "@/lib/erros";
import { brl, currentMonth, dateBR, monthEnd, monthLabelPT, monthStart } from "@/lib/format";
import { ABAS_DE_TELA, abasPermitidas } from "@/lib/menu";
import { fetchRecebidoDoPeriodo } from "@/lib/reports";
import { useContextoTenant } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/comissoes")({
  head: () => ({
    meta: [
      { title: "Financeiro: Comissões a pagar — Nexa OS" },
      {
        name: "description",
        content: "Comissões por vendedora, pelo mês do recebimento, com a data de pagamento.",
      },
    ],
  }),
  component: Comissoes,
});

/** Percentual que a Nexa repassa às atendentes (configuração da plataforma). */
const CHAVE_REPASSE = "comissao_atendente_nexa_percentual";

function Comissoes() {
  const qc = useQueryClient();
  const [mes, setMes] = useState(currentMonth());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const { data: tenant } = useContextoTenant();
  const papel = tenant?.ativa?.papel ?? null;
  const souNexa = tenant?.souNexa === true;
  const from = monthStart(mes);
  const to = monthEnd(mes);

  const comissoes = useQuery({
    queryKey: ["comissoes_a_pagar", from, to],
    queryFn: async () => comissoesDoMes((await fetchRecebidoDoPeriodo(from, to)).allocations),
  });
  const pagas = useQuery({
    queryKey: ["comissoes_pagas", mes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("reference_key, status, paid_amount, payment_date")
        .like("reference_key", `comissao:%:${mes}`)
        .is("deleted_at", null);
      if (error) throw error;
      return new Map((data ?? []).map((d) => [d.reference_key as string, d]));
    },
  });
  const repasse = useQuery({
    queryKey: ["nexa_repasse_atendentes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("configuracoes_plataforma")
        .select("valor")
        .eq("chave", CHAVE_REPASSE)
        .maybeSingle();
      return data ? Number(data.valor) : null;
    },
  });

  const lista = comissoes.data ?? [];
  const total = lista.reduce((s, c) => s + c.comissao, 0);
  const vencimento = quintoDiaUtil(mes);

  async function pagar(c: ComissaoVendedora) {
    setOcupado(c.salespersonId);
    try {
      const r = await marcarComissaoPaga(c, mes);
      toast.success(
        r === "ja_paga"
          ? "Esta comissão já estava paga."
          : `Comissão de ${c.nome} marcada como paga (despesa “Comissões”).`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["comissoes_pagas", mes] }),
        qc.invalidateQueries({ queryKey: ["month_summary"] }),
      ]);
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível marcar a comissão como paga."));
    } finally {
      setOcupado(null);
    }
  }

  function quemRecebe(c: ComissaoVendedora) {
    if (c.ia) return "Nexa";
    if (!c.viaNexa) return c.nome;
    const pct = repasse.data;
    return `Nexa${pct !== null && pct !== undefined ? ` (repassa ${String(pct).replace(".", ",")}% à vendedora)` : " (repassa à vendedora)"}`;
  }

  return (
    <>
      <PageHeader
        title="Financeiro"
        description={`Comissões a pagar · competência de ${monthLabelPT(mes)}`}
      />
      <AbasDeRota
        abas={abasPermitidas(ABAS_DE_TELA.financeiro, papel, souNexa)}
        rotulo="Financeiro"
        className="mb-6"
      />

      <div className="card-surface mb-4 flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="mes-comissao">Mês de competência</Label>
          <Input
            id="mes-comissao"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="min-h-11 w-[170px]"
          />
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total do mês</p>
          <p className="font-titulo text-xl">{brl(total)}</p>
          <p className="text-xs text-muted-foreground">Pagar até: {dateBR(vencimento)}</p>
        </div>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Competência: valores recebidos no mês (pela data do pagamento), sobre o valor cheio pago
        pelo cliente. Pagamento no 5º dia útil do mês seguinte (segunda a sexta).
      </p>

      {comissoes.error ? (
        <Card className="text-sm text-problema-foreground">
          {mensagemDeErro(comissoes.error, "Não deu para carregar as comissões agora.")}
        </Card>
      ) : comissoes.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          Nenhuma comissão neste mês (nenhum recebimento de OS com vendedora e percentual).
        </Card>
      ) : (
        <div className="grid gap-4">
          {lista.map((c) => {
            const despesa = pagas.data?.get(`comissao:${c.salespersonId}:${mes}`);
            const paga =
              despesa?.status === "Pago" && Number(despesa.paid_amount ?? 0) >= c.comissao;
            return (
              <section key={c.salespersonId} className="card-surface grid gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{c.nome}</h2>
                    <p className="text-xs text-muted-foreground">Pagar a: {quemRecebe(c)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-titulo text-lg">{brl(c.comissao)}</p>
                    <p className="text-xs text-muted-foreground">
                      sobre {brl(c.recebido)} recebidos · pagar até {dateBR(vencimento)}
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="pb-1 font-medium">OS</th>
                        <th className="pb-1 font-medium">Recebido em</th>
                        <th className="pb-1 text-right font-medium">Valor recebido</th>
                        <th className="pb-1 text-right font-medium">%</th>
                        <th className="pb-1 text-right font-medium">Comissão</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.linhas.map((l, i) => (
                        <tr key={`${l.paymentId ?? i}`} className="border-t border-border">
                          <td className="py-1.5">
                            {l.osNumber ? (
                              <Link
                                to="/os/$osNumber"
                                params={{ osNumber: l.osNumber }}
                                className="font-medium text-marca underline-offset-2 hover:underline"
                              >
                                OS {l.osNumber}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-1.5">{dateBR(l.dataRecebimento)}</td>
                          <td className="py-1.5 text-right tabular-nums">{brl(l.recebido)}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {String(l.pct).replace(".", ",")}%
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{brl(l.comissao)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {paga ? (
                    <Chip tom="sucesso">
                      <CheckCircle2 className="size-3.5" aria-hidden /> Paga em{" "}
                      {dateBR(despesa?.payment_date ?? null)}
                    </Chip>
                  ) : (
                    <Botao
                      disabled={ocupado !== null}
                      onClick={() => void pagar(c)}
                      aria-label={`Marcar comissão de ${c.nome} como paga`}
                    >
                      {ocupado === c.salespersonId ? "Marcando…" : "Marcar como paga"}
                    </Botao>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
