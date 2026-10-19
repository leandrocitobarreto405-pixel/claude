/**
 * Emissão de nota fiscal (sem emissão automática): monta a mensagem para o grupo que emite as
 * notas, controla a situação (Pendente → Solicitada → Emitida) e guarda o arquivo da nota no
 * Supabase Storage (bucket "notas-fiscais", pasta = empresa).
 */
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { logOsHistory } from "@/lib/os";
import { recebido } from "@/lib/payments";
import {
  descricaoServicos,
  type Descricao,
  type VisitaDescricao,
} from "@/lib/nota-fiscal-descricao";

export const DEFAULT_NOTA_TEMPLATE = [
  "Nota fiscal — {{nome_cliente}}",
  "CPF/CNPJ: {{cpf_cnpj}}",
  "E-mail: {{email}}",
  "Data do serviço: {{data_servico}}",
  "Forma de pagamento: {{forma_pagamento}}",
  "Valor: {{valor}}",
  "OS: {{numero_os}}",
].join("\n");

export const NOTA_BUCKET = "notas-fiscais";

export type PagamentoNota = {
  payment_type: string | null;
  payment_channel: string | null;
  installments: number | null;
  payment_status: string | null;
  is_active: boolean | null;
};

export type TarefaNota = {
  id: string;
  empresa_id: string;
  status: string;
  invoice_amount: number | null;
  invoice_number: string | null;
  issue_date: string | null;
  service_date: string | null;
  document_number: string | null;
  solicitada_em: string | null;
  arquivo_path: string | null;
  arquivo_nome: string | null;
  /** Em "Não emitir": o motivo, quem marcou e quando. */
  notes?: string | null;
  work_order: {
    id: string;
    os_number: string;
    total_gross_value: number | null;
    negotiated_payment_method: string | null;
    negotiated_installments: number | null;
    customer: {
      full_name: string | null;
      document_number: string | null;
      email: string | null;
    } | null;
    payments: PagamentoNota[] | null;
    /** Visitas com os itens (descrição dos serviços da nota). */
    visits?: VisitaDescricao[] | null;
  } | null;
};

export const TAREFA_NOTA_SELECT = `
  id, empresa_id, status, invoice_amount, invoice_number, issue_date, service_date, document_number,
  solicitada_em, arquivo_path, arquivo_nome, notes,
  work_order:work_order_id ( id, os_number, total_gross_value, negotiated_payment_method, negotiated_installments,
    customer:customer_id ( full_name, document_number, email ),
    payments ( payment_type, payment_channel, installments, payment_status, is_active ),
    visits!visits_work_order_id_fkey ( status, completion_date, scheduled_date, visit_value, final_value,
      discount_amount, item_quantity, upholstery_description, service_type:service_type_id ( name ),
      service_items ( description, quantity, unidade, subtotal, item_group_id, display_order, active ) ) )
`;

/** Forma de pagamento da OS: a efetivamente recebida; sem pagamento lançado, a combinada. */
export function formaPagamento(t: TarefaNota): string | null {
  const pagos = (t.work_order?.payments ?? []).filter(recebido);
  const descrever = (tipo: string | null, parcelas: number | null) =>
    tipo ? `${tipo}${parcelas && parcelas > 1 ? ` em ${parcelas}x` : ""}` : null;
  if (pagos.length) {
    const partes = pagos.map((p) => descrever(p.payment_type ?? p.payment_channel, p.installments));
    return Array.from(new Set(partes.filter(Boolean))).join(" + ") || null;
  }
  return descrever(
    t.work_order?.negotiated_payment_method ?? null,
    t.work_order?.negotiated_installments ?? null,
  );
}

export type DadosNota = {
  nome_cliente: string | null;
  cpf_cnpj: string | null;
  email: string | null;
  data_servico: string | null;
  forma_pagamento: string | null;
  valor: string | null;
  numero_os: string | null;
};

export const ROTULOS_NOTA: Record<keyof DadosNota, string> = {
  nome_cliente: "nome do cliente",
  cpf_cnpj: "CPF/CNPJ",
  email: "e-mail",
  data_servico: "data do serviço",
  forma_pagamento: "forma de pagamento",
  valor: "valor",
  numero_os: "número da OS",
};

