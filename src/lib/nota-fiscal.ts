/**
 * Emissão de nota fiscal (sem emissão automática): monta a mensagem para o grupo que emite as
 * notas, controla a situação (Pendente → Solicitada → Emitida) e guarda o arquivo da nota no
 * Supabase Storage (bucket "notas-fiscais", pasta = empresa).
 */
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";

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
  } | null;
};

export const TAREFA_NOTA_SELECT = `
  id, empresa_id, status, invoice_amount, invoice_number, issue_date, service_date, document_number,
  solicitada_em, arquivo_path, arquivo_nome,
  work_order:work_order_id ( id, os_number, total_gross_value, negotiated_payment_method, negotiated_installments,
    customer:customer_id ( full_name, document_number, email ),
    payments ( payment_type, payment_channel, installments, payment_status, is_active ) )
`;

/** Forma de pagamento da OS: a efetivamente recebida; sem pagamento lançado, a combinada. */
export function formaPagamento(t: TarefaNota): string | null {
  const pagos = (t.work_order?.payments ?? []).filter(
    (p) => p.is_active !== false && p.payment_status === "Pago",
  );
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

export function montarMensagemNota(template: string | null | undefined, d: DadosNota): string {
  const modelo = (template && template.trim()) || DEFAULT_NOTA_TEMPLATE;
  return modelo.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave: string) => {
    const valor = (d as Record<string, string | null>)[chave];
    return valor === undefined ? `{{${chave}}}` : valor || "não informado";
  });
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
