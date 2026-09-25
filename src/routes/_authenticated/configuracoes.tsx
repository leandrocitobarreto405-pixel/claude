import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_MESSAGE_TEMPLATE,
  saveSetting,
  useConfigOptions,
  useInvalidate,
  usePaymentRates,
  useSalespeople,
  useSetting,
  useTechnicians,
} from "@/lib/data";
import { templateText } from "@/lib/os";
import { useServerFn } from "@tanstack/react-start";
import { getOsDocSettings, saveOsDocSettings, testOsDocIntegration } from "@/lib/os-docs.functions";
import {
  getCalendarSettings,
  saveCalendarSettings,
  testCalendarIntegration,
} from "@/lib/calendar.functions";
import { brl, currentMonth, monthLabelPT, parseNumberBR } from "@/lib/format";
import { useControleInsumos } from "@/lib/produtos";
import { ControleInsumosCard, ProdutosConfig } from "@/components/produtos-config";
import { custoFixoPorServico } from "@/lib/quotes.functions";
import { TabelaPrecosConfig } from "@/components/tabela-precos-config";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Gestão Estofados" },
      {
        name: "description",
        content: "Metas, taxas de pagamento, comissões, custo por km e mensagens.",
      },
      { property: "og:title", content: "Configurações — Gestão Estofados" },
      {
        property: "og:description",
        content: "Metas, taxas de pagamento, comissões, custo por km e mensagens.",
      },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  const { ativo: controleInsumos } = useControleInsumos();
  return (
    <>
      <PageHeader title="Configurações" description="Ajuste metas, taxas, comissões e mensagens." />
      <Tabs defaultValue="meta">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="meta">Meta e custos</TabsTrigger>
          <TabsTrigger value="precos">Tabela de preços</TabsTrigger>
          <TabsTrigger value="taxas">Taxas de pagamento</TabsTrigger>
          <TabsTrigger value="equipe">Equipe</TabsTrigger>
          {controleInsumos ? <TabsTrigger value="produtos">Produtos</TabsTrigger> : null}
          <TabsTrigger value="listas">Listas</TabsTrigger>
          <TabsTrigger value="recorrentes">Despesas recorrentes</TabsTrigger>
          <TabsTrigger value="mensagem">Mensagem padrão</TabsTrigger>
          <TabsTrigger value="documentos">Modelos de ordem de serviço</TabsTrigger>
          <TabsTrigger value="agenda">Google Agenda</TabsTrigger>
        </TabsList>
        <TabsContent value="meta">
          <MetaCustos />
        </TabsContent>
        <TabsContent value="precos">
          <TabelaPrecosConfig />
        </TabsContent>
        <TabsContent value="taxas">
          <Taxas />
        </TabsContent>
        <TabsContent value="equipe">
          <Equipe />
        </TabsContent>
        {controleInsumos ? (
          <TabsContent value="produtos">
            <ProdutosConfig />
          </TabsContent>
        ) : null}
        <TabsContent value="listas">
          <Listas />
        </TabsContent>
        <TabsContent value="recorrentes">
          <Recorrentes />
        </TabsContent>
        <TabsContent value="mensagem">
          <Mensagem />
        </TabsContent>
        <TabsContent value="documentos">
          <ModelosOS />
        </TabsContent>
        <TabsContent value="agenda">
          <GoogleAgenda />
        </TabsContent>
      </Tabs>
    </>
  );
}

