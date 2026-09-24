import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Ban,
  ExternalLink,
  FileText,
  FolderOpen,
  ImagePlus,
  Link2,
  MessageCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/app-shell";
import { PaymentDialog } from "@/components/payment-dialog";
import type { PaymentFull } from "@/lib/payments";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinanceQueries } from "@/lib/cache";
import { effectiveVisitValue } from "@/lib/visit-value";
import { clearVisitDiscount } from "@/lib/discounts";
import { brl, dateBR, dateTimeBR, timeBR, whatsappLink } from "@/lib/format";
import { generateOsDocument, generateOsWarranty, getOsDocument, getOsWarranty } from "@/lib/os-docs.functions";
import {
  createCustomerFolderLink,
  getOsMedia,
  getOsMediaOptions,
  uploadOsMedia,
} from "@/lib/os-media.functions";
import { cancelWorkOrder, restoreWorkOrder, softDeleteWorkOrder } from "@/lib/os";
import { COLLECTION_RULES, collectionRuleLabel, defaultCollectionRule } from "@/lib/collection";

import { useSession } from "@/lib/session";
import { useConsumoDaOs, useControleInsumos } from "@/lib/produtos";

type MediaDestination = "Antes" | "Depois" | "Vídeos" | "Controle interno";

export const Route = createFileRoute("/_authenticated/os/$osNumber")({
  head: () => ({
    meta: [
      { title: "Detalhe da OS — Turbine Clean" },
      { name: "description", content: "Dados da ordem de serviço, itens e documento no Google Docs." },
      { property: "og:title", content: "Detalhe da OS — Turbine Clean" },
      { property: "og:description", content: "Dados da ordem de serviço, itens e documento no Google Docs." },
    ],
  }),
  component: OsDetalhe,
  errorComponent: () => (
    <div className="card-surface p-6 text-center">
      <p className="font-medium">Não foi possível abrir esta OS.</p>
      <Link to="/oss" className="text-sm text-primary underline">
        Voltar para OSs criadas
      </Link>
    </div>
  ),
});

const SELECT = `
  id, os_number, sale_date, status, total_gross_value, items_sum, os_value_text,
  negotiated_payment_method, negotiated_installments, payment_notes, adjustment_reason,
  collection_rule, collection_visit_id, payment_instruction, commission_realized,
  general_notes, cancelled_at, cancellation_reason, deleted_at, deletion_reason,
  customer:customer_id ( id, full_name, phone, full_address ),
  salesperson:salesperson_id ( name ),
  visits!visits_work_order_id_fkey ( id, status, scheduled_date, scheduled_time, visit_value, final_value, item_quantity, mileage_cost_allocated,
    discount_amount, discount_reason, discount_notes,
    upholstery_description, visit_notes, reschedule_type, rescheduled_from_visit_id,
    rescheduled_to_visit_id, original_scheduled_date, reschedule_reason,
    service_type:service_type_id ( name ), upholstery_type:upholstery_type_id ( name ),
    technician:technician_id ( name ),
    service_items ( id, description, quantity, unit_price, subtotal, display_order, active,
      upholstery_type:upholstery_type_id ( name ) ) ),
  payments ( id, work_order_id, visit_id, payment_date, payment_channel, payment_type, installments,
    gross_amount, applied_rate, payment_fee_amount, net_amount, payment_status, notes, is_active,
    reopened_at, reopen_reason )
`;

type Item = {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  display_order: number;
  active: boolean;
  upholstery_type: { name: string } | null;
};

type Visit = {
  id: string;
  mileage_cost_allocated: number | null;
  status: string;
  scheduled_date: string;
  scheduled_time: string;
  visit_value: number;
  final_value: number | null;
  item_quantity: number | null;
  discount_amount: number | null;
  discount_reason: string | null;
  discount_notes: string | null;
  upholstery_description: string | null;
  visit_notes: string | null;
  reschedule_type: string | null;
  rescheduled_from_visit_id: string | null;
  rescheduled_to_visit_id: string | null;
  original_scheduled_date: string | null;
  reschedule_reason: string | null;
  service_type: { name: string } | null;
  upholstery_type: { name: string } | null;
  technician: { name: string } | null;
  service_items: Item[];
};

type Os = {
  id: string;
  os_number: string;
  sale_date: string;
  status: string;
  total_gross_value: number;
  items_sum: number | null;
  os_value_text: string | null;
  negotiated_payment_method: string | null;
  negotiated_installments: number | null;
  payment_notes: string | null;
  adjustment_reason: string | null;
  collection_rule: string | null;
  collection_visit_id: string | null;
  payment_instruction: string | null;
  commission_realized: number | null;

  general_notes: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  deleted_at: string | null;
  deletion_reason: string | null;
  customer: { id: string; full_name: string; phone: string | null; full_address: string | null } | null;
  salesperson: { name: string } | null;
  visits: Visit[];
  payments: PaymentFull[];
};

