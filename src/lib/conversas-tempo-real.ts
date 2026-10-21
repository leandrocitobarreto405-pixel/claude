/**
 * Tempo real das conversas: assina as mudanças de whatsapp_messages e conversas (Realtime do
 * Supabase, filtrado pelo RLS da empresa) e manda as telas recarregarem. O refetch periódico
 * continua como garantia: quem tem várias empresas (Nexa) não recebe eventos, porque o RLS do
 * Realtime não tem o cabeçalho x-empresa-id.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Junta eventos que chegam em rajada (webhook + gravação do app) num só recarregamento. */
export function agrupador(exec: () => void, esperaMs = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      exec();
    }, esperaMs);
  };
}

/** Chaves que mudam quando chega mensagem: lista, conversa aberta, estado da resposta, Alice. */
export const CHAVES_TEMPO_REAL = [["conversas"], ["alice_resumo_hoje"]] as const;

export function useTempoRealConversas(ativo = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!ativo) return;
    const recarregar = agrupador(() => {
      for (const chave of CHAVES_TEMPO_REAL) void qc.invalidateQueries({ queryKey: [...chave] });
    });
    const canal = supabase
      .channel("caixa-de-entrada")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages" },
        recarregar,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "conversas" }, recarregar)
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [ativo, qc]);
}
