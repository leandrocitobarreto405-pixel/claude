import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ConfigKind =
  | "sales_origin"
  | "service_type"
  | "upholstery_type"
  | "payment_method"
  | "payment_channel"
  | "expense_category"
  | "adjustment_reason"
  | "recurrence_reason";

export type ConfigOption = {
  id: string;
  kind: string;
  name: string;
  active: boolean;
  display_order: number;
};

export function useConfigOptions(kind: ConfigKind, onlyActive = true) {
  return useQuery({
    queryKey: ["config_options", kind, onlyActive],
    queryFn: async () => {
      let q = supabase
        .from("config_options")
        .select("id, kind, name, active, display_order")
        .eq("kind", kind)
        .order("display_order");
      if (onlyActive) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ConfigOption[];
    },
  });
}

export type Salesperson = {
  id: string;
  name: string;
  commission_percentage: number;
  active: boolean;
  effective_from: string;
};

export function useSalespeople(onlyActive = true) {
  return useQuery({
    queryKey: ["salespeople", onlyActive],
    queryFn: async () => {
      let q = supabase
        .from("salespeople")
        .select("id, name, commission_percentage, active, effective_from")
        .order("display_order");
      if (onlyActive) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Salesperson[];
    },
  });
}

export type Technician = {
  id: string;
  name: string;
  email: string | null;
  base_address: string | null;
  vehicle: string | null;
  include_return: boolean;
  active: boolean;
};

export function useTechnicians(onlyActive = true) {
  return useQuery({
    queryKey: ["technicians", onlyActive],
    queryFn: async () => {
      let q = supabase
        .from("technicians")
        .select("id, name, email, base_address, vehicle, include_return, active")
        .order("display_order");
      if (onlyActive) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Technician[];
    },
  });
}

export type PaymentRate = {
  id: string;
  channel: string;
  payment_type: string;
  installments: number;
  rate_percent: number;
  active: boolean;
  effective_from: string;
};

export function usePaymentRates(onlyActive = true) {
  return useQuery({
    queryKey: ["payment_rates", onlyActive],
    queryFn: async () => {
      let q = supabase
        .from("payment_rates")
        .select("id, channel, payment_type, installments, rate_percent, active, effective_from")
        .order("channel")
        .order("payment_type")
        .order("installments");
      if (onlyActive) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PaymentRate[];
    },
  });
}

export function findRate(
  rates: PaymentRate[] | undefined,
  channel: string,
  type: string,
  installments: number,
): number {
  if (!rates) return 0;
  const exact = rates.find(
    (r) => r.channel === channel && r.payment_type === type && r.installments === installments,
  );
  if (exact) return Number(exact.rate_percent);
  const fallback = rates.find((r) => r.channel === channel && r.payment_type === type);
  return fallback ? Number(fallback.rate_percent) : 0;
}

export function useSetting<T>(key: string, fallback: T) {
  return useQuery({
    queryKey: ["app_settings", key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return ((data?.value as T) ?? fallback) as T;
    },
  });
}

export async function saveSetting(key: string, value: unknown) {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key, value: value as never, updated_at: new Date().toISOString() },
      { onConflict: "empresa_id,key" },
    );
  if (error) throw error;
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => {
    for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
  };
}

export const VISIT_STATUSES = [
  "Agendado",
  "Confirmado",
  "Em deslocamento",
  "Em execução",
  "Concluído",
  "Reagendado",
  "Reagendado com deslocamento",
  "Cancelado",
] as const;

export const RESCHEDULE_REASONS = [
  "Cliente ausente",
  "Cliente pediu para remarcar",
  "Acesso ao imóvel não liberado",
  "Estofado não estava disponível",
  "Falta de água ou energia no local",
  "Condições climáticas",
  "Problema com equipamento",
  "Outro motivo",
] as const;

export const OS_STATUSES = [
  "Agendada",
  "Parcialmente concluída",
  "Concluída",
  "Cancelada",
  "Reagendada",
] as const;

export const PAYMENT_STATUSES = [
  "Não pago",
  "Parcialmente pago",
  "Pago",
  "Estornado",
  "Cancelado",
] as const;

export const INVOICE_STATUSES = ["Pendente", "Emitida", "Cancelada", "Não necessária"] as const;

export const EXPENSE_STATUSES = [
  "Pendente",
  "Pago",
  "Parcialmente pago",
  "Vencido",
  "Cancelado",
] as const;

export const PAYMENT_CHANNELS = [
  "Pix direto",
  "Dinheiro",
  "Transferência",
  "Maquininha",
  "Link de pagamento",
  "Outro",
] as const;

export const PAYMENT_TYPES = [
  "Pix",
  "Dinheiro",
  "Débito",
  "Crédito",
  "Transferência",
  "Outro",
] as const;

export const DEFAULT_MESSAGE_TEMPLATE = `{{dia_da_semana}}, {{data}}, às {{horario}}

OS {{numero_os}}
{{nome_cliente}}

{{descricao_estofado}}

Serviço: {{servico}}

Endereço:
{{endereco_completo}}

{{INSTRUCAO_PAGAMENTO}}`;