export function dadosDaNota(t: TarefaNota): DadosNota {
  const cliente = t.work_order?.customer;
  const valor = t.invoice_amount ?? t.work_order?.total_gross_value ?? null;
  return {
    nome_cliente: cliente?.full_name?.trim() || null,
    cpf_cnpj: (t.document_number || cliente?.document_number)?.trim() || null,
    email: cliente?.email?.trim() || null,
    data_servico: t.service_date ? dateBR(t.service_date) : null,
    forma_pagamento: formaPagamento(t),
    valor: valor !== null ? brl(Number(valor)) : null,
    numero_os: t.work_order?.os_number ?? null,
  };
}

/** Campos exigidos pela mensagem que estão em branco (para avisar antes de copiar). */
export function camposFaltando(d: DadosNota): string[] {
  return (["nome_cliente", "cpf_cnpj", "email", "data_servico", "forma_pagamento"] as const)
    .filter((k) => !d[k])
    .map((k) => ROTULOS_NOTA[k]);
}

/** Descrição dos serviços (campo "Discriminação dos Serviços" da NFS-e) a partir dos itens da OS. */
export function descricaoDaNota(t: TarefaNota): Descricao {
  const valorOs = Number(t.work_order?.total_gross_value ?? 0);
  return descricaoServicos({
    valorNota: Number(t.invoice_amount ?? valorOs),
    valorOs,
    visitas: t.work_order?.visits ?? [],
  });
}

/**
 * Mensagem do modelo da empresa; com a descrição, ela entra no lugar de {{descricao_servicos}} ou,
 * se o modelo não tiver essa variável, no fim (depois de uma linha em branco).
 */
export function montarMensagemNota(
  template: string | null | undefined,
  d: DadosNota,
  descricao?: string | null,
): string {
  let modelo = (template && template.trim()) || DEFAULT_NOTA_TEMPLATE;
  if (descricao) {
    const variavel = /\{\{\s*descricao_servicos\s*\}\}/g;
    modelo = variavel.test(modelo)
      ? modelo.replace(variavel, () => descricao)
      : `${modelo}\n\n${descricao}`;
  }
  return modelo.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave: string) => {
    const valor = (d as Record<string, string | null>)[chave];
    return valor === undefined ? `{{${chave}}}` : valor || "não informado";
  });
}

// ---------------------------------------------------------------- "Não emitir"

export const NAO_EMITIR = "Não emitir";
/** Situações que ainda esperam a nota (listas de pendentes, "Copiar todas"). */
export const SITUACOES_A_EMITIR = ["Pendente", "Solicitada"] as const;

export function aEmitir(status: string): boolean {
  return (SITUACOES_A_EMITIR as readonly string[]).includes(status);
}

export const MAX_MOTIVO_NAO_EMITIR = 200;

/** Confere o motivo (curto e obrigatório); devolve o texto limpo ou lança o erro para a tela. */
export function validarMotivo(motivo: string): string {
  const m = motivo.replace(/\s+/g, " ").trim();
  if (m.length < 3) throw new Error("Escreva o motivo (pelo menos 3 letras).");
  if (m.length > MAX_MOTIVO_NAO_EMITIR)
    throw new Error(`Motivo muito longo (até ${MAX_MOTIVO_NAO_EMITIR} caracteres).`);
  return m;
}

