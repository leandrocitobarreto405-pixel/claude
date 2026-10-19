/**
 * Estado e salvamento da Nova OS em janela (só criar: inclusive vindo de lead, visita de
 * orçamento e orçamento). A edição (`?editar=`) continua no formulário antigo.
 */
import { modoDocumentosFn } from "@/lib/documentos.functions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfigOptions, useSalespeople, useTechnicians } from "@/lib/data";
import { buildFullAddress, onlyDigits } from "@/lib/format";
import { createWorkOrder, findCustomerByPhone, osNumberExists, suggestOsNumber } from "@/lib/os";
import { linkLeadToWorkOrder } from "@/lib/crm";
import { linkBudgetVisitToWorkOrder } from "@/lib/budget-visits";
import { linkQuoteToWorkOrder } from "@/lib/quotes";
import { generateOsDocument, getOsDocSettings } from "@/lib/os-docs.functions";
import { fetchDireto } from "@/lib/enderecos";
import { useSession } from "@/lib/session";
import {
  aplicarCotacao,
  aplicarLead,
  aplicarOrcamento,
  comNegociadoAtualizado,
  comissaoPrevista,
  diferencaDoNegociado,
  ehAmbienteDeTeste,
  estadoInicial,
  montarPayload,
  novaVisita,
  novoItem,
  regraSugerida,
  somaDasVisitas,
  totalDaOs,
  validar,
  validarPasso,
  vendedoraInicial,
  visitasParaCobranca,
  type ClienteCadastro,
  type DadosCotacao,
  type EstadoNovaOs,
  type ItemCotacao,
  type ItemForm,
  type Passo,
  type VisitForm,
} from "./estado";

export type OrigemDaJanela = { lead?: string; orcamento?: string; cotacao?: string };

export type OsCriada = { id: string; os_number: string; documento: string | null };

