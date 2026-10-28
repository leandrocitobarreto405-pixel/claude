// Seção de Configurações › Vendas: taxas de pagamento (grade completa, mesmo vazia) e a tabela
// pronta da maquininha. As taxas entram no líquido de cada pagamento (DRE) e na margem do orçamento.
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { usePaymentRates, useSetting, type PaymentRate } from "@/lib/data";
import { parseNumberBR } from "@/lib/format";
import {
  GRADE_TAXAS,
  MAQUININHAS,
  chaveDaLinha,
  ehMaquininha,
  foraDaGrade,
  rotuloDaLinha,
  type LinhaGrade,
  type Maquininha,
} from "@/lib/taxas-pagamento";

export function Taxas() {
  const qc = useQueryClient();
  const { data: rates } = usePaymentRates(false);
  const { data: escolha } = useSetting<string>("taxas_maquininha", "personalizada");
  const maquininha: Maquininha = ehMaquininha(escolha) ? escolha : "personalizada";
  const porChave = new Map((rates ?? []).map((r) => [chaveDaLinha(r), r]));
  const outras = foraDaGrade(rates ?? []);

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: ["payment_rates"] });
    await qc.invalidateQueries({ queryKey: ["app_settings", "taxas_maquininha"] });
  }

  async function gravar(linha: LinhaGrade, existente: PaymentRate | undefined, valor: string) {
    const texto = valor.trim();
    if (!texto && !existente) return;
    const pct = parseNumberBR(texto || "0");
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      toast.error("Taxa entre 0 e 50%.");
      return;
    }
    if (existente && Number(existente.rate_percent) === pct) return;
    const { error } = existente
      ? await supabase.from("payment_rates").update({ rate_percent: pct }).eq("id", existente.id)
      : await supabase.from("payment_rates").insert({ ...linha, rate_percent: pct, active: true });
    if (error) {
      toast.error("Não foi possível salvar a taxa.");
      return;
    }
    toast.success("Taxa salva. Os próximos pagamentos usam o novo valor.");
    await recarregar();
  }

  async function escolher(m: Maquininha) {
    const pronta = MAQUININHAS.find((x) => x.id === m)?.tabelaPronta;
    if (
      pronta &&
      !window.confirm(
        `Trocar as taxas da grade pelas da tabela ${MAQUININHAS.find((x) => x.id === m)?.rotulo}? Linhas fora da grade não mudam.`,
      )
    )
      return;
    const { error } = await supabase.rpc("aplicar_tabela_taxas" as never, { _tabela: m } as never);
    if (error) {
      toast.error("Não foi possível aplicar a tabela.");
      return;
    }
    toast.success(pronta ? "Tabela aplicada. Confira e ajuste se precisar." : "Maquininha salva.");
    await recarregar();
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="card-surface flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Maquininha</span>
            <select
              className="min-h-11 rounded-botao border border-border bg-card px-3 text-sm"
              value={maquininha}
              onChange={(e) => {
                const m = e.target.value;
                if (ehMaquininha(m)) void escolher(m);
              }}
            >
              {MAQUININHAS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.rotulo}
                  {m.tabelaPronta ? "" : " (preencher à mão)"}
                </option>
              ))}
            </select>
          </label>
          <Botao variante="contorno" onClick={() => void escolher("infinitepay")}>
            Usar tabela InfinitePay
          </Botao>
        </div>
        <p className="text-xs text-muted-foreground">
          As taxas entram no valor líquido de cada pagamento (e por ele no DRE) e na margem do
          orçamento. Campo vazio = sem taxa cadastrada (conta como 0%).
        </p>
      </div>

      {GRADE_TAXAS.map((g) => (
        <div key={g.grupo} className="card-surface overflow-hidden">
          <h3 className="bg-secondary px-4 py-2 text-sm font-semibold">{g.grupo}</h3>
          <ul className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
            {g.linhas.map((l) => {
              const r = porChave.get(chaveDaLinha(l));
              return (
                <li
                  key={chaveDaLinha(l)}
                  className="flex items-center justify-between gap-3 px-4 py-2 sm:border-b sm:border-border"
                >
                  <span className="text-sm">
                    {g.grupo === "Outras formas" ? l.channel : rotuloDaLinha(l)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Input
                      key={`${chaveDaLinha(l)}-${r?.rate_percent ?? "vazio"}`}
                      inputMode="decimal"
                      aria-label={`Taxa ${g.grupo} ${rotuloDaLinha(l)}`}
                      defaultValue={r ? String(r.rate_percent).replace(".", ",") : ""}
                      placeholder="—"
                      onBlur={(e) => void gravar(l, r, e.target.value)}
                      className="w-24 text-right"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {outras.length ? (
        <div className="card-surface overflow-hidden">
          <h3 className="bg-secondary px-4 py-2 text-sm font-semibold">Outras taxas cadastradas</h3>
          <ul className="divide-y divide-border">
            {outras.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="text-sm">
                  {r.channel} · {r.payment_type}
                  {r.installments > 1 ? ` ${r.installments}x` : ""}
                </span>
                <span className="flex items-center gap-1">
                  <Input
                    inputMode="decimal"
                    defaultValue={String(r.rate_percent).replace(".", ",")}
                    onBlur={(e) => void gravar(r, r, e.target.value)}
                    className="w-24 text-right"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