/** Registro guardado na nota: "Motivo — marcado por Ana em 19/10/2026 14:30". */
export function registroNaoEmitir(motivo: string, quem: string, quando: Date): string {
  const data = quando.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${motivo} — marcado por ${quem} em ${data.replace(",", "")}`;
}

async function quemSouEu(): Promise<{ id: string | null; nome: string }> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id ?? null;
  if (!id) return { id: null, nome: "alguém da equipe" };
  const { data: perfil } = await supabase
    .from("users_profiles")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();
  return { id, nome: perfil?.full_name?.trim() || data.user?.email || "alguém da equipe" };
}

/** Tira a nota das pendentes, guardando motivo, quem e quando (na nota e no histórico da OS). */
export async function marcarNaoEmitir(t: TarefaNota, motivoDigitado: string) {
  if (!aEmitir(t.status))
    throw new Error("Só nota pendente ou solicitada pode ir para “Não emitir”.");
  const motivo = validarMotivo(motivoDigitado);
  const anterior = t.status;
  const eu = await quemSouEu();
  const registro = registroNaoEmitir(motivo, eu.nome, new Date());
  const { error } = await supabase
    .from("invoice_tasks")
    .update({ status: NAO_EMITIR, notes: registro })
    .eq("id", t.id);
  if (error) throw error;
  if (t.work_order?.id)
    await logOsHistory({
      workOrderId: t.work_order.id,
      eventType: "Nota fiscal: não emitir",
      description: `Nota marcada como “Não emitir” (antes: ${anterior}). Motivo: ${motivo}`,
      details: { invoice_task_id: t.id, status_anterior: anterior, motivo },
      userId: eu.id,
    });
}

/** Desfaz o "Não emitir": a nota volta para Pendente; o registro fica no histórico da OS. */
export async function voltarParaPendente(t: TarefaNota) {
  if (t.status !== NAO_EMITIR) throw new Error("Esta nota não está em “Não emitir”.");
  const registroAnterior = t.notes ?? null;
  const eu = await quemSouEu();
  const { error } = await supabase
    .from("invoice_tasks")
    .update({ status: "Pendente", notes: null })
    .eq("id", t.id);
  if (error) throw error;
  if (t.work_order?.id)
    await logOsHistory({
      workOrderId: t.work_order.id,
      eventType: "Nota fiscal: voltou para pendente",
      description: `Nota voltou para Pendente. Estava em “Não emitir”: ${registroAnterior ?? "sem motivo"}`,
      details: { invoice_task_id: t.id, registro_anterior: registroAnterior },
      userId: eu.id,
    });
}

// ---------------------------------------------------------------- "Pedir nota" (tela da OS)

/**
 * Data do serviço do pedido manual: a última conclusão; sem visita concluída, a primeira data
 * agendada das visitas não canceladas.
 */
export function dataServicoDaOs(
  visitas: Array<{ status: string; completion_date: string | null; scheduled_date: string | null }>,
): string | null {
  const ativas = visitas.filter((v) => v.status !== "Cancelado");
  const concluidas = ativas
    .filter((v) => v.status === "Concluído" && v.completion_date)
    .map((v) => v.completion_date!.slice(0, 10))
    .sort();
  if (concluidas.length) return concluidas[concluidas.length - 1]!;
  const agendadas = ativas
    .map((v) => v.scheduled_date?.slice(0, 10))
    .filter((d): d is string => Boolean(d))
    .sort();
  return agendadas[0] ?? null;
}

/** Pedido de nota criado à mão (cliente pediu e a regra automática não criou): sempre Pendente. */
export function novoPedidoDeNota(a: {
  workOrderId: string;
  customerId: string | null;
  documento: string | null;
  valor: number;
  dataServico: string | null;
  hoje: string;
}) {
  return {
    work_order_id: a.workOrderId,
    customer_id: a.customerId,
    document_number: a.documento?.trim() || null,
    service_date: a.dataServico ?? a.hoje,
    invoice_amount: a.valor,
    status: "Pendente" as const,
  };
}

/** Cria o pedido só se a OS ainda não tiver nota (o botão some quando já existe). */
export async function pedirNota(pedido: ReturnType<typeof novoPedidoDeNota>) {
  const { data: existente } = await supabase
    .from("invoice_tasks")
    .select("id")
    .eq("work_order_id", pedido.work_order_id)
    .limit(1)
    .maybeSingle();
  if (existente) throw new Error("Esta OS já tem nota.");
  const { error } = await supabase.from("invoice_tasks").insert(pedido as never);
  if (error) throw new Error("Não foi possível criar o pedido de nota.");
}

export async function marcarSolicitada(id: string) {
  const { error } = await supabase
    .from("invoice_tasks")
    .update({ status: "Solicitada", solicitada_em: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function anexarNota(t: Pick<TarefaNota, "id" | "empresa_id">, arquivo: File) {
  const nomeSeguro = arquivo.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const caminho = `${t.empresa_id}/${t.id}/${Date.now()}-${nomeSeguro}`;
  const { error: upErr } = await supabase.storage.from(NOTA_BUCKET).upload(caminho, arquivo, {
    upsert: false,
    ...(arquivo.type ? { contentType: arquivo.type } : {}),
  });
  if (upErr) throw upErr;
  const { error } = await supabase
    .from("invoice_tasks")
    .update({ arquivo_path: caminho, arquivo_nome: arquivo.name })
    .eq("id", t.id);
  if (error) throw error;
}

/** Link temporário (10 min) para abrir/baixar o arquivo da nota. */
export async function linkArquivoNota(caminho: string, baixar = false) {
  const { data, error } = await supabase.storage
    .from(NOTA_BUCKET)
    .createSignedUrl(caminho, 600, baixar ? { download: true } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
