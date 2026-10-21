/**
 * Tempo real das conversas: ouve o canal privado "empresa:<id>" (o banco manda um aviso curto a
 * cada mudança em whatsapp_messages e conversas, ver migração 20261125120000) e manda as telas
 * recarregarem. Funciona para quem tem várias empresas, porque a permissão é por canal, não pelo
 * cabeçalho x-empresa-id. O refetch periódico continua como garantia.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEmpresaAtiva } from "@/lib/empresa-ativa";

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

/** Nome do canal privado da empresa (a política em realtime.messages confere o vínculo). */
export function canalDaEmpresa(empresaId: string) {
  return `empresa:${empresaId}`;
}

export function useTempoRealConversas(ativo = true) {
  const qc = useQueryClient();
  const empresaId = getEmpresaAtiva();
  useEffect(() => {
    if (!ativo || !empresaId) return;
    const recarregar = agrupador(() => {
      for (const chave of CHAVES_TEMPO_REAL) void qc.invalidateQueries({ queryKey: [...chave] });
    });
    const canal = supabase
      .channel(canalDaEmpresa(empresaId), { config: { private: true } })
      .on("broadcast", { event: "mudou" }, recarregar);
    // Canal privado exige o JWT da pessoa no Realtime antes de entrar.
    void supabase.realtime.setAuth().then(() => canal.subscribe());
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [ativo, qc, empresaId]);
}