type TemplateRow = {
  id: string;
  name: string;
  beneficiary: string | null;
  category: string;
  default_amount: number;
  recurrence: string;
  due_day: number | null;
  weekday: number | null;
  active: boolean;
};

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function Recorrentes() {
  const query = useQuery({
    queryKey: ["recurring_expenses_admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_expenses")
        .select(
          "id, name, beneficiary, category, default_amount, recurrence, due_day, weekday, active",
        )
        .order("category")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as TemplateRow[];
    },
  });

  async function atualizar(id: string, patch: Partial<TemplateRow>) {
    const { error } = await supabase.from("recurring_expenses").update(patch).eq("id", id);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success("Despesa recorrente atualizada.");
    query.refetch();
  }

  const lista = query.data ?? [];
  const totalMensal = lista
    .filter((t) => t.active && t.recurrence !== "weekly")
    .reduce((sum, t) => sum + Number(t.default_amount ?? 0), 0);

  return (
    <div className="card-surface overflow-x-auto p-4">
      <h2 className="mb-1 text-lg font-semibold">Despesas recorrentes</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Estes modelos geram automaticamente as despesas de cada mês. Total mensal fixo:{" "}
        {brl(totalMensal)}.
      </p>
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-secondary text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Nome</th>
            <th className="px-3 py-2 font-medium">Beneficiário</th>
            <th className="px-3 py-2 font-medium">Categoria</th>
            <th className="px-3 py-2 font-medium">Recorrência</th>
            <th className="px-3 py-2 font-medium">Vencimento</th>
            <th className="px-3 py-2 font-medium">Valor padrão</th>
            <th className="px-3 py-2 font-medium">Ativa</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="px-3 py-2">{t.name}</td>
              <td className="px-3 py-2">
                <Input
                  defaultValue={t.beneficiary ?? ""}
                  className="w-[150px]"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (t.beneficiary ?? null)) atualizar(t.id, { beneficiary: v });
                  }}
                />
              </td>
              <td className="px-3 py-2">{t.category}</td>
              <td className="px-3 py-2">
                {t.recurrence === "weekly" ? `Semanal (${DIAS_SEMANA[t.weekday ?? 1]})` : "Mensal"}
              </td>
              <td className="px-3 py-2">
                {t.recurrence === "weekly" ? (
                  <span className="text-muted-foreground">Toda {DIAS_SEMANA[t.weekday ?? 1]}</span>
                ) : (
                  <Input
                    defaultValue={t.due_day ?? ""}
                    placeholder="Dia"
                    className="w-[90px]"
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      const dia = Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
                      if (dia !== t.due_day) atualizar(t.id, { due_day: dia });
                    }}
                  />
                )}
              </td>
              <td className="px-3 py-2">
                <Input
                  defaultValue={String(Number(t.default_amount ?? 0).toFixed(2)).replace(".", ",")}
                  className="w-[130px]"
                  onBlur={(e) => {
                    const valor = parseNumberBR(e.target.value);
                    if (valor !== Number(t.default_amount))
                      atualizar(t.id, { default_amount: valor });
                  }}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={t.active}
                  onChange={(e) => atualizar(t.id, { active: e.target.checked })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetaCustos() {
  const [mes, setMes] = useState(currentMonth());
  const [meta, setMeta] = useState("0,00");
  const { data: custoKm } = useSetting<number>("cost_per_km", 0.57);
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

function Taxas() {
  const { data: rates } = usePaymentRates(false);

  async function atualizar(id: string, valor: string) {
    const pct = parseNumberBR(valor);
    const { error } = await supabase
      .from("payment_rates")
      .update({ rate_percent: pct })
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível atualizar a taxa.");
      return;
    }
    toast.success("Taxa atualizada. Novos pagamentos usarão o novo valor.");
  }

  return (
    <section className="card-surface overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-secondary text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Canal</th>
            <th className="px-4 py-3 font-medium">Forma</th>
            <th className="px-4 py-3 font-medium">Parcelas</th>
            <th className="px-4 py-3 font-medium">Taxa (%)</th>
          </tr>
        </thead>
        <tbody>
          {(rates ?? []).map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-4 py-3">{r.channel}</td>
              <td className="px-4 py-3">{r.payment_type}</td>
              <td className="px-4 py-3">{r.installments}x</td>
              <td className="px-4 py-3">
                <Input
                  defaultValue={String(r.rate_percent).replace(".", ",")}
                  onBlur={(e) => atualizar(r.id, e.target.value)}
                  className="w-[120px]"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Equipe() {
  const { data: vendedoras } = useSalespeople(false);
  const { data: tecnicos } = useTechnicians(false);

  async function salvarComissao(id: string, valor: string) {
    const pct = parseNumberBR(valor);
    const { error } = await supabase
      .from("salespeople")
      .update({ commission_percentage: pct })
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível atualizar a comissão.");
      return;
    }
    toast.success("Comissão atualizada. Vale para novas OS.");
  }

  async function salvarBase(id: string, valor: string) {
    const { error } = await supabase
      .from("technicians")
      .update({ base_address: valor })
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar o endereço base.");
      return;
    }
    toast.success("Endereço base atualizado.");
  }

  async function salvarEmail(id: string, valor: string) {
    const email = valor.trim();
    if (email && !email.includes("@")) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    const { error } = await supabase
      .from("technicians")
      .update({ email: email || null })
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar o e-mail.");
      return;
    }
    toast.success("E-mail do técnico atualizado.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card-surface p-5">
        <h2 className="mb-4 text-lg font-semibold">Vendedoras e comissões</h2>
        <div className="space-y-3">
          {(vendedoras ?? []).map((v) => (
            <div key={v.id} className="flex items-center gap-3">
              <p className="flex-1">{v.name}</p>
              <Input
                defaultValue={String(v.commission_percentage).replace(".", ",")}
                onBlur={(e) => salvarComissao(v.id, e.target.value)}
                className="w-[120px]"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card-surface p-5">
        <h2 className="mb-4 text-lg font-semibold">Técnicos</h2>
        <div className="space-y-5">
          {(tecnicos ?? []).map((t) => (
            <div key={t.id} className="space-y-3 rounded-lg border border-border p-3">
              <p className="font-medium">{t.name}</p>
              <div className="space-y-2">
                <Label>Endereço base</Label>
                <Input
                  defaultValue={t.base_address ?? ""}
                  onBlur={(e) => salvarBase(t.id, e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>E-mail (recebe o convite do Google Agenda)</Label>
                <Input
                  type="email"
                  placeholder="tecnico@empresa.com.br"
                  defaultValue={t.email ?? ""}
                  onBlur={(e) => salvarEmail(t.id, e.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function GoogleAgenda() {
  const getFn = useServerFn(getCalendarSettings);
  const saveFn = useServerFn(saveCalendarSettings);
  const testFn = useServerFn(testCalendarIntegration);

  const query = useQuery({ queryKey: ["google_calendar_settings"], queryFn: () => getFn({}) });

  const [ativa, setAtiva] = useState(false);
  const [agenda, setAgenda] = useState("primary");
  const [duracao, setDuracao] = useState("120");
  const [ocupado, setOcupado] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const d = query.data;
    if (!d) return;
    setAtiva(d.enabled);
    setAgenda(d.calendarId || "primary");
    setDuracao(String(d.durationMinutes ?? 120));
    setStatus(
      !d.hasConnection
        ? "Conta do Google não conectada"
        : d.enabled
          ? "Integração ativa"
          : "Integração desligada",
    );
  }, [query.data]);

  async function salvar() {
    setOcupado(true);
    setStatus("Salvando...");
    try {
      await saveFn({
        data: {
          enabled: ativa,
          calendarId: agenda.trim() || "primary",
          durationMinutes: Number(parseNumberBR(duracao)) || 120,
        },
      });
      toast.success("Configuração do Google Agenda salva.");
      await query.refetch();
    } catch (e) {
      setStatus("Erro ao salvar");
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    setStatus("Testando conexão");
    try {
      const r = await testFn({});
      setStatus(`Conectado à agenda "${r.calendar}"`);
      toast.success(`Conexão validada com a agenda "${r.calendar}".`);
    } catch (e) {
      setStatus("Erro na conexão");
      toast.error(e instanceof Error ? e.message : "Falha ao testar a conexão.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="card-surface max-w-3xl p-5">
      <h2 className="mb-1 text-lg font-semibold">Google Agenda</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Com a integração ligada, cada serviço agendado (e cada visita de orçamento) cria um evento
        na agenda da empresa e convida o técnico pelo e-mail cadastrado em Equipe. Situação atual:{" "}
        <strong>{status || "Não configurada"}</strong>.
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gcal-id">Agenda usada</Label>
          <Input
            id="gcal-id"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="primary (agenda principal da conta)"
          />
          <p className="text-xs text-muted-foreground">
            Deixe "primary" para usar a agenda principal, ou cole o e-mail/ID de outra agenda.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gcal-dur">Duração do evento (minutos)</Label>
          <Input
            id="gcal-dur"
            value={duracao}
            onChange={(e) => setDuracao(e.target.value)}
            className="w-[160px]"
          />
        </div>

        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          Criar eventos automaticamente no Google Agenda
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={salvar} disabled={ocupado}>
          {ocupado ? "Aguarde..." : "Salvar integração"}
        </Button>
        <Button variant="outline" onClick={testar} disabled={ocupado}>
          Testar conexão
        </Button>
      </div>
    </section>
  );
}

function Listas() {
  const origens = useConfigOptions("sales_origin", false);
  const servicos = useConfigOptions("service_type", false);
  const estofados = useConfigOptions("upholstery_type", false);

  async function adicionar(kind: string, nome: string, refetch: () => void) {
    if (nome.trim().length < 2) {
      toast.error("Informe um nome válido.");
      return;
    }
    const { error } = await supabase.from("config_options").insert({ kind, name: nome.trim() });
    if (error) {
      toast.error("Não foi possível adicionar o item.");
      return;
    }
    toast.success("Item adicionado.");
    refetch();
  }

  const blocos = [
    { titulo: "Origens da venda", kind: "sales_origin", query: origens },
    { titulo: "Tipos de serviço", kind: "service_type", query: servicos },
    { titulo: "Tipos de estofado", kind: "upholstery_type", query: estofados },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {blocos.map((b) => (
        <ListaBloco
          key={b.kind}
          titulo={b.titulo}
          kind={b.kind}
          itens={(b.query.data ?? []).map((o) => o.name)}
          onAdd={(nome) => adicionar(b.kind, nome, () => b.query.refetch())}
        />
      ))}
    </div>
  );
}

function ListaBloco({
  titulo,
  itens,
  onAdd,
}: {
  titulo: string;
  kind: string;
  itens: string[];
  onAdd: (nome: string) => void;
}) {
  const [novo, setNovo] = useState("");
  return (
    <section className="card-surface p-5">
      <h2 className="mb-3 text-lg font-semibold">{titulo}</h2>
      <ul className="mb-3 space-y-1 text-sm">
        {itens.map((i) => (
          <li key={i} className="rounded-md border border-border px-3 py-2">
            {i}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Novo item" />
        <Button
          variant="outline"
          onClick={() => {
            onAdd(novo);
            setNovo("");
          }}
        >
          Adicionar
        </Button>
      </div>
    </section>
  );
}

function Mensagem() {
  const { data: template } = useSetting<unknown>("message_template", DEFAULT_MESSAGE_TEMPLATE);
  const [texto, setTexto] = useState("");

  useEffect(() => {
    const t = templateText(template);
    if (t) setTexto(t);
  }, [template]);

  async function salvar() {
    try {
      await saveSetting("message_template", texto);
      toast.success("Modelo de mensagem salvo.");
    } catch {
      toast.error("Não foi possível salvar o modelo.");
    }
  }

  return (
    <section className="card-surface p-5">
      <h2 className="mb-2 text-lg font-semibold">Modelo da mensagem de confirmação</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Use as variáveis: {"{{dia_da_semana}}"}, {"{{data}}"}, {"{{horario}}"}, {"{{numero_os}}"},{" "}
        {"{{nome_cliente}}"}, {"{{telefone}}"}, {"{{descricao_estofado}}"}, {"{{servico}}"},{" "}
        {"{{endereco_completo}}"}, {"{{valor_formatado}}"}, {"{{tecnico}}"} e {"{{observacao}}"}.
      </p>
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="min-h-[260px] font-mono text-sm"
      />
      <Button className="mt-4" onClick={salvar}>
        Salvar modelo
      </Button>
    </section>
  );
}

function ModelosOS() {
  const ler = useServerFn(getOsDocSettings);
  const salvarFn = useServerFn(saveOsDocSettings);
  const testarFn = useServerFn(testOsDocIntegration);

  const query = useQuery({ queryKey: ["os_doc_settings"], queryFn: () => ler({}) });
  const [ativa, setAtiva] = useState(false);
  const [auto, setAuto] = useState(true);
  const [nome, setNome] = useState("OS {{NUMERO_OS}} - {{NOME_CLIENTE}}");
  const [hig, setHig] = useState("");
  const [imp, setImp] = useState("");
  const [comb, setComb] = useState("");
  const [pasta, setPasta] = useState("");
  const [status, setStatus] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setAtiva(query.data.enabled);
    setAuto(query.data.autoGenerate);
    setNome(query.data.nameTemplate);
    setStatus(query.data.configured ? "Configurada" : "Não configurada");
  }, [query.data]);

  async function salvar() {
    setOcupado(true);
    setStatus("Validando dados");
    try {
      await salvarFn({
        data: {
          enabled: ativa,
          autoGenerate: auto,
          nameTemplate: nome,
          higienizacao: hig,
          impermeabilizacao: imp,
          combinado: comb,
          pasta,
        },
      });
      toast.success("Configurações da integração salvas.");
      setHig("");
      setImp("");
      setComb("");
      setPasta("");
      await query.refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não foi possível salvar.";
      setStatus("Erro na conexão");
      toast.error(msg);
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    setStatus("Testando conexão");
    try {
      await testarFn({});
      setStatus("Conexão validada");
      toast.success("Integração validada: modelos, cópia, edição e gravação na pasta funcionando.");
    } catch (e) {
      setStatus("Erro na conexão");
      toast.error(e instanceof Error ? e.message : "Falha ao testar a integração.");
    } finally {
      setOcupado(false);
    }
  }

  const d = query.data;

  return (
    <section className="card-surface max-w-3xl p-5">
      <h2 className="mb-1 text-lg font-semibold">Modelos de ordem de serviço (Google Docs)</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Cole o link (ou o ID) de cada modelo e da pasta de destino no Google Drive. Deixe em branco
        para manter o que já está salvo. Situação atual:{" "}
        <strong>{status || "Não configurada"}</strong>.
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tpl-hig">
            Modelo Higienização {d?.hasHigienizacao ? "(salvo)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-hig"
            value={hig}
            onChange={(e) => setHig(e.target.value)}
            placeholder="Link do Google Docs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-imp">
            Modelo Impermeabilização {d?.hasImpermeabilizacao ? "(salvo)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-imp"
            value={imp}
            onChange={(e) => setImp(e.target.value)}
            placeholder="Link do Google Docs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-comb">
            Modelo Higienização e Impermeabilização {d?.hasCombinado ? "(salvo)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-comb"
            value={comb}
            onChange={(e) => setComb(e.target.value)}
            placeholder="Link do Google Docs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-pasta">
            Pasta de destino {d?.hasFolder ? "(salva)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-pasta"
            value={pasta}
            onChange={(e) => setPasta(e.target.value)}
            placeholder="Link da pasta do Google Drive"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-nome">Padrão do nome do documento</Label>
          <Input id="tpl-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>

        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          Integração ativa
        </label>
        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Gerar documento automaticamente ao salvar a OS
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={salvar} disabled={ocupado}>
          {ocupado ? "Aguarde..." : "Salvar integração"}
        </Button>
        <Button variant="outline" onClick={testar} disabled={ocupado}>
          Testar integração
        </Button>
      </div>
    </section>
  );
}
