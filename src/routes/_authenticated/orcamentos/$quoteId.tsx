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
import { supabase } from "@/integrations/supabase/client";
import { useTabelaPrecos, type ItemPreco } from "@/lib/precos";
import { useConfigOrcamento } from "@/lib/orcamento-config";
import {
  acrescimoDoItem,
  calcularTotais,
  precoComAcrescimo,
  sugerirPrecos,
  valorPix as valorNoPix,
  type Categoria,
  type Classe,
  type ModoDesconto,
} from "@/lib/orcamento-regras";
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
import { useTextosEmpresa } from "@/lib/textos-cliente";
import {
  custoFixoPorServico,
  descontosDoCliente,
  duplicarOrcamento,
  estimarKmPorCep,
  salvarOrcamento,
} from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/orcamentos/$quoteId")({
  validateSearch: (search: Record<string, unknown>): { lead?: string } =>
    typeof search["lead"] === "string" ? { lead: search["lead"] as string } : {},
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

/** Percentual sem casas desnecessárias: 20 → "20", 12,5 → "12,5". */
const pct = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

type Linha = {
  key: string;
  tabela_preco_item_id: string;
  nome_snapshot: string;
  tipo_servico: TipoServico;
  categoria: Categoria;
  preco_tabela: number;
  /** Valor digitado pela atendente; sem ele, vale o sugerido pelas regras. */
  preco_editado: number | null;
  desconto: ModoDesconto;
  /** Classe do estofado e acréscimos (quando a empresa usa). */
  classe: Classe;
  almofadas: boolean;
  encardido: boolean;
  motivo_desconto: string;
  quantidade: number;
  editado_por: string | null;
  editado_em: string | null;
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
  const { lead: leadParam } = Route.useSearch();
  const novo = quoteId === "novo";
  const navigate = useNavigate();
  const { papel } = usePapel();
  const podeVerCustos = papel !== "tecnico";

  const { data: catalogo } = useTabelaPrecos(true);
  const { regras } = useConfigOrcamento();
  const textosEmpresa = useTextosEmpresa();
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
  // Desconto: nenhum, campanha OU indicação (percentual das regras de marketing) ou valor manual.
  const [descontoTipo, setDescontoTipo] = useState<"nenhum" | "campanha" | "indicacao" | "manual">(
    "nenhum",
  );
  // Valor no Pix: calculado (total − Pix da empresa); só fica fixo se a atendente editar.
  const [aVistaEditado, setAVistaEditado] = useState<number | null>(null);
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
  const [metodoKm, setMetodoKm] = useState<"ruas" | "linha_reta" | null>(null);
  const [cepCalculado, setCepCalculado] = useState("");
  const [lead, setLead] = useState<{ id: string; lead_name: string | null } | null>(null);
  // Regras de preço da empresa.
  const [principalKey, setPrincipalKey] = useState<string | null>(null);
  const [muitoSujo, setMuitoSujo] = useState(false);
  const [clienteNovo, setClienteNovo] = useState<boolean | null>(null);
  const [kmIda, setKmIda] = useState<number | null>(null);
  const [baseTecnico, setBaseTecnico] = useState<string | null>(null);
  const [cartaoEditado, setCartaoEditado] = useState<number | null>(null);
  const [pixEditado, setPixEditado] = useState<number | null>(null);

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
    setDescontoTipo(q.desconto_tipo ?? (Number(q.desconto ?? 0) > 0 ? "manual" : "nenhum"));
    // Valor salvo; se for igual ao calculado, deixa de contar como editado (efeito abaixo).
    setAVistaEditado(q.valor_a_vista === null ? null : Number(q.valor_a_vista));
    setKm(Number(q.km_ida_volta ?? 0));
    setCustoProdutos(Number(q.custo_produtos ?? 0));
    setCustoMaoObra(Number(q.custo_mao_obra ?? 0));
    setParcelas(q.forma_pagamento === "Maquininha" ? Number(q.parcelas ?? 1) : 0);
    setPreencherAgenda(Boolean(q.preencher_agenda));
    setCepCalculado(q.cliente_cep ?? "");
    setStatus(q.status);
    setLead(q.lead ?? null);
    if (Number(q.km_ida_volta) > 0) {
      setCustoKmConfig(Number(q.custo_deslocamento ?? 0) / Number(q.km_ida_volta));
    }
    setMuitoSujo(Boolean(q.muito_sujo));
    setClienteNovo(q.cliente_novo ?? null);
    setKmIda(
      q.distancia_km === null || q.distancia_km === undefined ? null : Number(q.distancia_km),
    );
    setBaseTecnico(q.distancia_base ?? null);
    const vitrineSalva = q.valor_vitrine !== null && q.valor_vitrine !== undefined;
    setCartaoEditado(vitrineSalva && q.valores_editados_por ? Number(q.valor_cartao) : null);
    setPixEditado(vitrineSalva && q.valores_editados_por ? Number(q.valor_pix) : null);
    setPrincipalKey(carregado.items.find((it) => it.item_principal)?.id ?? null);
    setLinhas(
      carregado.items.map((it) => {
        const aplicado = Number(it.preco_aplicado ?? 0);
        const tabela = Number(it.preco_tabela ?? 0);
        const sugerido = it.preco_sugerido === null ? null : Number(it.preco_sugerido);
        const ref = sugerido ?? (tabela > 0 ? tabela : null);
        const editado =
          Boolean(it.editado_por || it.editado_em) ||
          (ref !== null && Math.abs(aplicado - ref) > 0.004);
        const categoria = (it.categoria ?? "outro") as Categoria;
        const naRegra = regras.descontoAdicional.categorias.includes(categoria);
        const descontoRegra = Number(it.desconto_regra_valor ?? 0);
        return {
          key: it.id,
          tabela_preco_item_id: it.tabela_preco_item_id ?? "",
          nome_snapshot: it.nome_snapshot,
          tipo_servico: it.tipo_servico,
          categoria,
          preco_tabela: tabela,
          preco_editado: editado ? aplicado : null,
          classe: (it.classe ?? "B") as Classe,
          almofadas: Boolean(it.almofadas_soltas),
          encardido: Boolean(it.muito_encardido),
          desconto: (descontoRegra > 0 && !naRegra
            ? "sim"
            : descontoRegra === 0 && naRegra && !it.item_principal && sugerido !== null
              ? "nao"
              : "auto") as ModoDesconto,
          motivo_desconto: it.motivo_desconto ?? "",
          quantidade: Number(it.quantidade ?? 1),
          editado_por: it.editado_por ?? null,
          editado_em: it.editado_em ?? null,
        };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregado]);

  // Cliente novo: telefone sem cadastro de cliente na empresa (a atendente pode trocar).
  const final8 = onlyDigits(telefone).slice(-8);
  const { data: clienteNovoDetectado = null } = useQuery({
    queryKey: ["orcamento-cliente-novo", final8],
    enabled: regras.vitrine.ligada && final8.length === 8,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id")
        .ilike("phone", `%${final8}`)
        .limit(1);
      if (error) return null;
      return (data ?? []).length === 0;
    },
  });
  useEffect(() => {
    if (clienteNovo === null && clienteNovoDetectado !== null) setClienteNovo(clienteNovoDetectado);
  }, [clienteNovo, clienteNovoDetectado]);

  // Orçamento novo aberto a partir de um lead: já vem com nome e telefone do lead.
  useEffect(() => {
    if (!novo || !leadParam) return;
    let ativo = true;
    void supabase
      .from("crm_leads")
      .select("id, lead_name, phone")
      .eq("id", leadParam)
      .maybeSingle()
      .then(({ data }) => {
        if (!ativo || !data) return;
        setLead({ id: data.id, lead_name: data.lead_name });
        setNome((atual) => atual || data.lead_name || "");
        setTelefone((atual) => atual || data.phone || "");
      });
    return () => {
      ativo = false;
    };
  }, [novo, leadParam]);

  // Classe e acréscimos do item: % sobre a tabela e o preço já arredondado para o real de cima.
  const acrescimoDe = (l: Linha) =>
    acrescimoDoItem(regras, {
      classe: l.classe,
      almofadasSoltas: l.almofadas,
      muitoEncardido: l.encardido,
    });
  const tabelaComAcrescimo = (l: Linha) => precoComAcrescimo(l.preco_tabela, acrescimoDe(l));

  // Descontos que o cliente tem (campanha ou indicação), pela mesma regra da Alice.
  const descontosFn = useServerFn(descontosDoCliente);
  const foneDigitos = onlyDigits(telefone);
  const { data: descontosCliente } = useQuery({
    queryKey: ["orcamento-descontos", foneDigitos],
    enabled: foneDigitos.length >= 10,
    queryFn: () => descontosFn({ data: { telefone: foneDigitos } }),
  });
  const opcaoDesconto =
    descontoTipo === "campanha" || descontoTipo === "indicacao"
      ? descontosCliente?.[descontoTipo]
      : undefined;
  const descontoPct = opcaoDesconto && "pct" in opcaoDesconto ? opcaoDesconto.pct : null;

  // Preço sugerido pelas regras (item principal cheio, adicionais com desconto) e valor final.
  const sugestoes = useMemo(
    () =>
      sugerirPrecos(
        linhas.map((l) => ({
          key: l.key,
          categoria: l.categoria,
          precoTabela: tabelaComAcrescimo(l),
          quantidade: l.quantidade,
          desconto: l.desconto,
        })),
        regras,
        principalKey,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linhas, regras, principalKey],
  );
  const sugeridoDe = (l: Linha) => sugestoes.get(l.key)?.precoSugerido ?? tabelaComAcrescimo(l);
  const finalDe = (l: Linha) => l.preco_editado ?? sugeridoDe(l);
  const totais = useMemo(
    () =>
      calcularTotais({
        linhas: linhas.map((l) => ({
          categoria: l.categoria,
          precoAplicado: l.preco_editado ?? sugeridoDe(l),
          quantidade: l.quantidade,
        })),
        regras,
        muitoSujo,
        distanciaKm: kmIda,
        desconto: descontoTipo === "manual" ? desconto : 0,
        descontoPct,
        clienteNovo: clienteNovo !== false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linhas, sugestoes, regras, muitoSujo, kmIda, desconto, descontoTipo, descontoPct, clienteNovo],
  );
  const subtotal = totais.subtotalItens;
  const vitrine = totais.vitrine;
  const valorCartao = vitrine ? (cartaoEditado ?? vitrine.cartao) : null;
  const valorPix = vitrine ? (pixEditado ?? vitrine.pix) : null;
  const total = vitrine ? round(valorCartao ?? 0) : totais.base;
  const pixPct = textosEmpresa?.pixPct ?? 0;
  const aVistaCalculado = pixPct > 0 ? valorNoPix(total, pixPct) : 0;
  const aVista = aVistaEditado ?? aVistaCalculado;
  useEffect(() => {
    if (aVistaEditado !== null && Math.abs(aVistaEditado - aVistaCalculado) < 0.005)
      setAVistaEditado(null);
  }, [aVistaEditado, aVistaCalculado]);
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
        categoria: "outro",
        preco_tabela: 0,
        preco_editado: null,
        desconto: "auto",
        classe: "B",
        almofadas: false,
        encardido: false,
        motivo_desconto: "",
        quantidade: 1,
        editado_por: null,
        editado_em: null,
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
      categoria: item?.categoria ?? "outro",
      preco_tabela: preco,
      preco_editado: null,
      editado_por: null,
      editado_em: null,
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
        setMetodoKm(r.metodo ?? null);
        setKmIda(r.kmIda ?? null);
        setBaseTecnico(r.base ?? null);
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
      return false;
    }
    const validas = linhas.filter((l) => l.nome_snapshot && finalDe(l) > 0);
    if (!validas.length) {
      toast.error("Inclua pelo menos um item com valor.");
      return false;
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
          desconto: descontoTipo === "manual" ? desconto : 0,
          desconto_tipo: descontoTipo === "nenhum" ? null : descontoTipo,
          desconto_pct: descontoPct,
          valor_a_vista: aVista > 0 ? aVista : null,
          km_ida_volta: km,
          custo_produtos: custoProdutos,
          custo_mao_obra: custoMaoObra,
          forma_pagamento: parcelas > 0 ? "Maquininha" : "À vista",
          parcelas: Math.max(parcelas, 1),
          taxa_percentual: taxaPct,
          preencher_agenda: preencherAgenda,
          ...(lead ? { crm_lead_id: lead.id } : {}),
          status: novoStatus ?? status,
          cliente_novo: regras.vitrine.ligada ? clienteNovo !== false : clienteNovo,
          muito_sujo: muitoSujo,
          distancia_km: kmIda,
          distancia_base: baseTecnico,
          valor_cartao_editado: cartaoEditado,
          valor_pix_editado: pixEditado,
          items: validas.map((l) => {
            const sug = sugestoes.get(l.key);
            return {
              tabela_preco_item_id: l.tabela_preco_item_id || null,
              nome_snapshot: l.nome_snapshot,
              tipo_servico: l.tipo_servico,
              preco_tabela: l.preco_tabela,
              preco_aplicado: finalDe(l),
              motivo_desconto: l.motivo_desconto || null,
              classe: regras.classe.ligada ? l.classe : null,
              almofadas_soltas: regras.acrescimos.ligado && l.almofadas,
              muito_encardido: regras.acrescimos.ligado && l.encardido,
              quantidade: l.quantidade,
              categoria: l.categoria,
              preco_sugerido: sug ? sug.precoSugerido : l.preco_tabela || null,
              desconto_regra_valor: sug?.descontoValor ?? 0,
              desconto_regra_texto: sug?.descontoTexto ?? null,
              item_principal: Boolean(sug?.principal),
              editado_por: l.preco_editado !== null ? l.editado_por : null,
              editado_em: l.preco_editado !== null ? l.editado_em : null,
            };
          }),
        },
      });
      toast.success("Orçamento salvo.");
      if (novo && r.id) {
        void navigate({ to: "/orcamentos/$quoteId", params: { quoteId: r.id } });
        return false;
      }
      await refetch();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o orçamento.");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  /** Aprova os valores (salva) e monta a mensagem com o que ficou gravado. */
  async function gerarMensagem() {
    if (!textosEmpresa) {
      toast.info("Carregando os textos da empresa. Tente de novo em instantes.");
      return;
    }
    if (!(await gravar())) return;
    const { data } = await refetch();
    if (!data) return;
    setMensagem(quoteWhatsappMessage(data.quote, data.items, { ...textosEmpresa, regras }));
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
        {lead ? (
          <Link
            to="/crm/lead/$leadId"
            params={{ leadId: lead.id }}
            className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:underline"
          >
            Lead: {lead.lead_name || "sem nome"}
          </Link>
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
              {decimal(km, 1)} km ida e volta
              {metodoKm === "ruas"
                ? " pelas ruas"
                : metodoKm === "linha_reta"
                  ? " (aproximado em linha reta; confira)"
                  : ""}{" "}
              · {brl(custoDeslocamento)} de deslocamento{" "}
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

        {regras.descontoAdicional.ligado && linhas.length > 1 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Item principal com preço cheio; itens adicionais com -
            {pct(regras.descontoAdicional.pct)}
            %. Toque em "Principal" para trocar e em "Desconto" para escolher onde ele vai.
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          {linhas.map((l) => {
            const item = catalogo?.find((i) => i.id === l.tabela_preco_item_id);
            const semImper = !item?.preco_impermeabilizacao;
            const sug = sugestoes.get(l.key);
            const sugerido = sugeridoDe(l);
            const final = finalDe(l);
            const editado =
              l.preco_editado !== null && Math.abs(l.preco_editado - sugerido) > 0.004;
            const naRegra = regras.descontoAdicional.categorias.includes(l.categoria);
            return (
              <div key={l.key} className="rounded-xl border border-border/70 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_11rem_5rem_9rem_auto]">
                  <div>
                    <Label className="text-xs">Item</Label>
                    <select
                      value={l.tabela_preco_item_id}
                      onChange={(e) => escolherItem(l.key, e.target.value, l.tipo_servico)}
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring sm:h-9"
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
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring sm:h-9"
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
                    <Label className="text-xs">
                      Preço unitário
                      {editado ? (
                        <span className="ml-2 rounded-full bg-atencao px-2 py-0.5 text-[11px] font-medium text-atencao-foreground">
                          editado
                        </span>
                      ) : null}
                    </Label>
                    <MoneyInput
                      value={final}
                      onValueChange={(v) =>
                        atualizar(l.key, {
                          preco_editado: Math.abs(v - sugerido) > 0.004 ? v : null,
                        })
                      }
                      className={editado ? "border-atencao-foreground" : ""}
                    />
                    {l.preco_tabela > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Valor da tabela: {brl(l.preco_tabela)}
                        {Math.abs(sugerido - l.preco_tabela) > 0.004 ? (
                          <> · sugerido {brl(sugerido)}</>
                        ) : null}
                      </p>
                    ) : null}
                    {editado ? (
                      <button
                        type="button"
                        className="mt-1 min-h-11 text-xs underline sm:min-h-0"
                        onClick={() => atualizar(l.key, { preco_editado: null })}
                      >
                        Voltar ao sugerido
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {brl(final * Math.max(1, l.quantidade))}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover item"
                      className="h-11 w-11"
                      onClick={() => setLinhas((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {(regras.classe.ligada || regras.acrescimos.ligado) && l.preco_tabela > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {regras.classe.ligada ? (
                      <div
                        role="radiogroup"
                        aria-label="Classe do estofado"
                        className="flex overflow-hidden rounded-full border border-border"
                      >
                        {(["A", "B", "C"] as const).map((c) => (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={l.classe === c}
                            onClick={() => atualizar(l.key, { classe: c })}
                            className={`min-h-11 min-w-11 px-3 font-medium sm:min-h-8 ${
                              l.classe === c ? "bg-primary text-primary-foreground" : ""
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {regras.acrescimos.ligado ? (
                      <>
                        <label className="flex min-h-11 items-center gap-2 rounded-full border border-border px-3 sm:min-h-8">
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={l.almofadas}
                            onChange={(e) => atualizar(l.key, { almofadas: e.target.checked })}
                          />
                          Almofadas soltas
                        </label>
                        <label className="flex min-h-11 items-center gap-2 rounded-full border border-border px-3 sm:min-h-8">
                          <input
                            type="checkbox"
                            className="h-5 w-5"
                            checked={l.encardido}
                            onChange={(e) => atualizar(l.key, { encardido: e.target.checked })}
                          />
                          Muito encardido
                        </label>
                      </>
                    ) : null}
                    {acrescimoDe(l) > 0 ? (
                      <span className="text-muted-foreground">
                        +{pct(acrescimoDe(l))}% → {brl(tabelaComAcrescimo(l))}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {regras.descontoAdicional.ligado && l.preco_tabela > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setPrincipalKey(l.key)}
                      className={`min-h-11 rounded-full border px-3 sm:min-h-8 ${
                        sug?.principal
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border"
                      }`}
                    >
                      {sug?.principal ? "Principal (preço cheio)" : "Tornar principal"}
                    </button>
                    {!sug?.principal || l.quantidade > 1 ? (
                      <label className="flex min-h-11 items-center gap-2 sm:min-h-8">
                        Desconto
                        <select
                          value={l.desconto}
                          onChange={(e) =>
                            atualizar(l.key, { desconto: e.target.value as ModoDesconto })
                          }
                          className="h-11 rounded-md border border-input bg-background px-2 sm:h-8"
                        >
                          <option value="auto">
                            Automático ({naRegra ? "com desconto" : "sem desconto"})
                          </option>
                          <option value="sim">Com desconto</option>
                          <option value="nao">Sem desconto</option>
                        </select>
                      </label>
                    ) : null}
                    {sug?.descontoTexto ? (
                      <span className="text-muted-foreground">
                        {sug.descontoTexto} (−{brl(sug.descontoValor)})
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {editado ? (
                  <div className="mt-2">
                    <Label className="text-xs">Motivo da alteração (opcional)</Label>
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

        {regras.sujidade.ligado || regras.distancia.ligado || regras.vitrine.ligada ? (
          <div className="mt-5 space-y-3 border-t border-border/70 pt-4">
            {regras.vitrine.ligada ? (
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={clienteNovo !== false}
                  onChange={(e) => {
                    setClienteNovo(e.target.checked);
                    setCartaoEditado(null);
                    setPixEditado(null);
                  }}
                />
                <span>
                  Cliente novo (ganha {pct(regras.vitrine.boasVindasPct)}% de boas-vindas)
                  {clienteNovoDetectado !== null ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      — pelo telefone: {clienteNovoDetectado ? "cliente novo" : "já é cliente"}
                    </span>
                  ) : null}
                </span>
              </label>
            ) : null}
            {regras.sujidade.ligado ? (
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={muitoSujo}
                  onChange={(e) => setMuitoSujo(e.target.checked)}
                />
                <span>
                  Muito sujo (+{pct(regras.sujidade.pct)}% no pedido)
                  {totais.acrescimoSujidade > 0 ? ` · +${brl(totais.acrescimoSujidade)}` : ""}
                </span>
              </label>
            ) : null}
            {regras.distancia.ligado ? (
              <div className="text-sm">
                <p>
                  Distância (só a ida, da base do técnico mais próximo):{" "}
                  <strong>
                    {kmIda === null ? "preencha o CEP do cliente" : `${decimal(kmIda, 1)} km`}
                  </strong>
                  {baseTecnico ? ` · base ${baseTecnico}` : ""}
                  {totais.acrescimoDistancia > 0
                    ? ` · +${pct(regras.distancia.pct)}% (+${brl(totais.acrescimoDistancia)})`
                    : ""}
                </p>
                {totais.foraDaArea ? (
                  <p className="mt-1 rounded-md bg-atencao px-3 py-2 text-atencao-foreground">
                    Fora da área de atendimento (acima de{" "}
                    {decimal(regras.distancia.limiteKm ?? 0, 1)} km). Confirme com a equipe antes de
                    enviar.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Subtotal</Label>
            <p className="text-lg font-medium">{brl(subtotal)}</p>
            {totais.minimoAplicado > 0 ? (
              <p className="text-xs text-muted-foreground">
                Pedido mínimo de cadeiras: +{brl(totais.minimoAplicado)}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="desconto-tipo" className="text-xs">
              Desconto
            </Label>
            <select
              id="desconto-tipo"
              value={descontoTipo}
              onChange={(e) => {
                setDescontoTipo(e.target.value as typeof descontoTipo);
                setCartaoEditado(null);
                setPixEditado(null);
                setAVistaEditado(null);
              }}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring sm:h-9"
            >
              <option value="nenhum">Sem desconto</option>
              {(["campanha", "indicacao"] as const).map((t) => {
                const op = descontosCliente?.[t];
                const nomeOp = t === "campanha" ? "Campanha" : "Indicação";
                return (
                  <option key={t} value={t} disabled={!op || !("pct" in op)}>
                    {op && "pct" in op
                      ? `${nomeOp} (${pct(op.pct)}%)`
                      : `${nomeOp} (não disponível)`}
                  </option>
                );
              })}
              <option value="manual">Valor manual (R$)</option>
            </select>
            {descontoTipo === "manual" ? (
              <MoneyInput
                className="mt-2"
                value={desconto}
                onValueChange={(v) => {
                  setDesconto(v);
                  setCartaoEditado(null);
                  setPixEditado(null);
                  setAVistaEditado(null);
                }}
              />
            ) : opcaoDesconto && "pct" in opcaoDesconto ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {opcaoDesconto.rotulo}: −{brl(totais.desconto)}
              </p>
            ) : opcaoDesconto && "erro" in opcaoDesconto ? (
              <p className="mt-1 text-xs text-destructive">{opcaoDesconto.erro}</p>
            ) : foneDigitos.length < 10 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Campanha e indicação aparecem com o celular do cliente preenchido.
              </p>
            ) : null}
          </div>
          {vitrine ? (
            <div>
              <Label className="text-xs">Valor mínimo (tabela no Pix)</Label>
              <p className="text-lg font-medium">{brl(totais.base)}</p>
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">Total</Label>
                <p className="text-2xl font-semibold text-primary">{brl(total)}</p>
              </div>
              <div>
                <Label className="text-xs">
                  {pixPct > 0 ? `No Pix (−${pct(pixPct)}%)` : "Valor à vista (opcional)"}
                  {aVistaEditado !== null ? (
                    <span className="ml-2 rounded-full bg-atencao px-2 py-0.5 text-[11px] font-medium text-atencao-foreground">
                      editado
                    </span>
                  ) : null}
                </Label>
                <MoneyInput
                  value={aVista}
                  onValueChange={(v) =>
                    setAVistaEditado(Math.abs(v - aVistaCalculado) > 0.004 ? v : null)
                  }
                />
                {pixPct > 0 && aVistaEditado !== null ? (
                  <button
                    type="button"
                    className="mt-1 min-h-11 text-xs underline sm:min-h-0"
                    onClick={() => setAVistaEditado(null)}
                  >
                    Voltar ao calculado ({brl(aVistaCalculado)})
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>

        {vitrine ? (
          <div className="mt-4 rounded-xl border border-border/70 p-3">
            <p className="text-sm font-medium">Valores para o cliente</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Valor dos estofados</Label>
                <p className="text-lg font-medium">{brl(vitrine.vitrine)}</p>
              </div>
              <div>
                <Label className="text-xs">
                  Cartão{vitrine.boasVindas ? " (com boas-vindas)" : ""}
                  {cartaoEditado !== null ? (
                    <span className="ml-2 rounded-full bg-atencao px-2 py-0.5 text-[11px] font-medium text-atencao-foreground">
                      editado
                    </span>
                  ) : null}
                </Label>
                <MoneyInput
                  value={valorCartao ?? 0}
                  onValueChange={(v) =>
                    setCartaoEditado(Math.abs(v - vitrine.cartao) > 0.004 && v > 0 ? v : null)
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Calculado: {brl(vitrine.cartao)}
                </p>
              </div>
              <div>
                <Label className="text-xs">
                  Pix
                  {pixEditado !== null ? (
                    <span className="ml-2 rounded-full bg-atencao px-2 py-0.5 text-[11px] font-medium text-atencao-foreground">
                      editado
                    </span>
                  ) : null}
                </Label>
                <MoneyInput
                  value={valorPix ?? 0}
                  onValueChange={(v) =>
                    setPixEditado(Math.abs(v - vitrine.pix) > 0.004 && v > 0 ? v : null)
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">Calculado: {brl(vitrine.pix)}</p>
              </div>
            </div>
            {(valorPix ?? 0) < totais.base - 0.004 ? (
              <p className="mt-2 rounded-md bg-atencao px-3 py-2 text-sm text-atencao-foreground">
                Pix abaixo do valor mínimo da tabela ({brl(totais.base)}).
              </p>
            ) : null}
          </div>
        ) : null}
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
                <MoneyInput
                  value={km}
                  onValueChange={(v) => {
                    setKm(v);
                    setMetodoKm(null);
                  }}
                />
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
