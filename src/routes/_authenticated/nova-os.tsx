import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type SelectHTMLAttributes } from "react";
import { toast } from "sonner";
import { Copy, PlusCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegerInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { PAYMENT_TYPES, useConfigOptions, useSalespeople, useTechnicians } from "@/lib/data";
import {
  brl,
  buildFullAddress,
  dateBR,
  onlyDigits,
  parseNumberBR,
  todayISO,
} from "@/lib/format";
import {
  createWorkOrder,
  findCustomerByPhone,
  osNumberExists,
  suggestOsNumber,
  updateWorkOrder,
  visitTotal,
} from "@/lib/os";
import { linkLeadToWorkOrder } from "@/lib/crm";
import { COLLECTION_RULES, collectionRuleLabel, defaultCollectionRule } from "@/lib/collection";
import { generateOsDocument, getOsDocSettings } from "@/lib/os-docs.functions";
import { useServerFn } from "@tanstack/react-start";
import { linkBudgetVisitToWorkOrder } from "@/lib/budget-visits";
import { linkQuoteToWorkOrder } from "@/lib/quotes";
import { useSession } from "@/lib/session";



export const Route = createFileRoute("/_authenticated/nova-os")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { editar?: string; lead?: string; orcamento?: string; cotacao?: string } => ({
    ...(typeof search["editar"] === "string" ? { editar: search["editar"] as string } : {}),
    ...(typeof search["lead"] === "string" ? { lead: search["lead"] as string } : {}),
    ...(typeof search["orcamento"] === "string" ? { orcamento: search["orcamento"] as string } : {}),
    ...(typeof search["cotacao"] === "string" ? { cotacao: search["cotacao"] as string } : {}),
  }),


  head: () => ({
    meta: [
      { title: "Nova OS — Gestão Estofados" },
      { name: "description", content: "Cadastre cliente, venda e agende os serviços da ordem de serviço." },
      { property: "og:title", content: "Nova OS — Gestão Estofados" },
      { property: "og:description", content: "Cadastre cliente, venda e agende os serviços da ordem de serviço." },
    ],
  }),
  component: NovaOS,
  errorComponent: NovaOSError,
});