export function useNovaOs(opcoes: { aberta: boolean; origem: OrigemDaJanela }) {
  const { aberta, origem } = opcoes;
  const { lead: leadId, orcamento: orcamentoId, cotacao: cotacaoId } = origem;
  const { user } = useSession();
  const lerConfigDoc = useServerFn(getOsDocSettings);
  const gerarDoc = useServerFn(generateOsDocument);
  const lerModoDoc = useServerFn(modoDocumentosFn);
  const { data: motivosAjuste } = useConfigOptions("adjustment_reason");
  const { data: origens } = useConfigOptions("sales_origin");
  const { data: servicos } = useConfigOptions("service_type");
  const { data: estofados } = useConfigOptions("upholstery_type");
  const { data: vendedoras } = useSalespeople();
  const { data: tecnicos } = useTechnicians();

  const ambienteDeTeste = useMemo(
    () => ehAmbienteDeTeste(typeof window === "undefined" ? "" : window.location.hostname),
    [],
  );
  const [estado, setEstado] = useState<EstadoNovaOs>(() =>
    estadoInicial({ ehTeste: ambienteDeTeste }),
  );
  const [passo, setPasso] = useState<Passo>(0);
  const [osDuplicada, setOsDuplicada] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [carregandoOrigem, setCarregandoOrigem] = useState(false);
  const [prefillPronto, setPrefillPronto] = useState(false);
  const [vendedoraAplicada, setVendedoraAplicada] = useState(false);
  const [criada, setCriada] = useState<OsCriada | null>(null);
  const [gerandoDoc, setGerandoDoc] = useState(false);
  const [sessao, setSessao] = useState(0);

  const mudar = useCallback((patch: Partial<EstadoNovaOs>) => {
    setEstado((prev) => comNegociadoAtualizado({ ...prev, ...patch }));
  }, []);

  const reiniciar = useCallback(() => {
    setEstado(estadoInicial({ ehTeste: ambienteDeTeste }));
    setPasso(0);
    setOsDuplicada(false);
    setCriada(null);
    setPrefillPronto(false);
    setVendedoraAplicada(false);
    setSessao((n) => n + 1);
  }, [ambienteDeTeste]);

  // Ao abrir: estado limpo, número sugerido e dados de onde a OS vem.
  useEffect(() => {
    if (!aberta) return;
    reiniciar();
  }, [aberta, leadId, orcamentoId, cotacaoId, reiniciar]);

  useEffect(() => {
    if (!aberta) return;
    let ativo = true;
    suggestOsNumber()
      .then((n) => {
        if (ativo) setEstado((prev) => (prev.osNumber ? prev : { ...prev, osNumber: n }));
      })
      .catch(() => {
        if (ativo) toast.error("Não foi possível sugerir o número da OS. Informe-o manualmente.");
      });
    return () => {
      ativo = false;
    };
  }, [aberta, sessao]);

  useEffect(() => {
    if (!aberta) return;
    const lead = leadId;
    const orcamento = orcamentoId;
    const cotacao = cotacaoId;
    if (!lead && !orcamento && !cotacao) {
      setPrefillPronto(true);
      return;
    }
    let ativo = true;
    setCarregandoOrigem(true);
    (async () => {
      if (lead) {
        const { data, error } = await supabase
          .from("crm_leads")
          .select(
            `id, lead_name, phone, upholstery_description, summary, notes, salesperson_id, sales_origin_id,
             customer:customer_id ( id, full_name, phone, email, document_number, postal_code, street,
               street_number, complement, neighborhood, city, state, reference_point )`,
          )
          .eq("id", lead)
          .maybeSingle();
        if (error) throw error;
        if (!data || !ativo) return;
        setEstado((prev) =>
          aplicarLead(prev, { ...data, customer: data.customer as ClienteCadastro | null }),
        );
        toast.info("Dados do lead carregados. Confira antes de salvar.");
      }
      if (orcamento) {
        const { data, error } = await supabase
          .from("budget_visits")
          .select(
            `id, upholstery_description, notes, result_notes, sales_origin_id,
             technician_id, scheduled_date,
             customer:customers!budget_visits_customer_id_fkey ( id, full_name, phone, email, document_number,
               postal_code, street, street_number, complement, neighborhood, city, state, reference_point )`,
          )
          .eq("id", orcamento)
          .maybeSingle();
        if (error) throw error;
        if (!data || !ativo) return;
        setEstado((prev) =>
          aplicarOrcamento(prev, { ...data, customer: data.customer as ClienteCadastro | null }),
        );
        toast.info("Dados da visita de orçamento carregados. Confira antes de salvar.");
      }
      if (cotacao) {
        const { data, error } = await supabase
          .from("quotes")
          .select(
            "id, cliente_nome, cliente_telefone, cliente_cep, cliente_endereco, data_servico, observacoes, total",
          )
          .eq("id", cotacao)
          .maybeSingle();
        if (error) throw error;
        if (!data || !ativo) return;
        const { data: itens } = await supabase
          .from("quote_items")
          .select(
            "nome_snapshot, tipo_servico, preco_aplicado, quantidade, preco_tabela, preco_sugerido, editado_por, editado_em, adicional_pos_fechamento, categoria",
          )
          .eq("quote_id", cotacao)
          .order("display_order");
        if (!ativo) return;
        setEstado((prev) =>
          aplicarCotacao(
            prev,
            data as unknown as DadosCotacao,
            (itens ?? []) as unknown as ItemCotacao[],
          ),
        );
        toast.info("Dados do orçamento carregados. Confira antes de salvar.");
      }
    })()
      .catch(() => {
        if (ativo)
          toast.error("Não foi possível carregar os dados de origem. Confira o formulário.");
      })
      .finally(() => {
        if (ativo) {
          setCarregandoOrigem(false);
          setPrefillPronto(true);
        }
      });
    return () => {
      ativo = false;
    };
  }, [aberta, leadId, orcamentoId, cotacaoId, sessao]);

  // Vendedora: a do lead/orçamento (já no estado); senão a ligada ao login; senão vazio.
  useEffect(() => {
    if (!aberta || !prefillPronto || vendedoraAplicada || !vendedoras || !user) return;
    setVendedoraAplicada(true);
    setEstado((prev) => ({
      ...prev,
      vendedoraId: vendedoraInicial(prev.vendedoraId, vendedoras, user.id),
    }));
  }, [aberta, prefillPronto, vendedoraAplicada, vendedoras, user]);

  // ---------------------------------------------------------------- derivados
  const listaServicos = useMemo(() => servicos ?? [], [servicos]);
  const soma = somaDasVisitas(estado.visitas);
  const total = totalDaOs(estado);
  const diferenca = diferencaDoNegociado(estado);
  const comissaoPct = Number(
    vendedoras?.find((v) => v.id === estado.vendedoraId)?.commission_percentage ?? 0,
  );
  const comissao = comissaoPrevista(total, comissaoPct);
  const regraAutomatica = regraSugerida(estado, listaServicos);
  const visitasCobranca = visitasParaCobranca(estado, listaServicos);
  const enderecoCompleto = buildFullAddress({
    street: estado.rua,
    street_number: estado.numero,
    complement: estado.complemento,
    neighborhood: estado.bairro,
    city: estado.cidade,
    state: estado.uf,
    postal_code: estado.cep,
  });

  // ---------------------------------------------------------------- edição das visitas
  function mudarVisita(i: number, patch: Partial<VisitForm>) {
    setEstado((prev) =>
      comNegociadoAtualizado({
        ...prev,
        visitas: prev.visitas.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
      }),
    );
  }
  function mudarItem(i: number, j: number, patch: Partial<ItemForm>) {
    setEstado((prev) =>
      comNegociadoAtualizado({
        ...prev,
        visitas: prev.visitas.map((v, idx) =>
          idx === i
            ? { ...v, items: v.items.map((it, k) => (k === j ? { ...it, ...patch } : it)) }
            : v,
        ),
      }),
    );
  }
  function adicionarVisita() {
    setEstado((prev) => ({
      ...prev,
      visitas: [...prev.visitas, novaVisita(prev.visitas[prev.visitas.length - 1]?.technician_id)],
    }));
  }
  function removerVisita(i: number) {
    setEstado((prev) =>
      comNegociadoAtualizado({ ...prev, visitas: prev.visitas.filter((_, idx) => idx !== i) }),
    );
  }
  function adicionarItem(i: number) {
    setEstado((prev) => ({
      ...prev,
      visitas: prev.visitas.map((v, idx) =>
        idx === i ? { ...v, items: [...v.items, novoItem()] } : v,
      ),
    }));
  }
  function removerItem(i: number, j: number) {
    setEstado((prev) =>
      comNegociadoAtualizado({
        ...prev,
        visitas: prev.visitas.map((v, idx) =>
          idx === i ? { ...v, items: v.items.filter((_, k) => k !== j) } : v,
        ),
      }),
    );
  }
  function copiarItens(de: number, para: number) {
    setEstado((prev) => {
      const base = prev.visitas[de];
      if (!base) return prev;
      return comNegociadoAtualizado({
        ...prev,
        visitas: prev.visitas.map((v, idx) =>
          idx === para ? { ...v, items: base.items.map((it) => ({ ...it, id: null })) } : v,
        ),
      });
    });
    toast.success("Itens copiados. Ajuste os valores se necessário.");
  }

  // ---------------------------------------------------------------- buscas
  async function verificarOs(): Promise<boolean> {
    if (!estado.osNumber.trim()) {
      setOsDuplicada(false);
      return false;
    }
    try {
      const duplicada = await osNumberExists(estado.osNumber.trim());
      setOsDuplicada(duplicada);
      return duplicada;
    } catch {
      toast.error("Não foi possível verificar o número da OS agora.");
      return false;
    }
  }

  async function buscarCliente() {
    if (onlyDigits(estado.telefone).length < 10) {
      toast.error("Informe um telefone válido com DDD para buscar.");
      return;
    }
    try {
      const c = await findCustomerByPhone(estado.telefone);
      if (!c) {
        toast.info(
          "Nenhum cliente encontrado com este telefone. Preencha os dados para cadastrar.",
        );
        mudar({ clienteExistente: null });
        return;
      }
      mudar({
        clienteExistente: c.id,
        nome: c.full_name ?? "",
        email: c.email ?? "",
        documento: c.document_number ?? "",
        cep: c.postal_code ?? "",
        rua: c.street ?? "",
        numero: c.street_number ?? "",
        complemento: c.complement ?? "",
        bairro: c.neighborhood ?? "",
        cidade: c.city ?? "",
        uf: c.state ?? "",
        referencia: c.reference_point ?? "",
      });
      toast.success("Cliente encontrado! Dados preenchidos automaticamente.");
    } catch {
      toast.error(
        "Não foi possível buscar o cliente agora. Você pode preencher os dados manualmente.",
      );
    }
  }

  async function buscarCep() {
    const digits = onlyDigits(estado.cep);
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
      mudar({
        rua: json.logradouro ?? "",
        bairro: json.bairro ?? "",
        cidade: json.localidade ?? "",
        uf: json.uf ?? "",
      });
      toast.success("Endereço preenchido pelo CEP.");
    } catch {
      toast.error("Não foi possível consultar o CEP agora. Preencha manualmente.");
    }
  }

  // ---------------------------------------------------------------- passos
  function avancar(): boolean {
    const erro = validarPasso(estado, passo);
    if (erro) {
      toast.error(erro);
      return false;
    }
    setPasso((p) => (p < 2 ? ((p + 1) as Passo) : p));
    return true;
  }
  function voltar() {
    setPasso((p) => (p > 0 ? ((p - 1) as Passo) : p));
  }

  // ---------------------------------------------------------------- salvar
  async function gerarDocumento(workOrderId: string): Promise<string | null> {
    const r = await gerarDoc({ fetch: fetchDireto, data: { workOrderId, mode: "novo" } });
    return r.name ?? null;
  }

  async function salvar(): Promise<OsCriada | null> {
    const erro = validar(estado, osDuplicada);
    if (erro) {
      toast.error(erro);
      return null;
    }
    if (await verificarOs()) {
      toast.error("Este número de OS já existe. Use outro número.");
      return null;
    }
    const payload = montarPayload(estado, {
      userId: user?.id ?? null,
      agora: new Date().toISOString(),
      comissaoPct,
      servicos: listaServicos,
    });
    setSalvando(true);
    try {
      const wo = await createWorkOrder({ ...payload, userId: user?.id ?? null });
      toast.success(
        `OS ${wo.os_number} criada com ${estado.visitas.length} atendimento(s) agendado(s).`,
      );
      if (origem.lead) {
        try {
          await linkLeadToWorkOrder(origem.lead, wo.id);
        } catch {
          toast.error("A OS foi criada, mas não foi possível vincular o lead do CRM.");
        }
      }
      if (origem.orcamento) {
        try {
          await linkBudgetVisitToWorkOrder(origem.orcamento, wo.id);
        } catch {
          toast.error("A OS foi criada, mas não foi possível vinculá-la à visita de orçamento.");
        }
      }
      if (origem.cotacao) {
        try {
          await linkQuoteToWorkOrder(origem.cotacao, wo.id);
        } catch {
          toast.error("A OS foi criada, mas não foi possível vinculá-la ao orçamento.");
        }
      }
      let documento: string | null = null;
      try {
        const [settings, { modo }] = await Promise.all([lerConfigDoc(), lerModoDoc()]);
        // No modo "PDF direto no app" o documento não vai para o Drive.
        if (modo === "drive" && settings.enabled && settings.autoGenerate && settings.configured) {
          documento = await gerarDocumento(wo.id);
          if (documento) toast.success(`Documento ${documento} gerado no Google Docs.`);
        }
      } catch (e) {
        toast.error(
          `A OS foi salva, mas não foi possível gerar o documento. ${
            e instanceof Error ? e.message : ""
          }`.trim(),
        );
      }
      const r = { id: wo.id, os_number: wo.os_number, documento };
      setCriada(r);
      return r;
    } catch {
      toast.error("Não foi possível salvar a OS. Verifique os dados e tente novamente.");
      return null;
    } finally {
      setSalvando(false);
    }
  }

  /** Botão "Gerar documento" da tela de sucesso. */
  async function gerarDocumentoDaCriada() {
    if (!criada) return;
    setGerandoDoc(true);
    try {
      const settings = await lerConfigDoc();
      if (!settings.enabled || !settings.configured) {
        toast.error("Geração de documentos não está configurada em Configurações → Documentos.");
        return;
      }
      const nome = await gerarDocumento(criada.id);
      setCriada({ ...criada, documento: nome });
      toast.success(`Documento ${nome ?? ""} gerado no Google Docs.`.trim());
    } catch (e) {
      toast.error(
        `Não foi possível gerar o documento. ${e instanceof Error ? e.message : ""}`.trim(),
      );
    } finally {
      setGerandoDoc(false);
    }
  }

  return {
    estado,
    mudar,
    passo,
    setPasso,
    avancar,
    voltar,
    ambienteDeTeste,
    carregandoOrigem,
    listas: {
      origens: origens ?? [],
      servicos: listaServicos,
      estofados: estofados ?? [],
      vendedoras: vendedoras ?? [],
      tecnicos: tecnicos ?? [],
      motivosAjuste: motivosAjuste ?? [],
    },
    derivados: {
      soma,
      total,
      diferenca,
      comissaoPct,
      comissao,
      regraAutomatica,
      visitasCobranca,
      enderecoCompleto,
    },
    osDuplicada,
    setOsDuplicada,
    verificarOs,
    buscarCliente,
    buscarCep,
    mudarVisita,
    mudarItem,
    adicionarVisita,
    removerVisita,
    adicionarItem,
    removerItem,
    copiarItens,
    salvando,
    salvar,
    criada,
    gerandoDoc,
    gerarDocumentoDaCriada,
    reiniciar,
  };
}

export type NovaOs = ReturnType<typeof useNovaOs>;