function OsDetalhe() {
  const queryClient = useQueryClient();
  const [desfazendoDesconto, setDesfazendoDesconto] = useState<string | null>(null);
  const [dialogoPagamento, setDialogoPagamento] = useState<
    { payment: PaymentFull | null; mode: "registrar" | "reabrir" | "criar" } | null
  >(null);
  const { osNumber } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const userId = user?.id ?? null;

  const [gerando, setGerando] = useState(false);
  const [gerandoTermo, setGerandoTermo] = useState(false);
  const [regra, setRegra] = useState<string | null>(null);
  const [visitaCobranca, setVisitaCobranca] = useState<string | null>(null);
  const [salvandoCobranca, setSalvandoCobranca] = useState(false);
  const [motivoCancelar, setMotivoCancelar] = useState("");
  const [motivoExcluir, setMotivoExcluir] = useState("");
  const [acaoAberta, setAcaoAberta] = useState<"cancelar" | "excluir" | null>(null);
  const [destinoMidia, setDestinoMidia] = useState<MediaDestination>("Antes");
  const [arquivosMidia, setArquivosMidia] = useState<File[]>([]);
  const [avisosVideo, setAvisosVideo] = useState<string[]>([]);
  const [enviandoMidia, setEnviandoMidia] = useState(false);
  const [copiandoPasta, setCopiandoPasta] = useState(false);
  const inputMidiaRef = useRef<HTMLInputElement>(null);
  const gerar = useServerFn(generateOsDocument);
  const buscarDoc = useServerFn(getOsDocument);
  const buscarTermo = useServerFn(getOsWarranty);
  const gerarTermoFn = useServerFn(generateOsWarranty);
  const buscarMidias = useServerFn(getOsMedia);
  const enviarMidia = useServerFn(uploadOsMedia);
  const criarLinkPasta = useServerFn(createCustomerFolderLink);
  const buscarOpcoesMidia = useServerFn(getOsMediaOptions);

  const osQuery = useQuery({
    queryKey: ["os_detalhe", osNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select(SELECT)
        .eq("os_number", osNumber)
        .single();
      if (error) throw error;
      return data as unknown as Os;
    },
  });

  const os = osQuery.data;
  const workOrderId = os?.id ?? null;

  const docQuery = useQuery({
    queryKey: ["os_documento", workOrderId],
    enabled: Boolean(workOrderId),
    queryFn: () => buscarDoc({ data: { workOrderId: workOrderId! } }),
  });

  const garantiaQuery = useQuery({
    queryKey: ["os_termo_garantia", workOrderId],
    enabled: Boolean(workOrderId),
    queryFn: () => buscarTermo({ data: { workOrderId: workOrderId! } }),
  });
  const garantia = garantiaQuery.data ?? null;

  const midiasQuery = useQuery({
    queryKey: ["os_midias", workOrderId],
    enabled: Boolean(workOrderId),
    queryFn: () => buscarMidias({ data: { workOrderId: workOrderId ?? "" } }),
  });

  /** Destinos válidos conforme os serviços da OS. */
  const opcoesMidia = useQuery({
    queryKey: ["os_midia_opcoes", workOrderId],
    enabled: Boolean(workOrderId),
    queryFn: () => buscarOpcoesMidia({ data: { workOrderId: workOrderId ?? "" } }),
  });
  const destinosMidia = (opcoesMidia.data?.destinations ?? [
    "Antes",
    "Depois",
    "Vídeos",
    "Controle interno",
  ]) as MediaDestination[];

  useEffect(() => {
    if (destinosMidia.length && !destinosMidia.includes(destinoMidia)) {
      setDestinoMidia(destinosMidia[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opcoesMidia.data]);

  async function selecionarMidias(files: FileList | null) {
    const selected = Array.from(files ?? []);
    setArquivosMidia(selected);
    const longVideos: string[] = [];
    await Promise.all(
      selected.filter((file) => file.type.startsWith("video/")).map(
        (file) =>
          new Promise<void>((resolve) => {
            const video = document.createElement("video");
            const url = URL.createObjectURL(file);
            video.preload = "metadata";
            video.onloadedmetadata = () => {
              if (video.duration > 60) longVideos.push(file.name);
              URL.revokeObjectURL(url);
              resolve();
            };
            video.onerror = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            video.src = url;
          }),
      ),
    );
    setAvisosVideo(longVideos);
  }

  async function enviarArquivos() {
    if (!workOrderId || arquivosMidia.length === 0) return;
    setEnviandoMidia(true);
    let enviados = 0;
    try {
      for (const file of arquivosMidia) {
        const form = new FormData();
        form.set("workOrderId", workOrderId);
        form.set("destination", destinoMidia);
        form.set("file", file);
        await enviarMidia({ data: form });
        enviados += 1;
      }
      toast.success(`${enviados} arquivo(s) enviado(s) para ${destinoMidia}.`);
      setArquivosMidia([]);
      setAvisosVideo([]);
      if (inputMidiaRef.current) inputMidiaRef.current.value = "";
      await midiasQuery.refetch();
    } catch (error) {
      toast.error(
        enviados > 0
          ? `${enviados} arquivo(s) enviados antes da falha.`
          : error instanceof Error
            ? error.message
            : "Não foi possível enviar os arquivos.",
      );
    } finally {
      setEnviandoMidia(false);
    }
  }

  async function copiarLinkCliente() {
    if (!workOrderId) return;
    setCopiandoPasta(true);
    try {
      const { url } = await criarLinkPasta({ data: { workOrderId } });
      await navigator.clipboard.writeText(url);
      toast.success("Link da pasta do cliente copiado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível copiar o link.");
    } finally {
      setCopiandoPasta(false);
    }
  }

  /** Gera (ou regera) o termo de garantia da impermeabilização. */
  async function gerarTermo() {
    if (!workOrderId) return;
    setGerandoTermo(true);
    try {
      await gerarTermoFn({ data: { workOrderId } });
      toast.success("Termo de garantia gerado.");
      await garantiaQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o termo de garantia.");
    } finally {
      setGerandoTermo(false);
    }
  }


  const historicoQuery = useQuery({
    queryKey: ["os_historico", workOrderId],
    enabled: Boolean(workOrderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_history")
        .select("id, event_type, description, created_at")
        .eq("work_order_id", workOrderId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const doc = docQuery.data ?? null;

  const { ativo: controleInsumos } = useControleInsumos();
  const consumoQuery = useConsumoDaOs(workOrderId, controleInsumos);
  const consumo = consumoQuery.data ?? [];

  const gastosTecnicoQuery = useQuery({
    queryKey: ["technician_expenses", "os", workOrderId ?? ""],
    enabled: Boolean(workOrderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("technician_expenses")
        .select("id, expense_date, categories, amount")
        .eq("work_order_id", workOrderId!)
        .order("expense_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const gastosTecnico = gastosTecnicoQuery.data ?? [];

  const visitasCobranca = (os?.visits ?? []).map((v) => ({
    id: v.id,
    scheduled_date: v.scheduled_date,
    scheduled_time: v.scheduled_time,
    status: v.status,
    service_name: v.service_type?.name ?? null,
    amount: effectiveVisitValue(v),
  }));
  const regraSugerida = defaultCollectionRule(visitasCobranca);
  const regraAtual = regra ?? os?.collection_rule ?? "";
  const visitaCobrancaAtual = visitaCobranca ?? os?.collection_visit_id ?? "";

  async function salvarCobranca() {
    if (!workOrderId) return;
    setSalvandoCobranca(true);
    const { error } = await supabase
      .from("work_orders")
      .update({
        collection_rule: regraAtual || regraSugerida,
        collection_visit_id:
          (regraAtual || regraSugerida) === "specific_visit" ? visitaCobrancaAtual || null : null,
        collection_configuration_updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq("id", workOrderId);
    setSalvandoCobranca(false);
    if (error) {
      toast.error("Não foi possível salvar o momento da cobrança.");
      return;
    }
    toast.success("Momento da cobrança atualizado. As mensagens já usam a nova regra.");
    osQuery.refetch();
    invalidateFinanceQueries(queryClient);
  }

  async function desfazerDesconto(visitId: string) {
    if (!workOrderId) return;
    setDesfazendoDesconto(visitId);
    try {
      await clearVisitDiscount({ visitId, workOrderId, userId });
      toast.success("Desconto desfeito. O saldo volta para A receber.");
      await Promise.all([osQuery.refetch(), historicoQuery.refetch()]);
      invalidateFinanceQueries(queryClient);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desfazer o desconto.");
    } finally {
      setDesfazendoDesconto(null);
    }
  }

  function itensDe(v: Visit): Item[] {
    return (v.service_items ?? [])
      .filter((i) => i.active !== false)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  }

  const semValor = (os?.visits ?? []).some((v) => {
    if (v.status === "Cancelado") return false;
    const itens = itensDe(v);
    if (itens.length) return itens.some((i) => Number(i.unit_price ?? 0) <= 0);
    return effectiveVisitValue(v) <= 0;
  });

  async function gerarDocumento(mode: "novo" | "atualizar" | "versao") {
    if (!workOrderId) return;
    if (semValor) {
      toast.error("Existem itens sem valor individual. Revise os dados antes de gerar a OS.");
      return;
    }
    setGerando(true);
    try {
      const r = await gerar({ data: { workOrderId, mode } });
      toast.success(`Documento ${r.name} gerado no Google Docs.`);
      await docQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o documento.");
    } finally {
      setGerando(false);
    }
  }

  async function confirmarCancelamento() {
    if (!workOrderId) return;
    if (motivoCancelar.trim().length < 3) {
      toast.error("Informe o motivo do cancelamento.");
      return;
    }
    try {
      await cancelWorkOrder({ workOrderId, reason: motivoCancelar.trim(), userId });
      toast.success("OS cancelada.");
      setAcaoAberta(null);
      setMotivoCancelar("");
      await Promise.all([osQuery.refetch(), historicoQuery.refetch()]);
      invalidateFinanceQueries(queryClient);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cancelar a OS.");
    }
  }

  async function confirmarExclusao() {
    if (!workOrderId) return;
    if (motivoExcluir.trim().length < 3) {
      toast.error("Informe o motivo da exclusão.");
      return;
    }
    if (!window.confirm("Tem certeza de que deseja excluir esta OS?")) return;
    try {
      await softDeleteWorkOrder({ workOrderId, reason: motivoExcluir.trim(), userId });
      toast.success("OS excluída. Você pode restaurá-la depois.");
      setAcaoAberta(null);
      setMotivoExcluir("");
      await Promise.all([osQuery.refetch(), historicoQuery.refetch()]);
      invalidateFinanceQueries(queryClient);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir a OS.");
    }
  }

  async function restaurar() {
    if (!workOrderId) return;
    try {
      await restoreWorkOrder({ workOrderId, userId });
      toast.success("OS restaurada.");
      await Promise.all([osQuery.refetch(), historicoQuery.refetch()]);
      invalidateFinanceQueries(queryClient);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível restaurar a OS.");
    }
  }

  if (osQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando OS...</p>;
  }
  if (!os) {
    return (
      <div className="card-surface p-6 text-center">
        <p className="font-medium">OS {osNumber} não encontrada.</p>
      </div>
    );
  }

  const somaItens = Number(
    os.items_sum ??
      os.visits.reduce(
        (s, v) => s + itensDe(v).reduce((t, i) => t + Number(i.subtotal ?? 0), 0),
        0,
      ),
  );
  const combinado = Number(os.total_gross_value ?? 0);
  const diferenca = Math.round((combinado - somaItens) * 100) / 100;

  const whatsapp = whatsappLink(os.customer?.phone);
  const whatsappDoc =
    doc?.url && os.customer?.phone
      ? whatsappLink(
          os.customer.phone,
          `Olá, ${os.customer.full_name}! Segue a sua Ordem de Serviço nº ${os.os_number}: ${doc.url}`,
        )
      : null;

  const pagoTotal = os.payments
    .filter((p) => p.is_active !== false && p.payment_status === "Pago")
    .reduce((s, p) => s + Number(p.gross_amount ?? 0), 0);
  const saldoPendente = Math.max(0, Math.round((combinado - pagoTotal) * 100) / 100);

  /** Custo e margem real desta OS. */
  const margem = (() => {
    const pagos = os.payments.filter((p) => p.is_active !== false && p.payment_status === "Pago");
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const recebido = r2(pagos.reduce((s, p) => s + Number(p.gross_amount ?? 0), 0));
    const taxas = r2(pagos.reduce((s, p) => s + Number(p.payment_fee_amount ?? 0), 0));
    const comissao = r2(Number(os.commission_realized ?? 0));
    const deslocamento = r2(
      os.visits.reduce((s, v) => s + Number(v.mileage_cost_allocated ?? 0), 0),
    );
    const produtos = controleInsumos
      ? r2(consumo.reduce((s, c) => s + Number(c.custo_calculado ?? 0), 0))
      : 0;
    const gastos = r2(gastosTecnico.reduce((s, g) => s + Number(g.amount ?? 0), 0));
    const resultado = r2(recebido - taxas - comissao - deslocamento - produtos - gastos);
    return {
      recebido,
      taxas,
      comissao,
      deslocamento,
      produtos,
      gastos,
      resultado,
      percentual: recebido > 0 ? (resultado / recebido) * 100 : 0,
    };
  })();

  const visitasConcluidas = os.visits
    .filter((v) => v.status === "Concluído")
    .map((v) => ({
      id: v.id,
      label: `${v.service_type?.name ?? "Atendimento"} — ${dateBR(v.scheduled_date)}`,
    }));
  const podeLancarPagamento = visitasConcluidas.length > 0 && !os.deleted_at && !os.cancelled_at;

  return (
    <>
      <PageHeader
        title={`OS ${os.os_number}`}
        description={`${os.customer?.full_name ?? "Cliente"} · ${
          os.deleted_at ? "Excluída" : os.cancelled_at ? "Cancelada" : os.status
        } · venda em ${dateBR(os.sale_date)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/oss">Voltar</Link>
            </Button>
            <Button onClick={() => void navigate({ to: "/nova-os", search: { editar: os.os_number } })}>
              <Pencil className="mr-2 size-4" /> Editar OS
            </Button>
          </div>
        }
      />

      {os.deleted_at ? (
        <div className="card-surface mb-6 flex flex-wrap items-center justify-between gap-3 border-destructive/40 p-4">
          <p className="text-sm">
            OS excluída em {dateTimeBR(os.deleted_at)}. Motivo: {os.deletion_reason ?? "—"}
          </p>
          <Button variant="outline" onClick={() => void restaurar()}>
            <RotateCcw className="mr-2 size-4" /> Restaurar OS
          </Button>
        </div>
      ) : null}
      {os.cancelled_at ? (
        <div className="card-surface mb-6 p-4 text-sm">
          OS cancelada em {dateTimeBR(os.cancelled_at)}. Motivo: {os.cancellation_reason ?? "—"}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <section className="card-surface p-5">
            <h2 className="mb-3 text-lg font-semibold">Cliente</h2>
            <p className="text-sm font-medium">{os.customer?.full_name ?? "—"}</p>
            <p className="text-sm text-muted-foreground">{os.customer?.phone ?? "—"}</p>
            {os.customer?.full_address ? (
              <p className="mt-1 text-sm text-muted-foreground">{os.customer.full_address}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {whatsapp ? (
                <Button variant="outline" asChild>
                  <a href={whatsapp} target="_blank" rel="noreferrer">
                    <MessageCircle className="mr-2 size-4" /> Abrir WhatsApp
                  </a>
                </Button>
              ) : null}
              {whatsappDoc ? (
                <Button variant="outline" asChild>
                  <a href={whatsappDoc} target="_blank" rel="noreferrer">
                    <MessageCircle className="mr-2 size-4" /> Enviar link da OS pelo WhatsApp
                  </a>
                </Button>
              ) : null}
            </div>
            {os.salesperson?.name ? (
              <p className="mt-3 text-xs text-muted-foreground">Vendedora: {os.salesperson.name}</p>
            ) : null}
          </section>

          <section className="card-surface p-5">
            <h2 className="mb-4 text-lg font-semibold">Serviços e agendamentos</h2>
            <div className="grid gap-4">
              {os.visits.map((v) => {
                const itens = itensDe(v);
                const total = itens.length
                  ? itens.reduce((s, i) => s + Number(i.subtotal ?? 0), 0)
                  : effectiveVisitValue(v);
                return (
                  <div key={v.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{v.service_type?.name ?? "Serviço"}</p>
                      <span className="text-xs text-muted-foreground">{v.status}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {dateBR(v.scheduled_date)} às {timeBR(v.scheduled_time)}
                      {v.technician?.name ? ` · ${v.technician.name}` : ""}
                    </p>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[420px] text-sm">
                        <thead className="bg-secondary text-left">
                          <tr>
                            <th className="px-3 py-2 font-medium">Item</th>
                            <th className="px-3 py-2 font-medium">Qtd</th>
                            <th className="px-3 py-2 font-medium">Valor unit.</th>
                            <th className="px-3 py-2 font-medium">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itens.length ? (
                            itens.map((i) => (
                              <tr key={i.id} className="border-t border-border">
                                <td className="px-3 py-2">
                                  {i.description || i.upholstery_type?.name || "—"}
                                </td>
                                <td className="px-3 py-2">{i.quantity}</td>
                                <td className="px-3 py-2">{brl(Number(i.unit_price ?? 0))}</td>
                                <td className="px-3 py-2">{brl(Number(i.subtotal ?? 0))}</td>
                              </tr>
                            ))
                          ) : (
                            <tr className="border-t border-border">
                              <td className="px-3 py-2">
                                {v.upholstery_description || v.upholstery_type?.name || "—"}
                              </td>
                              <td className="px-3 py-2">{v.item_quantity ?? 1}</td>
                              <td className="px-3 py-2">—</td>
                              <td className="px-3 py-2">{brl(total)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-sm">
                      Total do serviço: <strong>{brl(total)}</strong>
                    </p>
                    {Number(v.discount_amount ?? 0) > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">
                          Desconto concedido {brl(Number(v.discount_amount))}
                          {v.discount_reason ? ` — ${v.discount_reason}` : ""}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={desfazendoDesconto === v.id}
                          onClick={() => void desfazerDesconto(v.id)}
                        >
                          Desfazer
                        </Button>
                      </div>
                    ) : null}
                    {v.visit_notes ? (
                      <p className="mt-1 text-xs text-muted-foreground">{v.visit_notes}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card-surface p-5">
            <h2 className="mb-3 text-lg font-semibold">Valores e pagamento combinado</h2>
            <p className="text-sm">
              Soma dos itens: <strong>{brl(somaItens)}</strong>
            </p>
            <p className="text-sm">
              Valor total combinado com o cliente: <strong>{brl(combinado)}</strong>
            </p>
            {diferenca !== 0 ? (
              <p className="mt-1 text-sm text-destructive">
                O valor combinado é diferente da soma dos itens. Ajuste comercial:{" "}
                {diferenca > 0 ? "+" : "-"}
                {brl(Math.abs(diferenca))}
                {os.adjustment_reason ? ` · ${os.adjustment_reason}` : ""}
              </p>
            ) : null}
            <p className="mt-2 text-sm">
              Forma combinada: {os.negotiated_payment_method ?? "—"}
              {Number(os.negotiated_installments ?? 1) > 1
                ? ` em ${os.negotiated_installments}x`
                : ""}
            </p>
            {os.os_value_text ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Texto exibido na OS: {os.os_value_text}
              </p>
            ) : null}
            {os.payment_notes ? (
              <p className="mt-1 text-xs text-muted-foreground">{os.payment_notes}</p>
            ) : null}
            {os.general_notes ? (
              <p className="mt-3 text-sm text-muted-foreground">Observações: {os.general_notes}</p>
            ) : null}
          </section>

          <section className="card-surface p-5">
            <h2 className="mb-1 text-lg font-semibold">Momento da cobrança</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Define a instrução de pagamento enviada ao técnico pelo WhatsApp.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="regra-cobranca">Regra</Label>
                <select
                  id="regra-cobranca"
                  value={regraAtual}
                  onChange={(e) => setRegra(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Automático — {collectionRuleLabel(regraSugerida)}</option>
                  {COLLECTION_RULES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              {(regraAtual || regraSugerida) === "specific_visit" ? (
                <div className="space-y-2">
                  <Label htmlFor="visita-cobranca">Atendimento da cobrança</Label>
                  <select
                    id="visita-cobranca"
                    value={visitaCobrancaAtual}
                    onChange={(e) => setVisitaCobranca(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Selecione o atendimento</option>
                    {visitasCobranca.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.service_name || "Atendimento"} — {dateBR(v.scheduled_date)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            {os.payment_instruction ? (
              <p className="mt-3 text-sm">
                Instrução personalizada: <strong>{os.payment_instruction}</strong>
              </p>
            ) : null}
            <div className="mt-4 flex justify-end">
              <Button onClick={salvarCobranca} disabled={salvandoCobranca}>
                {salvandoCobranca ? "Salvando..." : "Salvar momento da cobrança"}
              </Button>
            </div>
          </section>

          <section className="card-surface p-5">
            <h2 className="mb-1 text-lg font-semibold">Custo e margem real desta OS</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Considera o que o cliente já pagou, menos taxas, comissão, deslocamento
              {controleInsumos ? ", produtos usados" : ""} e gastos do técnico.
            </p>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-border">
                  <td className="py-2">Recebido do cliente</td>
                  <td className="py-2 text-right font-medium">{brl(margem.recebido)}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">(-) Taxas de pagamento</td>
                  <td className="py-2 text-right">{brl(-margem.taxas)}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">(-) Comissão de venda</td>
                  <td className="py-2 text-right">{brl(-margem.comissao)}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">(-) Deslocamento</td>
                  <td className="py-2 text-right">{brl(-margem.deslocamento)}</td>
                </tr>
                {controleInsumos ? (
                  <tr className="border-b border-border">
                    <td className="py-2">(-) Produtos usados</td>
                    <td className="py-2 text-right">{brl(-margem.produtos)}</td>
                  </tr>
                ) : null}
                <tr className="border-b border-border">
                  <td className="py-2">(-) Gastos do técnico</td>
                  <td className="py-2 text-right">{brl(-margem.gastos)}</td>
                </tr>
                <tr>
                  <td className="py-2 font-semibold">(=) Margem real</td>
                  <td className="py-2 text-right font-semibold">
                    {brl(margem.resultado)}
                    {margem.recebido > 0 ? ` (${margem.percentual.toFixed(1)}%)` : ""}
                  </td>
                </tr>
              </tbody>
            </table>
            {controleInsumos && consumo.length ? (
              <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                {consumo.map((c) => (
                  <li key={c.id}>
                    {c.produto_nome} — {c.quantidade_ml} ml — {brl(Number(c.custo_calculado ?? 0))}
                  </li>
                ))}
              </ul>
            ) : null}
            {gastosTecnico.length ? (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {gastosTecnico.map((g) => (
                  <li key={g.id}>
                    {(g.categories ?? []).join(", ")} — {brl(Number(g.amount ?? 0))}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="card-surface p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Pagamento efetivo</h2>
              {podeLancarPagamento ? (
                <Button
                  size="sm"
                  onClick={() => setDialogoPagamento({ payment: null, mode: "criar" })}
                >
                  Lançar pagamento
                </Button>
              ) : null}
            </div>
            {os.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum pagamento lançado.{" "}
                {podeLancarPagamento
                  ? `Use “Lançar pagamento” para registrar o que o cliente já pagou (saldo em aberto: ${brl(saldoPendente)}).`
                  : "Os pagamentos são registrados ao concluir cada serviço."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-secondary text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Canal / forma</th>
                      <th className="px-3 py-2 font-medium">Bruto</th>
                      <th className="px-3 py-2 font-medium">Taxa</th>
                      <th className="px-3 py-2 font-medium">Líquido</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {os.payments.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-3 py-2">{p.payment_date ? dateBR(p.payment_date) : "—"}</td>
                        <td className="px-3 py-2">
                          {p.payment_channel} · {p.payment_type}
                          {p.installments > 1 ? ` ${p.installments}x` : ""}
                        </td>
                        <td className="px-3 py-2">{brl(Number(p.gross_amount ?? 0))}</td>
                        <td className="px-3 py-2">{brl(Number(p.payment_fee_amount ?? 0))}</td>
                        <td className="px-3 py-2">{brl(Number(p.net_amount ?? 0))}</td>
                        <td className="px-3 py-2">{p.payment_status}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {p.payment_status !== "Pago" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDialogoPagamento({ payment: p, mode: "registrar" })}
                              >
                                {p.reopen_reason ? "Registrar novo pagamento" : "Marcar como pago"}
                              </Button>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setDialogoPagamento({ payment: p, mode: "registrar" })}
                                >
                                  Editar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDialogoPagamento({ payment: p, mode: "reabrir" })}
                                >
                                  Reabrir
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-sm">
                  Recebido: <strong>{brl(pagoTotal)}</strong> de {brl(combinado)}
                </p>
              </div>
            )}
          </section>

          <section className="card-surface p-5">
            <h2 className="mb-3 text-lg font-semibold">Histórico</h2>
            {(historicoQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {(historicoQuery.data ?? []).map((h) => (
                  <li key={h.id} className="border-b border-border pb-2 last:border-0">
                    <span className="font-medium">{h.event_type}</span> · {h.description}
                    <span className="block text-xs text-muted-foreground">
                      {dateTimeBR(h.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="grid gap-6">
          <section className="card-surface p-5">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              <h2 className="text-lg font-semibold">Documento da OS</h2>
            </div>

            <p className="text-sm">
              Situação: <strong>{gerando ? "Gerando" : (doc?.status ?? "Não gerado")}</strong>
              {doc?.version && doc.version > 1 ? ` · versão ${doc.version}` : ""}
            </p>
            {doc?.templateType ? (
              <p className="mt-1 text-xs text-muted-foreground">Modelo: {doc.templateType}</p>
            ) : null}
            {doc?.outdated ? (
              <p className="mt-2 text-sm text-destructive">
                Os dados desta OS foram alterados após a geração do documento.
              </p>
            ) : null}
            {doc?.status === "Erro" && doc.errorMessage ? (
              <p className="mt-2 text-sm text-destructive">{doc.errorMessage}</p>
            ) : null}
            {semValor ? (
              <p className="mt-2 text-sm text-destructive">
                Existem itens sem valor individual. Revise os dados antes de gerar a OS.
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-2">
              {!doc || doc.status === "Não gerado" ? (
                <Button onClick={() => void gerarDocumento("novo")} disabled={gerando}>
                  {gerando ? "Gerando documento..." : "Gerar documento"}
                </Button>
              ) : null}

              {doc?.url ? (
                <>
                  <Button variant="outline" asChild>
                    <a href={doc.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 size-4" /> Abrir no Google Docs
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(doc.url!);
                      toast.success("Link copiado.");
                    }}
                  >
                    <Link2 className="mr-2 size-4" /> Copiar link
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void gerarDocumento("atualizar")}
                    disabled={gerando}
                  >
                    <RefreshCw className="mr-2 size-4" />
                    {gerando ? "Gerando documento..." : "Atualizar documento"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void gerarDocumento("versao")}
                    disabled={gerando}
                  >
                    Gerar nova versão
                  </Button>
                </>
              ) : null}

              {doc?.status === "Erro" ? (
                <Button onClick={() => void gerarDocumento("novo")} disabled={gerando}>
                  Tentar novamente
                </Button>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              “Atualizar documento” substitui o arquivo atual. “Gerar nova versão” mantém o anterior e
              cria uma versão nova.
            </p>
          </section>

          {garantia?.available ? (
            <section className="card-surface p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="size-5 text-primary" />
                <h2 className="text-lg font-semibold">Termo de garantia</h2>
              </div>
              <p className="text-sm">
                Situação:{" "}
                <strong>
                  {gerandoTermo ? "Gerando" : (garantia.document?.status ?? "Não gerado")}
                </strong>
                {garantia.document && garantia.document.version > 1
                  ? ` · versão ${garantia.document.version}`
                  : ""}
              </p>
              {garantia.document?.status === "Erro" && garantia.document.errorMessage ? (
                <p className="mt-2 text-sm text-destructive">{garantia.document.errorMessage}</p>
              ) : null}
              <div className="mt-4 flex flex-col gap-2">
                <Button onClick={() => void gerarTermo()} disabled={gerandoTermo}>
                  {gerandoTermo
                    ? "Gerando termo..."
                    : garantia.document?.url
                      ? "Gerar nova versão"
                      : "Gerar termo de garantia"}
                </Button>
                {garantia.document?.url ? (
                  <>
                    <Button variant="outline" asChild>
                      <a href={garantia.document.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 size-4" /> Abrir termo
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(garantia.document!.url!);
                        toast.success("Link copiado.");
                      }}
                    >
                      <Link2 className="mr-2 size-4" /> Copiar link
                    </Button>
                  </>
                ) : null}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Gerado apenas para OS com impermeabilização, com a data da próxima impermeabilização
                (12 meses) e salvo na mesma pasta da OS.
              </p>
            </section>
          ) : null}

          <section className="card-surface p-5">
            <div className="mb-3 flex items-center gap-2">
              <ImagePlus className="size-5 text-primary" />
              <h2 className="text-lg font-semibold">Fotos e vídeos</h2>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="destino-midia">Destino</Label>
                <select
                  id="destino-midia"
                  value={destinoMidia}
                  onChange={(event) => setDestinoMidia(event.target.value as MediaDestination)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {destinosMidia.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                {destinoMidia === "Controle interno" ? (
                  <p className="text-sm text-warning">Não vai aparecer para o cliente.</p>
                ) : null}
                {opcoesMidia.data?.sharedWithEmail ? (
                  <p className="text-sm text-muted-foreground">
                    Pasta já compartilhada com {opcoesMidia.data.sharedWithEmail}.
                  </p>
                ) : opcoesMidia.data?.customerEmail ? (
                  <p className="text-sm text-muted-foreground">
                    Ao concluir o serviço a pasta é compartilhada com {opcoesMidia.data.customerEmail}.
                  </p>
                ) : (
                  <p className="text-sm text-warning">
                    Cadastre o e-mail do cliente para compartilhar a pasta automaticamente.
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="arquivos-midia">Fotos ou vídeos</Label>
                <Input
                  ref={inputMidiaRef}
                  id="arquivos-midia"
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(event) => void selecionarMidias(event.target.files)}
                />
                {arquivosMidia.length ? (
                  <p className="text-sm text-muted-foreground">
                    {arquivosMidia.length} arquivo(s) selecionado(s).
                  </p>
                ) : null}
                {avisosVideo.length ? (
                  <p className="text-sm text-warning">
                    {avisosVideo.length} vídeo(s) têm mais de 60 segundos. O envio continua permitido.
                  </p>
                ) : null}
              </div>

              <Button onClick={() => void enviarArquivos()} disabled={!arquivosMidia.length || enviandoMidia}>
                <Upload className="mr-2 size-4" />
                {enviandoMidia ? "Enviando arquivos..." : "Enviar arquivos"}
              </Button>
              <Button variant="outline" onClick={() => void copiarLinkCliente()} disabled={copiandoPasta}>
                <FolderOpen className="mr-2 size-4" />
                {copiandoPasta ? "Preparando link..." : "Copiar link para o cliente"}
              </Button>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <h3 className="mb-2 text-sm font-semibold">Arquivos enviados</h3>
              {midiasQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando arquivos...</p>
              ) : (midiasQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum arquivo enviado nesta OS.</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {(midiasQuery.data ?? []).map((arquivo) => (
                    <li key={arquivo.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{arquivo.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {arquivo.destination} · {dateTimeBR(arquivo.created_at)}
                        </p>
                      </div>
                      {arquivo.google_file_url ? (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={arquivo.google_file_url} target="_blank" rel="noreferrer" aria-label={`Abrir ${arquivo.file_name}`}>
                            <ExternalLink className="size-4" />
                          </a>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>


          <section className="card-surface p-5">
            <h2 className="mb-3 text-lg font-semibold">Ações da OS</h2>
            <div className="flex flex-col gap-2">
              {!os.cancelled_at ? (
                <Button variant="outline" onClick={() => setAcaoAberta("cancelar")}>
                  <Ban className="mr-2 size-4" /> Cancelar OS
                </Button>
              ) : null}
              {!os.deleted_at ? (
                <Button variant="outline" onClick={() => setAcaoAberta("excluir")}>
                  <Trash2 className="mr-2 size-4" /> Excluir OS
                </Button>
              ) : null}
            </div>

            {acaoAberta === "cancelar" ? (
              <div className="mt-4 grid gap-2">
                <Label htmlFor="motivoCancelar">Motivo do cancelamento</Label>
                <Input
                  id="motivoCancelar"
                  value={motivoCancelar}
                  onChange={(e) => setMotivoCancelar(e.target.value)}
                  placeholder="Ex.: cliente desistiu"
                />
                <div className="flex gap-2">
                  <Button onClick={() => void confirmarCancelamento()}>Confirmar cancelamento</Button>
                  <Button variant="ghost" onClick={() => setAcaoAberta(null)}>
                    Voltar
                  </Button>
                </div>
              </div>
            ) : null}

            {acaoAberta === "excluir" ? (
              <div className="mt-4 grid gap-2">
                <Label htmlFor="motivoExcluir">Motivo da exclusão</Label>
                <Input
                  id="motivoExcluir"
                  value={motivoExcluir}
                  onChange={(e) => setMotivoExcluir(e.target.value)}
                  placeholder="Ex.: OS duplicada"
                />
                {os.payments.length > 0 || os.visits.some((v) => v.status === "Concluído") ? (
                  <p className="text-sm text-destructive">
                    Atenção: esta OS possui pagamentos ou serviços concluídos.
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={() => void confirmarExclusao()}>
                    Excluir OS
                  </Button>
                  <Button variant="ghost" onClick={() => setAcaoAberta(null)}>
                    Voltar
                  </Button>
                </div>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Cancelar mantém o histórico e o documento. Excluir é uma exclusão suave e pode ser
              restaurada; o arquivo no Google nunca é apagado.
            </p>
          </section>
        </div>
      </div>

      <PaymentDialog
        open={dialogoPagamento !== null}
        onOpenChange={(v) => !v && setDialogoPagamento(null)}
        payment={dialogoPagamento?.payment ?? null}
        mode={dialogoPagamento?.mode ?? "registrar"}
        workOrderId={os.id}
        visitOptions={visitasConcluidas}
        suggestedAmount={saldoPendente}
        osLabel={`OS ${os.os_number}`}
        onDone={() => void osQuery.refetch()}
      />
    </>

  );
}