function NativeSelect({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

function NovaOSError({ error, reset }: { error: Error; reset: () => void }) {
  console.error("Falha no formulário de Nova OS:", error);
  return (
    <div className="card-surface mx-auto max-w-lg p-6 text-center" role="alert">
      <h1 className="text-xl font-semibold">Não foi possível continuar o cadastro</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Seus dados não foram enviados. Tente reabrir o formulário.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Reabrir formulário</Button>
        <Button variant="outline" onClick={() => window.location.assign("/inicio")}>
          Voltar ao início
        </Button>
      </div>
    </div>
  );
}

type ItemForm = {
  id?: string | null;
  upholstery_type_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  item_group_id: string;
};

type VisitForm = {
  id?: string | null;
  service_type_id: string;
  scheduled_date: string;
  scheduled_time: string;
  technician_id: string;
  visit_notes: string;
  items: ItemForm[];
};

function novoId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function novoItem(groupId?: string): ItemForm {
  return {
    upholstery_type_id: "",
    description: "",
    quantity: "1",
    unit_price: "0,00",
    item_group_id: groupId ?? novoId(),
  };
}

function novaVisita(tecnicoId = ""): VisitForm {
  return {
    service_type_id: "",
    scheduled_date: todayISO(),
    scheduled_time: "09:00",
    technician_id: tecnicoId,
    visit_notes: "",
    items: [novoItem()],
  };
}

function subtotalItem(i: ItemForm) {
  return Math.max(0, Number(i.quantity) || 0) * Math.max(0, parseNumberBR(i.unit_price));
}

function totalVisita(v: VisitForm) {
  return Math.round(v.items.reduce((s, i) => s + subtotalItem(i), 0) * 100) / 100;
}



function NovaOS() {
  const navigate = useNavigate();
  const {
    editar,
    lead: leadIdParam,
    orcamento: orcamentoIdParam,
    cotacao: cotacaoIdParam,
  } = Route.useSearch();
  const { user } = useSession();
  const lerConfigDoc = useServerFn(getOsDocSettings);
  const gerarDoc = useServerFn(generateOsDocument);
  const { data: motivosAjuste } = useConfigOptions("adjustment_reason");


  const { data: origens } = useConfigOptions("sales_origin");
  const { data: servicos } = useConfigOptions("service_type");
  const { data: estofados } = useConfigOptions("upholstery_type");
  const { data: vendedoras } = useSalespeople();
  const { data: tecnicos } = useTechnicians();

  const [osNumber, setOsNumber] = useState("");
  const [osDuplicada, setOsDuplicada] = useState(false);
  const [saleDate, setSaleDate] = useState(todayISO());
  const [origemId, setOrigemId] = useState("");
  const [vendedoraId, setVendedoraId] = useState("");

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [documento, setDocumento] = useState("");
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [referencia, setReferencia] = useState("");
  const [clienteExistente, setClienteExistente] = useState<string | null>(null);

  const [visitas, setVisitas] = useState<VisitForm[]>([novaVisita()]);
  const [valorNegociado, setValorNegociado] = useState("0,00");
  const [negociadoEditado, setNegociadoEditado] = useState(false);
  const [motivoAjuste, setMotivoAjuste] = useState("");
  const [valorTexto, setValorTexto] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("Pix");
  const [parcelas, setParcelas] = useState(1);
  const [obsPagamento, setObsPagamento] = useState("");
  const [obsGerais, setObsGerais] = useState("");
  const [regraCobranca, setRegraCobranca] = useState("");
  const [visitaCobranca, setVisitaCobranca] = useState<number>(-1);
  const [instrucaoManual, setInstrucaoManual] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(Boolean(editar));
  const [osId, setOsId] = useState<string | null>(null);

  useEffect(() => {
    if (editar) return;
    let active = true;
    suggestOsNumber()
      .then((n) => {
        if (active) setOsNumber((prev) => prev || n);
      })
      .catch(() => {
        if (active) toast.error("Não foi possível sugerir o número da OS. Informe-o manualmente.");
      });
    return () => {
      active = false;
    };
  }, [editar]);

  useEffect(() => {
    if (!editar) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select(
          `id, os_number, sale_date, sales_origin_id, salesperson_id, total_gross_value, os_value_text,
           adjustment_reason, manual_total_reason, negotiated_payment_method, negotiated_installments,
           payment_notes, general_notes, customer_id,
           customer:customer_id ( * ),
           visits!visits_work_order_id_fkey ( id, service_type_id, scheduled_date, scheduled_time, technician_id, visit_notes, status,
             service_items ( id, upholstery_type_id, description, quantity, unit_price, item_group_id, display_order, active ) )`,
        )
        .eq("os_number", editar)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        toast.error("Não foi possível carregar a OS para edição.");
        setCarregando(false);
        return;
      }
      const wo = data as never as {
        id: string;
        os_number: string;
        sale_date: string;
        sales_origin_id: string | null;
        salesperson_id: string | null;
        total_gross_value: number;
        os_value_text: string | null;
        adjustment_reason: string | null;
        negotiated_payment_method: string | null;
        negotiated_installments: number | null;
        payment_notes: string | null;
        general_notes: string | null;
        collection_rule: string | null;
        collection_visit_id: string | null;
        payment_instruction: string | null;
        customer_id: string;
        customer: Record<string, string | null> | null;
        visits: Array<{
          id: string;
          service_type_id: string | null;
          scheduled_date: string;
          scheduled_time: string;
          technician_id: string | null;
          visit_notes: string | null;
          service_items: Array<{
            id: string;
            upholstery_type_id: string | null;
            description: string | null;
            quantity: number;
            unit_price: number;
            item_group_id: string;
            display_order: number;
            active: boolean;
          }>;

        }>;
      };
      setOsId(wo.id);
      setOsNumber(wo.os_number);
      setSaleDate(wo.sale_date);
      setOrigemId(wo.sales_origin_id ?? "");
      setVendedoraId(wo.salesperson_id ?? "");
      setValorNegociado(String(Number(wo.total_gross_value ?? 0).toFixed(2)).replace(".", ","));
      setNegociadoEditado(true);
      setMotivoAjuste(wo.adjustment_reason ?? "");
      setValorTexto(wo.os_value_text ?? "");
      setFormaPagamento(wo.negotiated_payment_method ?? "Pix");
      setParcelas(Number(wo.negotiated_installments ?? 1) || 1);
      setObsPagamento(wo.payment_notes ?? "");
      setObsGerais(wo.general_notes ?? "");
      setRegraCobranca(wo.collection_rule ?? "");
      setInstrucaoManual(wo.payment_instruction ?? "");
      setVisitaCobranca(
        wo.collection_visit_id
          ? (wo.visits ?? []).findIndex((v) => v.id === wo.collection_visit_id)
          : -1,
      );
      const c = wo.customer ?? {};
      setClienteExistente(wo.customer_id);
      setNome(c["full_name"] ?? "");
      setTelefone(c["phone"] ?? "");
      setEmail(c["email"] ?? "");
      setDocumento(c["document_number"] ?? "");
      setCep(c["postal_code"] ?? "");
      setRua(c["street"] ?? "");
      setNumero(c["street_number"] ?? "");
      setComplemento(c["complement"] ?? "");
      setBairro(c["neighborhood"] ?? "");
      setCidade(c["city"] ?? "");
      setUf(c["state"] ?? "");
      setReferencia(c["reference_point"] ?? "");
      setVisitas(
        (wo.visits ?? []).map((v) => ({
          id: v.id,
          service_type_id: v.service_type_id ?? "",
          scheduled_date: v.scheduled_date,
          scheduled_time: (v.scheduled_time ?? "09:00").slice(0, 5),
          technician_id: v.technician_id ?? "",
          visit_notes: v.visit_notes ?? "",
          items: (v.service_items ?? [])
            .filter((i) => i.active !== false)
            .sort((a, b) => a.display_order - b.display_order)
            .map((i) => ({
              id: i.id,
              upholstery_type_id: i.upholstery_type_id ?? "",
              description: i.description ?? "",
              quantity: String(i.quantity ?? 1),
              unit_price: Number(i.unit_price ?? 0).toFixed(2).replace(".", ","),
              item_group_id: i.item_group_id,
            })),
        })),
      );
      setCarregando(false);
    })().catch(() => {
      if (active) {
        toast.error("Não foi possível carregar a OS para edição.");
        setCarregando(false);
      }
    });
    return () => {
      active = false;
    };
  }, [editar]);

  // Pré-preenche a OS a partir de um lead do CRM WhatsApp.
  useEffect(() => {
    if (!leadIdParam || editar) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select(
          `id, lead_name, phone, upholstery_description, summary, notes, salesperson_id, sales_origin_id,
           customer:customer_id ( id, full_name, phone, email, document_number, postal_code, street,
             street_number, complement, neighborhood, city, state, reference_point )`,
        )
        .eq("id", leadIdParam)
        .maybeSingle();
      if (error || !data || !active) return;
      const cliente = data.customer as {
        id: string;
        full_name: string;
        phone: string;
        email: string | null;
        document_number: string | null;
        postal_code: string | null;
        street: string | null;
        street_number: string | null;
        complement: string | null;
        neighborhood: string | null;
        city: string | null;
        state: string | null;
        reference_point: string | null;
      } | null;

      setNome((prev) => prev || cliente?.full_name || data.lead_name || "");
      setTelefone((prev) => prev || onlyDigits(cliente?.phone ?? data.phone ?? ""));
      if (data.sales_origin_id) setOrigemId((prev) => prev || data.sales_origin_id!);
      if (data.salesperson_id) setVendedoraId((prev) => prev || data.salesperson_id!);
      if (cliente) {
        setClienteExistente(cliente.id);
        setEmail((prev) => prev || cliente.email || "");
        setDocumento((prev) => prev || cliente.document_number || "");
        setCep((prev) => prev || onlyDigits(cliente.postal_code ?? ""));
        setRua((prev) => prev || cliente.street || "");
        setNumero((prev) => prev || cliente.street_number || "");
        setComplemento((prev) => prev || cliente.complement || "");
        setBairro((prev) => prev || cliente.neighborhood || "");
        setCidade((prev) => prev || cliente.city || "");
        setUf((prev) => prev || cliente.state || "");
        setReferencia((prev) => prev || cliente.reference_point || "");
      }
      const resumo = [data.upholstery_description, data.summary].filter(Boolean).join(" — ");
      if (resumo) {
        setObsGerais((prev) => prev || `Origem: lead do WhatsApp. ${resumo}`.slice(0, 1000));
        setVisitas((prev) =>
          prev.map((v, idx) =>
            idx === 0
              ? {
                  ...v,
                  items: v.items.map((it, i) =>
                    i === 0 && !it.description
                      ? { ...it, description: (data.upholstery_description ?? "").slice(0, 200) }
                      : it,
                  ),
                }
              : v,
          ),
        );
      }
      toast.info("Dados do lead carregados. Confira antes de salvar.");
    })().catch(() => {
      if (active) toast.error("Não foi possível carregar os dados do lead.");
    });
    return () => {
      active = false;
    };
  }, [leadIdParam, editar]);

  // Pré-preenche a OS a partir de uma visita de orçamento aprovada.
  useEffect(() => {
    if (!orcamentoIdParam || editar) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("budget_visits")
        .select(
          `id, upholstery_description, notes, result_notes, sales_origin_id,
           technician_id, scheduled_date,
           customer:customers!budget_visits_customer_id_fkey ( id, full_name, phone, email, document_number,
             postal_code, street, street_number, complement, neighborhood, city, state, reference_point )`,
        )
        .eq("id", orcamentoIdParam)
        .maybeSingle();
      if (error || !data || !active) return;
      const cliente = data.customer as {
        id: string;
        full_name: string;
        phone: string;
        email: string | null;
        document_number: string | null;
        postal_code: string | null;
        street: string | null;
        street_number: string | null;
        complement: string | null;
        neighborhood: string | null;
        city: string | null;
        state: string | null;
        reference_point: string | null;
      } | null;

      if (data.sales_origin_id) setOrigemId((prev) => prev || data.sales_origin_id!);
      if (cliente) {
        setClienteExistente(cliente.id);
        setNome((prev) => prev || cliente.full_name);
        setTelefone((prev) => prev || onlyDigits(cliente.phone ?? ""));
        setEmail((prev) => prev || cliente.email || "");
        setDocumento((prev) => prev || cliente.document_number || "");
        setCep((prev) => prev || onlyDigits(cliente.postal_code ?? ""));
        setRua((prev) => prev || cliente.street || "");
        setNumero((prev) => prev || cliente.street_number || "");
        setComplemento((prev) => prev || cliente.complement || "");
        setBairro((prev) => prev || cliente.neighborhood || "");
        setCidade((prev) => prev || cliente.city || "");
        setUf((prev) => prev || cliente.state || "");
        setReferencia((prev) => prev || cliente.reference_point || "");
      }
      const resumo = [data.upholstery_description, data.result_notes, data.notes]
        .filter(Boolean)
        .join(" — ");
      if (resumo) {
        setObsGerais((prev) => prev || `Origem: visita de orçamento. ${resumo}`.slice(0, 1000));
      }
      if (data.upholstery_description) {
        setVisitas((prev) =>
          prev.map((v, idx) =>
            idx === 0
              ? {
                  ...v,
                  items: v.items.map((it, i) =>
                    i === 0 && !it.description
                      ? { ...it, description: (data.upholstery_description ?? "").slice(0, 200) }
                      : it,
                  ),
                }
              : v,
          ),
        );
      }
      if (data.technician_id) {
        setVisitas((prev) =>
          prev.map((v, idx) =>
            idx === 0 && !v.technician_id ? { ...v, technician_id: data.technician_id! } : v,
          ),
        );
      }
      toast.info("Dados da visita de orçamento carregados. Confira antes de salvar.");
    })().catch(() => {
      if (active) toast.error("Não foi possível carregar a visita de orçamento.");
    });
    return () => {
      active = false;
    };
  }, [orcamentoIdParam, editar]);

  // Preenche a OS a partir de um orçamento aprovado.
  useEffect(() => {
    if (!cotacaoIdParam || editar) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select(
          "id, cliente_nome, cliente_telefone, cliente_cep, cliente_endereco, data_servico, observacoes, total",
        )
        .eq("id", cotacaoIdParam)
        .maybeSingle();
      if (error || !data || !active) return;
      const q = data as unknown as {
        cliente_nome: string;
        cliente_telefone: string | null;
        cliente_cep: string | null;
        cliente_endereco: string | null;
        data_servico: string | null;
        observacoes: string | null;
        total: number;
      };

      const { data: itens } = await supabase
        .from("quote_items")
        .select("nome_snapshot, tipo_servico, preco_aplicado, quantidade")
        .eq("quote_id", cotacaoIdParam)
        .order("display_order");
      if (!active) return;

      setNome((prev) => prev || q.cliente_nome);
      setTelefone((prev) => prev || onlyDigits(q.cliente_telefone ?? ""));
      setCep((prev) => prev || onlyDigits(q.cliente_cep ?? ""));
      if (q.cliente_endereco) setRua((prev) => prev || q.cliente_endereco!);
      if (q.observacoes) setObsGerais((prev) => prev || q.observacoes!.slice(0, 1000));

      const linhas = (itens ?? []).map((raw) => {
        const it = raw as unknown as {
          nome_snapshot: string;
          tipo_servico: string;
          preco_aplicado: number;
          quantidade: number;
        };
        return {
          upholstery_type_id: "",
          description: `${it.nome_snapshot} — ${
            it.tipo_servico === "impermeabilizacao" ? "Impermeabilização" : "Higienização"
          }`.slice(0, 200),
          quantity: String(it.quantidade ?? 1),
          unit_price: Number(it.preco_aplicado ?? 0).toFixed(2).replace(".", ","),
          item_group_id: novoId(),
        };
      });

      if (linhas.length) {
        setVisitas((prev) =>
          prev.map((v, idx) =>
            idx === 0
              ? {
                  ...v,
                  scheduled_date: q.data_servico || v.scheduled_date,
                  items: linhas,
                }
              : v,
          ),
        );
      }
      toast.info("Dados do orçamento carregados. Confira antes de salvar.");
    })().catch(() => {
      if (active) toast.error("Não foi possível carregar o orçamento.");
    });
    return () => {
      active = false;
    };
  }, [cotacaoIdParam, editar]);



  const somaVisitas = useMemo(
    () => Math.round(visitas.reduce((s, v) => s + totalVisita(v), 0) * 100) / 100,
    [visitas],
  );

  useEffect(() => {
    if (!negociadoEditado) setValorNegociado(somaVisitas.toFixed(2).replace(".", ","));
  }, [somaVisitas, negociadoEditado]);

  const totalOS = parseNumberBR(valorNegociado);
  const diferenca = Math.round((totalOS - somaVisitas) * 100) / 100;
  const comissaoPct = Number(vendedoras?.find((v) => v.id === vendedoraId)?.commission_percentage ?? 0);
  const comissao = Math.round(((totalOS * comissaoPct) / 100) * 100) / 100;
  const visitasCobranca = visitas.map((v, idx) => ({
    id: String(idx),
    scheduled_date: v.scheduled_date,
    scheduled_time: v.scheduled_time,
    status: "Agendado",
    service_name: servicos?.find((s) => s.id === v.service_type_id)?.name ?? null,
    amount: visitTotal(
      v.items.map((it) => ({
        quantity: Math.max(1, Number(it.quantity) || 1),
        unit_price: parseNumberBR(it.unit_price),
      })),
    ),
  }));
  const regraSugerida = defaultCollectionRule(visitasCobranca);


  const enderecoCompleto = buildFullAddress({
    street: rua,
    street_number: numero,
    complement: complemento,
    neighborhood: bairro,
    city: cidade,
    state: uf,
    postal_code: cep,
  });

  async function verificarOs() {
    if (!osNumber.trim()) {
      setOsDuplicada(false);
      return false;
    }
    try {
      const duplicada = await osNumberExists(osNumber.trim());
      setOsDuplicada(duplicada);
      return duplicada;
    } catch {
      toast.error("Não foi possível verificar o número da OS agora.");
      return false;
    }
  }

  async function buscarCliente() {
    const digits = onlyDigits(telefone);
    if (digits.length < 10) {
      toast.error("Informe um telefone válido com DDD para buscar.");
      return;
    }
    try {
      const cliente = await findCustomerByPhone(telefone);
      if (!cliente) {
        toast.info("Nenhum cliente encontrado com este telefone. Preencha os dados para cadastrar.");
        setClienteExistente(null);
        return;
      }
      setClienteExistente(cliente.id);
      setNome(cliente.full_name ?? "");
      setEmail(cliente.email ?? "");
      setDocumento(cliente.document_number ?? "");
      setCep(cliente.postal_code ?? "");
      setRua(cliente.street ?? "");
      setNumero(cliente.street_number ?? "");
      setComplemento(cliente.complement ?? "");
      setBairro(cliente.neighborhood ?? "");
      setCidade(cliente.city ?? "");
      setUf(cliente.state ?? "");
      setReferencia(cliente.reference_point ?? "");
      toast.success("Cliente encontrado! Dados preenchidos automaticamente.");
    } catch {
      toast.error("Não foi possível buscar o cliente agora. Você pode preencher os dados manualmente.");
    }
  }

  async function buscarCep() {
    const digits = onlyDigits(cep);
    if (digits.length !== 8) {
      toast.error("Informe um CEP com 8 dígitos.");
      return;
    }
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const json = (await res.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (json.erro) {
        toast.error("CEP não encontrado. Preencha o endereço manualmente.");
        return;
      }
      setRua(json.logradouro ?? "");
      setBairro(json.bairro ?? "");
      setCidade(json.localidade ?? "");
      setUf(json.uf ?? "");
      toast.success("Endereço preenchido pelo CEP.");
    } catch {
      toast.error("Não foi possível consultar o CEP agora. Preencha manualmente.");
    }
  }

  function atualizarVisita(i: number, patch: Partial<VisitForm>) {
    setVisitas((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }

  function adicionarItem(i: number) {
    setVisitas((prev) =>
      prev.map((v, idx) => (idx === i ? { ...v, items: [...v.items, novoItem()] } : v)),
    );
  }

  function removerItem(i: number, j: number) {
    setVisitas((prev) =>
      prev.map((v, idx) =>
        idx === i ? { ...v, items: v.items.filter((_, k) => k !== j) } : v,
      ),
    );
  }

  function atualizarItem(i: number, j: number, patch: Partial<ItemForm>) {
    setVisitas((prev) =>
      prev.map((v, idx) =>
        idx === i
          ? { ...v, items: v.items.map((it, k) => (k === j ? { ...it, ...patch } : it)) }
          : v,
      ),
    );
  }

  function copiarItens(origem: number, destino: number) {
    setVisitas((prev) => {
      const base = prev[origem];
      if (!base) return prev;
      return prev.map((v, idx) =>
        idx === destino
          ? {
              ...v,
              items: base.items.map((it) => ({ ...it, id: null })),
            }
          : v,
      );
    });
    toast.success("Itens copiados. Ajuste os valores se necessário.");
  }


  async function salvar(): Promise<void> {
    if (!osNumber.trim()) { toast.error("Informe o número da OS."); return; }
    if (!editar && (osDuplicada || (await verificarOs()))) {
      toast.error("Este número de OS já existe. Use outro número.");
      return;
    }
    if (!origemId) { toast.error("Selecione a origem da venda."); return; }
    if (!vendedoraId) { toast.error("Selecione a vendedora responsável."); return; }
    if (nome.trim().length < 3) { toast.error("Informe o nome completo do cliente."); return; }
    if (onlyDigits(telefone).length < 10) { toast.error("Informe um telefone válido com DDD."); return; }
    if (!rua.trim() || !numero.trim() || !bairro.trim() || !cidade.trim() || !uf.trim())
      { toast.error("Preencha o endereço completo do cliente."); return; }
    if (!visitas.length) { toast.error("Adicione pelo menos um serviço."); return; }

    for (const [i, v] of visitas.entries()) {
      if (!v.service_type_id) { toast.error(`Selecione o serviço do atendimento ${i + 1}.`); return; }
      if (!v.scheduled_date || !v.scheduled_time)
        { toast.error(`Informe data e horário do atendimento ${i + 1}.`); return; }
      if (!v.items.length) { toast.error(`Adicione pelo menos um item no atendimento ${i + 1}.`); return; }
      for (const [j, it] of v.items.entries()) {
        if (!it.upholstery_type_id && !it.description.trim())
          { toast.error(`Informe o item ${j + 1} do atendimento ${i + 1}.`); return; }
        if ((Number(it.quantity) || 0) < 1)
          { toast.error(`Quantidade inválida no item ${j + 1} do atendimento ${i + 1}.`); return; }
        if (parseNumberBR(it.unit_price) <= 0)
          { toast.error(`Informe o valor unitário do item ${j + 1} do atendimento ${i + 1}.`); return; }
      }
    }
    if (Math.abs(diferenca) >= 0.01 && motivoAjuste.trim().length < 3)
      { toast.error("Informe o motivo do ajuste comercial (valor negociado diferente da soma dos itens)."); return; }
    if (totalOS <= 0) { toast.error("O valor negociado da OS deve ser maior que zero."); return; }

    const customer = {
      full_name: nome.trim(),
      phone: telefone.trim(),
      email: email.trim() || null,
      document_number: documento.trim() || null,
      postal_code: cep.trim() || null,
      street: rua.trim(),
      street_number: numero.trim(),
      complement: complemento.trim() || null,
      neighborhood: bairro.trim(),
      city: cidade.trim(),
      state: uf.trim().toUpperCase(),
      reference_point: referencia.trim() || null,
    };
    const order = {
      os_number: osNumber.trim(),
      sale_date: saleDate,
      sales_origin_id: origemId,
      salesperson_id: vendedoraId,
      total_gross_value: totalOS,
      os_value_text: valorTexto.trim() || null,
      adjustment_reason: Math.abs(diferenca) >= 0.01 ? motivoAjuste.trim() : null,
      manual_total_reason: Math.abs(diferenca) >= 0.01 ? motivoAjuste.trim() : null,
      negotiated_payment_method: formaPagamento,
      negotiated_installments: parcelas,
      general_notes: obsGerais.trim() || null,
      payment_notes: obsPagamento.trim() || null,
      collection_rule: regraCobranca || regraSugerida,
      collection_visit_index:
        (regraCobranca || regraSugerida) === "specific_visit" ? visitaCobranca : null,
      payment_instruction: instrucaoManual.trim() || null,
    };
    const visits = visitas.map((v) => ({
      id: v.id ?? null,
      service_type_id: v.service_type_id,
      scheduled_date: v.scheduled_date,
      scheduled_time: v.scheduled_time,
      technician_id: v.technician_id || null,
      visit_notes: v.visit_notes.trim() || null,
      items: v.items.map((it, idx) => ({
        id: it.id ?? null,
        upholstery_type_id: it.upholstery_type_id || null,
        description: it.description.trim() || null,
        quantity: Math.max(1, Number(it.quantity) || 1),
        unit_price: parseNumberBR(it.unit_price),
        item_group_id: it.item_group_id,
        display_order: idx,
      })),
    }));

    setSalvando(true);
    try {
      let numeroOS = osNumber.trim();
      let workOrderId = osId;

      if (editar && osId) {
        await updateWorkOrder({
          workOrderId: osId,
          customer,
          customerId: clienteExistente!,
          order,
          visits,
          commissionPercentage: comissaoPct,
          userId: user?.id ?? null,
        });
        toast.success(`OS ${numeroOS} atualizada.`);
      } else {
        const wo = await createWorkOrder({
          customer,
          customerId: clienteExistente,
          order,
          visits,
          commissionPercentage: comissaoPct,
          userId: user?.id ?? null,
        });
        numeroOS = wo.os_number;
        workOrderId = wo.id;
        toast.success(`OS ${wo.os_number} criada com ${visitas.length} atendimento(s) agendado(s).`);

        if (leadIdParam) {
          try {
            await linkLeadToWorkOrder(leadIdParam, wo.id);
          } catch {
            toast.error("A OS foi criada, mas não foi possível vincular o lead do CRM.");
          }
        }

        if (orcamentoIdParam) {
          try {
            await linkBudgetVisitToWorkOrder(orcamentoIdParam, wo.id);
          } catch {
            toast.error("A OS foi criada, mas não foi possível vinculá-la à visita de orçamento.");
          }
        }

        if (cotacaoIdParam) {
          try {
            await linkQuoteToWorkOrder(cotacaoIdParam, wo.id);
          } catch {
            toast.error("A OS foi criada, mas não foi possível vinculá-la ao orçamento.");
          }
        }
      }


      try {
        const settings = await lerConfigDoc();
        if (settings.enabled && settings.autoGenerate && settings.configured && workOrderId) {
          const r = await gerarDoc({
            data: { workOrderId, mode: editar ? "atualizar" : "novo" },
          });
          toast.success(`Documento ${r.name} gerado no Google Docs.`);
        }
      } catch (e) {
        toast.error(
          `A OS foi salva, mas não foi possível gerar o documento. ${
            e instanceof Error ? e.message : ""
          }`.trim(),
        );
      }

      navigate({ to: "/os/$osNumber", params: { osNumber: numeroOS } });
    } catch {
      toast.error("Não foi possível salvar a OS. Verifique os dados e tente novamente.");
    } finally {
      setSalvando(false);
    }
  }


  return (
    <>
      <PageHeader
        title="Nova ordem de serviço"
        description="Cadastre a venda, o cliente e agende os serviços."
      />

      <div className="space-y-6">
        <section className="card-surface p-5">
          <h2 className="mb-4 text-lg font-semibold">1. Dados da venda</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="os">Número da OS</Label>
              <Input
                id="os"
                value={osNumber}
                onChange={(e) => {
                  setOsNumber(e.target.value);
                  setOsDuplicada(false);
                }}
                onBlur={() => void verificarOs()}
              />
              {osDuplicada ? (
                <p className="text-sm text-destructive">Este número de OS já está em uso.</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="data-venda">Data da venda</Label>
              <Input
                id="data-venda"
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="origem-venda">Origem da venda</Label>
              <NativeSelect id="origem-venda" value={origemId} onChange={(e) => setOrigemId(e.target.value)}>
                <option value="">Selecione</option>
                {(origens ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendedora">Vendedora responsável</Label>
              <NativeSelect id="vendedora" value={vendedoraId} onChange={(e) => setVendedoraId(e.target.value)}>
                <option value="">Selecione</option>
                {(vendedoras ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({Number(v.commission_percentage).toFixed(0)}%)
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </section>

        <section className="card-surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">2. Cliente</h2>
            <Button variant="outline" size="sm" onClick={buscarCliente}>
              Buscar cliente pelo telefone
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone com DDD</Label>
              <Input
                id="telefone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="nome">Nome completo</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail (opcional)</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="documento">CPF ou CNPJ (opcional)</Label>
              <Input id="documento" value={documento} onChange={(e) => setDocumento(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cep">CEP</Label>
              <div className="flex gap-2">
                <Input id="cep" value={cep} onChange={(e) => setCep(e.target.value)} />
                <Button variant="outline" onClick={buscarCep}>
                  Buscar
                </Button>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rua">Rua</Label>
              <Input id="rua" value={rua} onChange={(e) => setRua(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="numero">Número</Label>
              <Input id="numero" value={numero} onChange={(e) => setNumero(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="complemento">Complemento</Label>
              <Input
                id="complemento"
                value={complemento}
                onChange={(e) => setComplemento(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bairro">Bairro</Label>
              <Input id="bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cidade">Cidade</Label>
              <Input id="cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uf">Estado (UF)</Label>
              <Input id="uf" maxLength={2} value={uf} onChange={(e) => setUf(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="referencia">Ponto de referência</Label>
              <Input
                id="referencia"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
            </div>
          </div>
          {enderecoCompleto ? (
            <p className="mt-3 text-sm text-muted-foreground">Endereço completo: {enderecoCompleto}</p>
          ) : null}
        </section>

        <section className="card-surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">3. Serviços e agendamentos</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisitas((prev) => [...prev, novaVisita(prev[prev.length - 1]?.technician_id)])}
            >
              <PlusCircle className="mr-2 size-4" /> Adicionar serviço
            </Button>
          </div>

          <div className="space-y-4">
            {visitas.map((v, i) => (
              <div key={v.id ?? i} className="rounded-lg border border-border p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Atendimento {i + 1}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Subtotal: <strong>{brl(totalVisita(v))}</strong>
                    </span>
                    {visitas.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setVisitas((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="mr-2 size-4" /> Remover
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor={`servico-${i}`}>Tipo de serviço</Label>
                    <NativeSelect
                      id={`servico-${i}`}
                      value={v.service_type_id}
                      onChange={(e) => atualizarVisita(i, { service_type_id: e.target.value })}
                    >
                      <option value="">Selecione</option>
                      {(servicos ?? []).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <Label>Data do atendimento</Label>
                    <Input
                      type="date"
                      value={v.scheduled_date}
                      onChange={(e) => atualizarVisita(i, { scheduled_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Horário</Label>
                    <Input
                      type="time"
                      value={v.scheduled_time}
                      onChange={(e) => atualizarVisita(i, { scheduled_time: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`tecnico-${i}`}>Técnico responsável</Label>
                    <NativeSelect
                      id={`tecnico-${i}`}
                      value={v.technician_id}
                      onChange={(e) => atualizarVisita(i, { technician_id: e.target.value })}
                    >
                      <option value="">Selecione</option>
                      {(tecnicos ?? []).map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-2 sm:col-span-2 xl:col-span-4">
                    <Label>Observações do atendimento</Label>
                    <Input
                      value={v.visit_notes}
                      onChange={(e) => atualizarVisita(i, { visit_notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="mt-4 rounded-lg bg-secondary/60 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">Itens (estofados) deste atendimento</p>
                    <div className="flex flex-wrap gap-2">
                      {visitas.length > 1 ? (
                        <NativeSelect
                          className="h-8 w-auto"
                          value=""
                          onChange={(e) => {
                            const origem = Number(e.target.value);
                            if (Number.isNaN(origem)) return;
                            copiarItens(origem, i);
                            e.target.value = "";
                          }}
                        >
                          <option value="">Copiar itens de...</option>
                          {visitas.map((_, idx) =>
                            idx === i ? null : (
                              <option key={idx} value={idx}>Atendimento {idx + 1}</option>
                            ),
                          )}
                        </NativeSelect>
                      ) : null}
                      <Button variant="outline" size="sm" onClick={() => adicionarItem(i)}>
                        <PlusCircle className="mr-2 size-4" /> Adicionar item
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {v.items.map((it, j) => (
                      <div
                        key={it.id ?? `${it.item_group_id}-${j}`}
                        className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-2 xl:grid-cols-5"
                      >
                        <div className="space-y-2">
                          <Label>Tipo de estofado</Label>
                          <NativeSelect
                            value={it.upholstery_type_id}
                            onChange={(e) => atualizarItem(i, j, { upholstery_type_id: e.target.value })}
                          >
                            <option value="">Selecione</option>
                            {(estofados ?? []).map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </NativeSelect>
                        </div>
                        <div className="space-y-2">
                          <Label>Descrição do item</Label>
                          <Input
                            value={it.description}
                            onChange={(e) => atualizarItem(i, j, { description: e.target.value })}
                            placeholder="Ex.: sofá 3 lugares retrátil"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Quantidade</Label>
                          <Input
                            inputMode="numeric"
                            value={it.quantity}
                            onChange={(e) =>
                              atualizarItem(i, j, {
                                quantity: e.target.value.replace(/[^\d]/g, ""),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Valor unitário</Label>
                          <Input
                            inputMode="decimal"
                            value={it.unit_price}
                            onChange={(e) => atualizarItem(i, j, { unit_price: e.target.value })}
                          />
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <div>
                            <Label className="block">Subtotal</Label>
                            <p className="mt-2 text-sm font-semibold">{brl(subtotalItem(it))}</p>
                          </div>
                          {v.items.length > 1 ? (
                            <Button variant="ghost" size="sm" onClick={() => removerItem(i, j)}>
                              <Trash2 className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Copy className="size-3" /> Ao copiar itens, os mesmos estofados são vinculados entre os
                    atendimentos (usado no modelo combinado do Google Docs).
                  </p>
                </div>
              </div>
            ))}
          </div>

        </section>

        <section className="card-surface p-5">
          <h2 className="mb-4 text-lg font-semibold">4. Valores e pagamento combinado</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label>Soma dos itens</Label>
              <p className="text-lg font-semibold">{brl(somaVisitas)}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="total">Valor negociado da OS</Label>
              <Input
                id="total"
                value={valorNegociado}
                onChange={(e) => {
                  setNegociadoEditado(true);
                  setValorNegociado(e.target.value);
                }}
              />
              {Math.abs(diferenca) >= 0.01 ? (
                <p className="text-xs text-muted-foreground">
                  Diferença em relação aos itens: {brl(diferenca)}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="motivo-ajuste">Motivo do ajuste comercial</Label>
              <NativeSelect
                id="motivo-ajuste"
                value={motivosAjuste?.some((m) => m.name === motivoAjuste) ? motivoAjuste : ""}
                onChange={(e) => setMotivoAjuste(e.target.value)}
              >
                <option value="">Selecione ou escreva abaixo</option>
                {(motivosAjuste ?? []).map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </NativeSelect>
              <Input
                value={motivoAjuste}
                onChange={(e) => setMotivoAjuste(e.target.value)}
                placeholder="Ex.: desconto de pacote"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="valor-texto">Resumo do valor para o documento (opcional)</Label>
              <Input
                id="valor-texto"
                value={valorTexto}
                onChange={(e) => setValorTexto(e.target.value)}
                placeholder="Ex.: R$ 1.200,00 em 3x no cartão"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="forma-pagamento">Forma de pagamento combinada</Label>
              <NativeSelect
                id="forma-pagamento"
                value={formaPagamento}
                onChange={(e) => setFormaPagamento(e.target.value)}
              >
                {PAYMENT_TYPES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="parcelas">Parcelas combinadas</Label>
              <IntegerInput
                id="parcelas"
                min={1}
                max={12}
                value={parcelas}
                onValueChange={(v) => setParcelas(Math.max(1, v))}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="obs-pag">Observações do pagamento</Label>
              <Input id="obs-pag" value={obsPagamento} onChange={(e) => setObsPagamento(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2 xl:col-span-3">
              <Label htmlFor="regra-cobranca">Momento da cobrança</Label>
              <NativeSelect
                id="regra-cobranca"
                value={regraCobranca}
                onChange={(e) => setRegraCobranca(e.target.value)}
              >
                <option value="">
                  Automático — {collectionRuleLabel(regraSugerida)}
                </option>
                {COLLECTION_RULES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                Define a instrução de pagamento enviada ao técnico no WhatsApp.
              </p>
            </div>
            {(regraCobranca || regraSugerida) === "specific_visit" ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="visita-cobranca">Atendimento em que o técnico deve cobrar</Label>
                <NativeSelect
                  id="visita-cobranca"
                  value={String(visitaCobranca)}
                  onChange={(e) => setVisitaCobranca(Number(e.target.value))}
                >
                  <option value="-1">Selecione o atendimento</option>
                  {visitasCobranca.map((v, idx) => (
                    <option key={idx} value={idx}>
                      {v.service_name || `Atendimento ${idx + 1}`} — {dateBR(v.scheduled_date)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            <div className="space-y-2 sm:col-span-2 xl:col-span-3">
              <Label htmlFor="instrucao-pagamento">
                Instrução de pagamento personalizada (opcional)
              </Label>
              <Input
                id="instrucao-pagamento"
                value={instrucaoManual}
                onChange={(e) => setInstrucaoManual(e.target.value)}
                placeholder="Deixe em branco para gerar automaticamente"
              />
            </div>
            <div className="space-y-2 sm:col-span-2 xl:col-span-3">
              <Label htmlFor="obs-gerais">Observações gerais da OS</Label>
              <Textarea id="obs-gerais" value={obsGerais} onChange={(e) => setObsGerais(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-secondary p-4">
            <p className="text-sm">
              Total da OS: <strong>{brl(totalOS)}</strong> · Comissão prevista ({comissaoPct}%):{" "}
              <strong>{brl(comissao)}</strong>
            </p>
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="lg" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar OS e agendar serviços"}
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
