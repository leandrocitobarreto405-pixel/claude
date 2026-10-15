// Seção de Configurações (veio da antiga tela de abas).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { saveSetting, useInvalidate, useSetting } from "@/lib/data";
import { useServerFn } from "@tanstack/react-start";
import { brl, currentMonth, monthLabelPT, parseNumberBR } from "@/lib/format";
import { ControleInsumosCard } from "@/components/produtos-config";
import { custoFixoPorServico } from "@/lib/quotes.functions";

export function MetaCustos() {
  const [mes, setMes] = useState(currentMonth());
  const [meta, setMeta] = useState("0,00");
  // Sem valor salvo o servidor usa 0 (rotas ficam "Aguardando custo por km"): nada de padrão aqui.
  const { data: custoKm } = useSetting<number | null>("cost_per_km", null);
  const [km, setKm] = useState("");

  const metaQuery = useQuery({
    queryKey: ["goal_config", mes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monthly_goals")
        .select("*")
        .eq("month", `${mes}-01`)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setMeta(String(metaQuery.data?.goal_amount ?? 0).replace(".", ","));
  }, [metaQuery.data]);

  useEffect(() => {
    if (custoKm != null) setKm(String(custoKm).replace(".", ","));
  }, [custoKm]);

  async function salvarMeta() {
    const valor = parseNumberBR(meta);
    if (valor <= 0) {
      toast.error("Informe uma meta maior que zero.");
      return;
    }
    const { error } = await supabase
      .from("monthly_goals")
      .upsert({ month: `${mes}-01`, goal_amount: valor }, { onConflict: "empresa_id,month" });
    if (error) {
      toast.error("Não foi possível salvar a meta.");
      return;
    }
    toast.success(`Meta de ${monthLabelPT(mes)} definida em ${brl(valor)}.`);
    metaQuery.refetch();
  }

  async function salvarKm() {
    const valor = parseNumberBR(km);
    if (valor <= 0) {
      toast.error("Informe um custo por km maior que zero.");
      return;
    }
    try {
      await saveSetting("cost_per_km", valor);
      toast.success("Custo por quilômetro atualizado.");
    } catch {
      toast.error("Não foi possível salvar o custo por km.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card-surface p-5">
        <h2 className="mb-4 text-lg font-semibold">Meta mensal de faturamento</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mes-meta">Mês</Label>
            <Input
              id="mes-meta"
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meta">Meta (R$)</Label>
            <Input id="meta" value={meta} onChange={(e) => setMeta(e.target.value)} />
          </div>
        </div>
        <Button className="mt-4" onClick={salvarMeta}>
          Salvar meta
        </Button>
      </section>

      <section className="card-surface p-5">
        <h2 className="mb-4 text-lg font-semibold">Custo por quilômetro</h2>
        <div className="space-y-2">
          <Label htmlFor="km">Valor por km (R$)</Label>
          <Input id="km" value={km} onChange={(e) => setKm(e.target.value)} />
          {!(Number(custoKm) > 0) && (
            <p className="text-sm text-muted-foreground">
              Não configurado: as rotas ficam em "Aguardando custo por km" até salvar um valor.
            </p>
          )}
        </div>
        <Button className="mt-4" onClick={salvarKm}>
          Salvar custo por km
        </Button>
      </section>

      <div className="lg:col-span-2">
        <RegrasMargem />
      </div>

      <div className="lg:col-span-2">
        <ControleInsumosCard />
      </div>
    </div>
  );
}

function RegrasMargem() {
  const { data: imposto } = useSetting<number>("tax_percent", 6);
  const { data: alvo } = useSetting<number>("profit_target_percent", 20);
  const { data: minimo } = useSetting<number>("profit_min_percent", 12.5);
  const { data: override } = useSetting<number>("fixed_cost_per_service_override", 0);
  const { data: estimativa } = useSetting<number>("services_per_month_estimate", 34);
  const { data: contribMin } = useSetting<number>("contribution_min_percent", 70);
  const { data: contribWarn } = useSetting<number>("contribution_warn_percent", 60);
  const { data: origemMedia = "manual" } = useSetting<string>("services_avg_source", "manual");
  const invalidate = useInvalidate();
  const custoFixoFn = useServerFn(custoFixoPorServico);
  const { data: custoFixo, refetch } = useQuery({
    queryKey: ["custo_fixo_por_servico"],
    queryFn: () => custoFixoFn(),
  });

  const [impostoTxt, setImpostoTxt] = useState("");
  const [alvoTxt, setAlvoTxt] = useState("");
  const [minimoTxt, setMinimoTxt] = useState("");
  const [overrideTxt, setOverrideTxt] = useState("");
  const [estimativaTxt, setEstimativaTxt] = useState("");
  const [contribMinTxt, setContribMinTxt] = useState("");
  const [contribWarnTxt, setContribWarnTxt] = useState("");

  useEffect(() => {
    if (imposto != null) setImpostoTxt(String(imposto).replace(".", ","));
  }, [imposto]);
  useEffect(() => {
    if (alvo != null) setAlvoTxt(String(alvo).replace(".", ","));
  }, [alvo]);
  useEffect(() => {
    if (minimo != null) setMinimoTxt(String(minimo).replace(".", ","));
  }, [minimo]);
  useEffect(() => {
    if (override != null) setOverrideTxt(String(override).replace(".", ","));
  }, [override]);
  useEffect(() => {
    if (estimativa != null) setEstimativaTxt(String(estimativa).replace(".", ","));
  }, [estimativa]);
  useEffect(() => {
    if (contribMin != null) setContribMinTxt(String(contribMin).replace(".", ","));
  }, [contribMin]);
  useEffect(() => {
    if (contribWarn != null) setContribWarnTxt(String(contribWarn).replace(".", ","));
  }, [contribWarn]);

  async function salvar(key: string, valor: number, min: number, max: number, rotulo: string) {
    if (!Number.isFinite(valor) || valor < min || valor > max) {
      toast.error(`${rotulo}: informe um valor entre ${min} e ${max}.`);
      return;
    }
    try {
      await saveSetting(key, valor);
      toast.success(`${rotulo} atualizado.`);
      await refetch();
    } catch {
      toast.error(`Não foi possível salvar ${rotulo.toLowerCase()}.`);
    }
  }

  async function salvarOrigem(valor: "manual" | "automatico") {
    try {
      await saveSetting("services_avg_source", valor);
      invalidate("app_settings");
      await refetch();
      toast.success(
        valor === "manual" ? "Passou a usar a sua média." : "Passou a usar a média automática.",
      );
    } catch {
      toast.error("Não foi possível salvar a origem da média.");
    }
  }

  return (
    <section className="card-surface p-5">
      <h2 className="mb-1 text-lg font-semibold">Regras de margem do orçamento</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Usadas no semáforo "Pode fechar?" do orçamento. Custo fixo por serviço calculado agora:{" "}
        <strong>{brl(custoFixo?.valor ?? 0)}</strong>
        {custoFixo
          ? ` (${brl(custoFixo.fixasMes)} de despesas fixas do mês ÷ ${custoFixo.mediaServicos} serviços/mês${
              custoFixo.fonte === "estimativa"
                ? " — média informada por você"
                : custoFixo.fonte === "manual"
                  ? " — valor definido manualmente abaixo"
                  : ` — média automática de ${custoFixo.mesesCompletos} ${
                      custoFixo.mesesCompletos === 1 ? "mês cheio" : "meses cheios"
                    }`
            })`
          : ""}
        .
      </p>
      <div className="mb-4 space-y-2 rounded-xl border border-border/70 p-4">
        <Label>Qual média de serviços por mês usar no rateio</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant={origemMedia === "manual" ? "default" : "outline"}
            size="sm"
            onClick={() => void salvarOrigem("manual")}
          >
            Usar a minha média ({estimativa ?? 34}/mês)
          </Button>
          <Button
            variant={origemMedia === "automatico" ? "default" : "outline"}
            size="sm"
            onClick={() => void salvarOrigem("automatico")}
          >
            Usar a média automática
            {custoFixo && custoFixo.mediaHistorico > 0 ? ` (${custoFixo.mediaHistorico}/mês)` : ""}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A média automática considera só meses cheios ({custoFixo?.mesesCompletos ?? 0} até agora);
          o mês em andamento fica fora da conta.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="imposto">Imposto sobre o serviço (%)</Label>
          <Input id="imposto" value={impostoTxt} onChange={(e) => setImpostoTxt(e.target.value)} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void salvar("tax_percent", parseNumberBR(impostoTxt), 0, 50, "Imposto")}
          >
            Salvar
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="alvo">Lucro alvo (%)</Label>
          <Input id="alvo" value={alvoTxt} onChange={(e) => setAlvoTxt(e.target.value)} />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void salvar("profit_target_percent", parseNumberBR(alvoTxt), 1, 90, "Lucro alvo")
            }
          >
            Salvar
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="minimo">Lucro mínimo aceitável (%)</Label>
          <Input id="minimo" value={minimoTxt} onChange={(e) => setMinimoTxt(e.target.value)} />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void salvar("profit_min_percent", parseNumberBR(minimoTxt), 1, 90, "Lucro mínimo")
            }
          >
            Salvar
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="override">Custo fixo por serviço manual (R$, 0 = automático)</Label>
          <Input
            id="override"
            value={overrideTxt}
            onChange={(e) => setOverrideTxt(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void salvar(
                "fixed_cost_per_service_override",
                parseNumberBR(overrideTxt),
                0,
                100000,
                "Custo fixo por serviço",
              )
            }
          >
            Salvar
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="estimativa">Média de serviços por mês (a sua média)</Label>
          <Input
            id="estimativa"
            value={estimativaTxt}
            onChange={(e) => setEstimativaTxt(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void salvar(
                "services_per_month_estimate",
                parseNumberBR(estimativaTxt),
                1,
                1000,
                "Média de serviços por mês",
              )
            }
          >
            Salvar
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="contribmin">Contribuição mínima p/ preencher agenda (%)</Label>
          <Input
            id="contribmin"
            value={contribMinTxt}
            onChange={(e) => setContribMinTxt(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void salvar(
                "contribution_min_percent",
                parseNumberBR(contribMinTxt),
                10,
                99,
                "Contribuição mínima",
              )
            }
          >
            Salvar
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="contribwarn">Contribuição de alerta (%)</Label>
          <Input
            id="contribwarn"
            value={contribWarnTxt}
            onChange={(e) => setContribWarnTxt(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void salvar(
                "contribution_warn_percent",
                parseNumberBR(contribWarnTxt),
                10,
                99,
                "Contribuição de alerta",
              )
            }
          >
            Salvar
          </Button>
        </div>
      </div>
    </section>
  );
}
