import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, Loader2, MessageCircle, PlusCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IntegerInput, MoneyInput } from "@/components/ui/numeric-input";
import { PageHeader } from "@/components/app-shell";
import { SugestaoDiasCep } from "@/components/sugestao-dias-cep";
import { MargemOrcamento } from "@/components/margem-orcamento";
import { brl, decimal, onlyDigits } from "@/lib/format";
import { findRate, usePaymentRates, useSetting } from "@/lib/data";
import { usePapel } from "@/lib/tenant";
import { useTabelaPrecos, type ItemPreco } from "@/lib/precos";
import {
  STATUS_CLASS,
  STATUS_LABEL,
  TIPO_LABEL,
  excluirOrcamento,
  setQuoteStatus,
  useQuote,
  type QuoteStatus,
  type TipoServico,
} from "@/lib/quotes";
import { quoteWhatsappMessage, whatsappLink } from "@/lib/quote-message";
import {
  custoFixoPorServico,
  duplicarOrcamento,
  estimarKmPorCep,
  salvarOrcamento,
} from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/orcamentos/$quoteId")({
  head: () => ({
    meta: [
      { title: "Orçamento — Nexa OS" },
      {
        name: "description",
        content: "Monte os itens, veja a margem e gere a mensagem do orçamento.",
      },
      { property: "og:title", content: "Orçamento — Nexa OS" },
      {
        property: "og:description",
        content: "Monte os itens, veja a margem e gere a mensagem do orçamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrcamentoDetalhe,
});

type Linha = {
  key: string;
  tabela_preco_item_id: string;
  nome_snapshot: string;
  tipo_servico: TipoServico;
  preco_tabela: number;
  preco_aplicado: number;
  motivo_desconto: string;
  quantidade: number;
};

function novaChave() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function precoDe(item: ItemPreco | undefined, tipo: TipoServico) {
  if (!item) return 0;
  return tipo === "higienizacao"
    ? Number(item.preco_higienizacao ?? 0)
    : Number(item.preco_impermeabilizacao ?? 0);
}

const round = (v: number) => Math.round(v * 100) / 100;

function OrcamentoDetalhe() {
  const { quoteId } = Route.useParams();
  const novo = quoteId === "novo";
  const navigate = useNavigate();
  const { papel } = usePapel();
  const podeVerCustos = papel !== "tecnico";

  const { data: catalogo } = useTabelaPrecos(true);
  const { data: carregado, refetch } = useQuote(novo ? null : quoteId);
  const salvar = useServerFn(salvarOrcamento);
  const duplicar = useServerFn(duplicarOrcamento);
  const estimarKm = useServerFn(estimarKmPorCep);

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cep, setCep] = useState("");
  const [endereco, setEndereco] = useState("");
  const [dataServico, setDataServico] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desconto, setDesconto] = useState(0);
  const [aVista, setAVista] = useState(0);
  const [km, setKm] = useState(0);
  const [custoProdutos, setCustoProdutos] = useState(0);
  const [custoMaoObra, setCustoMaoObra] = useState(0);
  const [status, setStatus] = useState<QuoteStatus>("rascunho");
  const [salvando, setSalvando] = useState(false);
  const [acao, setAcao] = useState<string | null>(null);
  const ocupado = salvando || acao !== null;
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [custoKmConfig, setCustoKmConfig] = useState(0.57);
  const [parcelas, setParcelas] = useState(0); // 0 = à vista
  const [preencherAgenda, setPreencherAgenda] = useState(false);
  const [buscandoKm, setBuscandoKm] = useState(false);
  const [avisoKm, setAvisoKm] = useState<string | null>(null);
  const [cepCalculado, setCepCalculado] = useState("");

  const { data: rates } = usePaymentRates(true);
  const { data: impostoPct = 6 } = useSetting<number>("tax_percent", 6);
  const { data: alvoPct = 20 } = useSetting<number>("profit_target_percent", 20);
  const { data: minPct = 12.5 } = useSetting<number>("profit_min_percent", 12.5);
  const { data: contribMinPct = 70 } = useSetting<number>("contribution_min_percent", 70);
  const { data: contribWarnPct = 60 } = useSetting<number>("contribution_warn_percent", 60);
  const custoFixoFn = useServerFn(custoFixoPorServico);
  const { data: custoFixo } = useQuery({
    queryKey: ["custo_fixo_por_servico"],
    queryFn: () => custoFixoFn(),
  });

  const taxaPct = useMemo(
    () => (parcelas > 0 ? findRate(rates, "Maquininha", "Crédito", parcelas) : 0),
    [rates, parcelas],
  );

  useEffect(() => {
    if (!carregado) return;
    const q = carregado.quote;
    setNome(q.cliente_nome);
    setTelefone(q.cliente_telefone ?? "");
    setCep(q.cliente_cep ?? "");
    setEndereco(q.cliente_endereco ?? "");
    setDataServico(q.data_servico ?? "");
    setObservacoes(q.observacoes ?? "");
    setDesconto(Number(q.desconto ?? 0));
    setAVista(Number(q.valor_a_vista ?? 0));
    setKm(Number(q.km_ida_volta ?? 0));
    setCustoProdutos(Number(q.custo_produtos ?? 0));
    setCustoMaoObra(Number(q.custo_mao_obra ?? 0));
    setParcelas(q.forma_pagamento === "Maquininha" ? Number(q.parcelas ?? 1) : 0);
    setPreencherAgenda(Boolean(q.preencher_agenda));
    setCepCalculado(q.cliente_cep ?? "");
    setStatus(q.status);
    if (Number(q.km_ida_volta) > 0) {
      setCustoKmConfig(Number(q.custo_deslocamento ?? 0) / Number(q.km_ida_volta));
    }
    setLinhas(
      carregado.items.map((it) => ({
        key: it.id,
        tabela_preco_item_id: it.tabela_preco_item_id ?? "",
        nome_snapshot: it.nome_snapshot,
        tipo_servico: it.tipo_servico,
        preco_tabela: Number(it.preco_tabela ?? 0),
        preco_aplicado: Number(it.preco_aplicado ?? 0),
        motivo_desconto: it.motivo_desconto ?? "",
        quantidade: Number(it.quantidade ?? 1),
      })),
    );
  }, [carregado]);

  const subtotal = useMemo(
    () => round(linhas.reduce((s, l) => s + l.preco_aplicado * Math.max(1, l.quantidade), 0)),
    [linhas],
  );
  const total = round(Math.max(subtotal - desconto, 0));
  const custoDeslocamento = round(km * custoKmConfig);
  const custos = useMemo(
    () => ({
      deslocamento: custoDeslocamento,
      produtos: custoProdutos,
      maoObra: custoMaoObra,
      taxa: round((total * taxaPct) / 100),
      imposto: round((total * impostoPct) / 100),
      fixo: round(Number(custoFixo?.valor ?? 0)),
    }),
    [custoDeslocamento, custoProdutos, custoMaoObra, total, taxaPct, impostoPct, custoFixo],
  );

  function adicionarLinha() {
    setLinhas((prev) => [
      ...prev,
      {
        key: novaChave(),
        tabela_preco_item_id: "",
        nome_snapshot: "",
        tipo_servico: "higienizacao",
        preco_tabela: 0,
        preco_aplicado: 0,
        motivo_desconto: "",
        quantidade: 1,
      },
    ]);
  }

  function atualizar(key: string, campos: Partial<Linha>) {
    setLinhas((prev) => prev.map((l) => (l.key === key ? { ...l, ...campos } : l)));
  }

  function escolherItem(key: string, itemId: string, tipo: TipoServico) {
    const item = catalogo?.find((i) => i.id === itemId);
    const preco = precoDe(item, tipo);
    atualizar(key, {
      tabela_preco_item_id: itemId,
      nome_snapshot: item?.nome ?? "",
      tipo_servico: tipo,
      preco_tabela: preco,
      preco_aplicado: preco,
    });
  }

  async function buscarKm(forcar = false) {
    const digitos = onlyDigits(cep);
    if (digitos.length !== 8) return;
    if (buscandoKm) return;
    if (!forcar && digitos === cepCalculado) return;
    setBuscandoKm(true);
    setAvisoKm(null);
    try {
      const r = await estimarKm({ data: { cep: digitos } });
      setCepCalculado(digitos);
      if (r.endereco && !endereco.trim()) setEndereco(r.endereco);
      if (r.km !== null) {
        setKm(r.km);
      } else {
        setAvisoKm(r.aviso ?? "Não foi possível estimar o deslocamento por este CEP.");
      }
    } catch {
      setAvisoKm("Não foi possível estimar o deslocamento agora.");
    } finally {
      setBuscandoKm(false);
    }
  }

  // Calcula o deslocamento assim que o CEP fica completo, sem depender de sair do campo.
  useEffect(() => {
    const digitos = onlyDigits(cep);
    if (digitos.length !== 8 || digitos === cepCalculado) return;
    const t = setTimeout(() => void buscarKm(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cep, cepCalculado]);

  async function gravar(novoStatus?: QuoteStatus) {
    if (!nome.trim()) {
      toast.error("Informe o nome do cliente.");
      return;
    }
    const validas = linhas.filter((l) => l.nome_snapshot && l.preco_aplicado > 0);
    if (!validas.length) {
      toast.error("Inclua pelo menos um item com valor.");
      return;
    }
    const semMotivo = validas.find(
      (l) =>
        l.preco_tabela > 0 && l.preco_aplicado < l.preco_tabela * 0.9 && !l.motivo_desconto.trim(),
    );
    if (semMotivo) {
      toast.error(`Informe o motivo do desconto em "${semMotivo.nome_snapshot}".`);
      return;
    }

    setSalvando(true);
    try {
      const r = await salvar({
        data: {
          ...(novo ? {} : { id: quoteId }),
          cliente_nome: nome,
          cliente_telefone: onlyDigits(telefone) || null,
          cliente_cep: onlyDigits(cep) || null,
          cliente_endereco: endereco || null,
          customer_id: null,
          data_servico: dataServico || null,
          observacoes: observacoes || null,
          desconto,
          valor_a_vista: aVista > 0 ? aVista : null,
          km_ida_volta: km,
          custo_produtos: custoProdutos,
          custo_mao_obra: custoMaoObra,
          forma_pagamento: parcelas > 0 ? "Maquininha" : "À vista",
          parcelas: Math.max(parcelas, 1),
          taxa_percentual: taxaPct,
          preencher_agenda: preencherAgenda,
          status: novoStatus ?? status,
          items: validas.map((l) => ({
            tabela_preco_item_id: l.tabela_preco_item_id || null,
            nome_snapshot: l.nome_snapshot,
            tipo_servico: l.tipo_servico,
            preco_tabela: l.preco_tabela,
            preco_aplicado: l.preco_aplicado,
            motivo_desconto: l.motivo_desconto || null,
            quantidade: l.quantidade,
          })),
        },
      });
      toast.success("Orçamento salvo.");
      if (novo && r.id) {
        void navigate({ to: "/orcamentos/$quoteId", params: { quoteId: r.id } });
      } else {
        await refetch();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o orçamento.");
    } finally {
      setSalvando(false);
    }
  }

  function gerarMensagem() {
    if (!carregado) {
      toast.info("Salve o orçamento antes de gerar a mensagem.");
      return;
    }
    setMensagem(quoteWhatsappMessage(carregado.quote, carregado.items));
  }

  return (
    <>
      <PageHeader
        title={novo ? "Novo orçamento" : `Orçamento de ${carregado?.quote.cliente_nome ?? ""}`}
        description="Os custos e a margem são de uso interno e não aparecem na mensagem do cliente."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" asChild>
          <Link to="/orcamentos">
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Link>
        </Button>
        {!novo && carregado ? (
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASS[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        ) : null}
        {carregado?.quote.generated_work_order_id ? (
          <span className="text-xs text-muted-foreground">Este orçamento já virou OS.</span>
        ) : null}
      </div>

      <section className="card-surface mb-4 grid gap-3 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="nome">Nome do cliente</Label>
          <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tel">Celular</Label>
          <Input
            id="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            inputMode="tel"
          />
        </div>
        <div>
          <Label htmlFor="cep">CEP</Label>
          <Input
            id="cep"
            value={cep}
            onChange={(e) => setCep(e.target.value)}
            onBlur={() => void buscarKm()}
            inputMode="numeric"
            placeholder="00000-000"
          />
          {buscandoKm ? (
            <p className="mt-1 text-xs text-muted-foreground">Calculando deslocamento…</p>
          ) : avisoKm ? (
            <p className="mt-1 text-xs text-destructive">{avisoKm} Você pode ajustar o km à mão.</p>
          ) : km > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {decimal(km, 1)} km ida e volta · {brl(custoDeslocamento)} de deslocamento{" "}
              <button type="button" className="underline" onClick={() => void buscarKm(true)}>
                recalcular
              </button>
            </p>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="end">Endereço</Label>
          <Input id="end" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="obs">Observações</Label>
          <Textarea
            id="obs"
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={2}
          />
        </div>
      </section>

      <SugestaoDiasCep
        cepInicial={onlyDigits(cep)}
        ocultarCampo
        titulo="Melhores dias para este CEP (uso interno)"
        onEscolher={(dia) => {
          setDataServico(dia);
          toast.success(
            `Dia escolhido guardado no orçamento: ${dia.split("-").reverse().join("/")}.`,
          );
        }}
      />
      {dataServico ? (
        <p className="-mt-4 mb-6 text-sm text-muted-foreground">
          Dia escolhido (interno): <strong>{dataServico.split("-").reverse().join("/")}</strong> —
          será usado quando o orçamento virar OS.{" "}
          <button type="button" className="underline" onClick={() => setDataServico("")}>
            limpar
          </button>
        </p>
      ) : null}

      <section className="card-surface mb-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Itens do orçamento</h2>
          <Button variant="outline" onClick={adicionarLinha}>
            <PlusCircle className="mr-2 h-4 w-4" /> Adicionar item
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          {linhas.map((l) => {
            const item = catalogo?.find((i) => i.id === l.tabela_preco_item_id);
            const semImper = !item?.preco_impermeabilizacao;
            const abaixo = l.preco_tabela > 0 && l.preco_aplicado < l.preco_tabela;
            const muitoAbaixo = l.preco_tabela > 0 && l.preco_aplicado < l.preco_tabela * 0.9;
            return (
              <div key={l.key} className="rounded-xl border border-border/70 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_11rem_5rem_9rem_auto]">
                  <div>
                    <Label className="text-xs">Item</Label>
                    <select
                      value={l.tabela_preco_item_id}
                      onChange={(e) => escolherItem(l.key, e.target.value, l.tipo_servico)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">Selecione…</option>
                      {(catalogo ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Serviço</Label>
                    <select
                      value={l.tipo_servico}
                      onChange={(e) =>
                        escolherItem(l.key, l.tabela_preco_item_id, e.target.value as TipoServico)
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="higienizacao">{TIPO_LABEL.higienizacao}</option>
                      <option value="impermeabilizacao" disabled={semImper}>
                        {TIPO_LABEL.impermeabilizacao}
                        {semImper ? " (não disponível)" : ""}
                      </option>
                    </select>
                    {semImper && l.tabela_preco_item_id ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Não disponível para este item
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label className="text-xs">Qtd</Label>
                    <IntegerInput
                      value={l.quantidade}
                      onValueChange={(v) => atualizar(l.key, { quantidade: Math.max(1, v) })}
                      min={1}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Preço unitário</Label>
                    <MoneyInput
                      value={l.preco_aplicado}
                      onValueChange={(v) => atualizar(l.key, { preco_aplicado: v })}
                      className={
                        muitoAbaixo
                          ? "border-destructive text-destructive"
                          : abaixo
                            ? "border-amber-500 text-amber-700"
                            : ""
                      }
                    />
                    {l.preco_tabela > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Tabela: {brl(l.preco_tabela)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {brl(l.preco_aplicado * Math.max(1, l.quantidade))}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover item"
                      onClick={() => setLinhas((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {muitoAbaixo ? (
                  <div className="mt-2">
                    <Label className="text-xs">Motivo do desconto (obrigatório)</Label>
                    <Input
                      value={l.motivo_desconto}
                      onChange={(e) => atualizar(l.key, { motivo_desconto: e.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
          {!linhas.length ? (
            <p className="text-sm text-muted-foreground">Nenhum item adicionado ainda.</p>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Subtotal</Label>
            <p className="text-lg font-medium">{brl(subtotal)}</p>
          </div>
          <div>
            <Label className="text-xs">Desconto (R$)</Label>
            <MoneyInput value={desconto} onValueChange={setDesconto} />
          </div>
          <div>
            <Label className="text-xs">Total</Label>
            <p className="text-2xl font-semibold text-primary">{brl(total)}</p>
          </div>
          <div>
            <Label className="text-xs">Valor à vista (opcional)</Label>
            <MoneyInput value={aVista} onValueChange={setAVista} />
          </div>
        </div>
      </section>

      {podeVerCustos ? (
        <section className="card-surface mb-4 p-5">
          <details open>
            <summary className="cursor-pointer text-lg font-semibold">
              Pode fechar? — custos e margem (uso interno)
            </summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div>
                <Label className="text-xs">Km ida e volta</Label>
                <MoneyInput value={km} onValueChange={setKm} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Sugerido pelo CEP; pode ajustar.
                </p>
              </div>
              <div>
                <Label className="text-xs">Custo de deslocamento</Label>
                <p className="text-lg font-medium">{brl(custoDeslocamento)}</p>
                <p className="text-xs text-muted-foreground">{brl(custoKmConfig)}/km</p>
              </div>
              <div>
                <Label className="text-xs">Custo de produtos</Label>
                <MoneyInput value={custoProdutos} onValueChange={setCustoProdutos} />
              </div>
              <div>
                <Label className="text-xs">Mão de obra</Label>
                <MoneyInput value={custoMaoObra} onValueChange={setCustoMaoObra} />
              </div>
            </div>
            <div className="mt-4 max-w-xs">
              <Label className="text-xs">Forma de pagamento considerada</Label>
              <select
                value={parcelas}
                onChange={(e) => setParcelas(Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                <option value={0}>À vista (Pix/dinheiro, sem taxa)</option>
                {[1, 2, 3, 4, 5].map((n) => {
                  const t = findRate(rates, "Maquininha", "Crédito", n);
                  return (
                    <option key={n} value={n}>
                      Crédito em {n}x — taxa {decimal(t, 2)}%
                    </option>
                  );
                })}
              </select>
            </div>
            <label className="mt-4 flex items-start gap-2 rounded-xl border border-border/70 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={preencherAgenda}
                onChange={(e) => setPreencherAgenda(e.target.checked)}
              />
              <span>
                <strong>Serviço para preencher agenda (horário ocioso)</strong>
                <span className="block text-xs text-muted-foreground">
                  O semáforo passa a julgar pela margem de contribuição, sem exigir o rateio dos
                  custos fixos.
                </span>
              </span>
            </label>
            <MargemOrcamento
              total={total}
              custos={custos}
              taxaPct={taxaPct}
              impostoPct={impostoPct}
              alvoPct={alvoPct}
              minPct={minPct}
              contribMinPct={contribMinPct}
              contribWarnPct={contribWarnPct}
              modo={preencherAgenda ? "agenda" : "normal"}
              custoFixoFonte={custoFixo}
            />
          </details>
        </section>
      ) : null}

      <section className="card-surface mb-4 flex flex-wrap items-center gap-2 p-5">
        <Button disabled={ocupado} onClick={() => void gravar()}>
          {salvando ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…
            </>
          ) : (
            "Salvar"
          )}
        </Button>
        {!novo ? (
          <>
            <select
              value={status}
              disabled={ocupado}
              onChange={(e) => {
                const s = e.target.value as QuoteStatus;
                setStatus(s);
                setAcao("status");
                void setQuoteStatus(quoteId, s)
                  .then(() => refetch())
                  .then(() => toast.success("Situação atualizada."))
                  .catch(() => toast.error("Não foi possível mudar a situação."))
                  .finally(() => setAcao(null));
              }}
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              {(["rascunho", "enviado", "aprovado", "recusado", "convertido"] as QuoteStatus[]).map(
                (s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ),
              )}
            </select>
            <Button variant="outline" onClick={gerarMensagem} disabled={ocupado}>
              <MessageCircle className="mr-2 h-4 w-4" /> Gerar mensagem WhatsApp
            </Button>
            <Button
              variant="outline"
              disabled={ocupado}
              onClick={() => {
                setAcao("duplicar");
                void duplicar({ data: { id: quoteId } })
                  .then((r) => {
                    toast.success("Orçamento duplicado.");
                    if (r.id)
                      void navigate({ to: "/orcamentos/$quoteId", params: { quoteId: r.id } });
                  })
                  .catch(() => toast.error("Não foi possível duplicar."))
                  .finally(() => setAcao(null));
              }}
            >
              {acao === "duplicar" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {acao === "duplicar" ? "Duplicando…" : "Duplicar"}
            </Button>
            <Button
              onClick={() => void navigate({ to: "/nova-os", search: { cotacao: quoteId } })}
              disabled={ocupado || Boolean(carregado?.quote.generated_work_order_id)}
            >
              Transformar em OS
            </Button>
            <Button
              variant="ghost"
              disabled={ocupado}
              onClick={() => {
                if (!window.confirm("Excluir este orçamento?")) return;
                setAcao("excluir");
                void excluirOrcamento(quoteId)
                  .then(() => {
                    toast.success("Orçamento excluído.");
                    void navigate({ to: "/orcamentos" });
                  })
                  .catch(() => toast.error("Não foi possível excluir."))
                  .finally(() => setAcao(null));
              }}
            >
              {acao === "excluir" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
              )}
              {acao === "excluir" ? "Excluindo…" : "Excluir"}
            </Button>
            {acao === "status" ? (
              <span className="text-xs text-muted-foreground">Salvando situação…</span>
            ) : null}
          </>
        ) : null}
      </section>

      {mensagem ? (
        <section className="card-surface p-5">
          <h2 className="text-lg font-semibold">Mensagem para o cliente</h2>
          <Textarea readOnly value={mensagem} rows={18} className="mt-3 font-mono text-xs" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(mensagem)
                  .then(() => toast.success("Mensagem copiada."))
                  .catch(() => toast.error("Copie manualmente do campo acima."));
              }}
            >
              Copiar mensagem
            </Button>
            <Button variant="outline" asChild>
              <a href={whatsappLink(telefone, mensagem)} target="_blank" rel="noreferrer">
                Abrir no WhatsApp
              </a>
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
