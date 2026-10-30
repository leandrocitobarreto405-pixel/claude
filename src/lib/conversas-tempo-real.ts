/**
 * Tempo real das conversas: ouve o canal privado "empresa:<id>" (o banco manda um aviso curto a
 * cada mudança em whatsapp_messages e conversas, ver migração 20261125120000) e manda as telas
 * recarregarem. Funciona para quem tem várias empresas, porque a permissão é por canal, não pelo
 * cabeçalho x-empresa-id. O refetch periódico continua como garantia. O mesmo canal traz a
 * presença de colegas nas conversas (evento "presenca", mandado pelo servidor). As recargas têm
 * freio (uma a cada 3 s no mínimo, mais com o banco lento), nunca cancelam nem repetem uma recarga
 * em andamento e esperam a aba aparecer.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEmpresaAtiva } from "@/lib/empresa-ativa";
import { registrarPresenca } from "@/lib/presenca";
import { esperaPara } from "@/lib/ritmo";

/** Chaves que mudam quando chega mensagem: lista, conversa aberta, estado da resposta, Alice. */
export const CHAVES_TEMPO_REAL = [["conversas"], ["alice_resumo_hoje"]] as const;

/** Intervalo mínimo entre duas recargas pelo tempo real (cresce com o banco lento, até 1 min). */
export const RECARGA_MINIMA_MS = 3_000;

/** Nome do canal privado da empresa (a política em realtime.messages confere o vínculo). */
export function canalDaEmpresa(empresaId: string) {
  return `empresa:${empresaId}`;
}

/**
 * Recarga com freio: no máximo uma a cada `minimo()` ms; se a anterior ainda não respondeu, não
 * repete (espera ela terminar); com a aba escondida, deixa para quando ela voltar a aparecer.
 */
export function recargaComFreio(o: {
  recarregar: () => void;
  ocupado: () => boolean;
  visivel: () => boolean;
  minimo: () => number;
  agora?: () => number;
}) {
  const agora = o.agora ?? Date.now;
  let ultima = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendente = false;
  const tentar = () => {
    timer = null;
    if (!o.visivel()) {
      pendente = true;
      return;
    }
    const falta = ultima + o.minimo() - agora();
    if (o.ocupado() || falta > 0) {
      timer = setTimeout(tentar, Math.max(falta, 1_000));
      return;
    }
    pendente = false;
    ultima = agora();
    o.recarregar();
  };
  return {
    /** Chegou aviso de mudança. */
    avisar() {
      pendente = true;
      if (!timer) timer = setTimeout(tentar, 250);
    },
    /** A aba voltou a aparecer: recarrega se ficou algo pendente. */
    voltou() {
      if (pendente && !timer) timer = setTimeout(tentar, 250);
    },
    parar() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// Um canal só por empresa, mesmo com a lista e a conversa abertas ao mesmo tempo.
const assinaturas = new Map<string, { usos: number; sair: () => void }>();

export function useTempoRealConversas(ativo = true) {
  const qc = useQueryClient();
  const empresaId = getEmpresaAtiva();
  useEffect(() => {
    if (!ativo || !empresaId) return;
    const existente = assinaturas.get(empresaId);
    if (existente) {
      existente.usos++;
    } else {
      const freio = recargaComFreio({
        // Sem cancelar a recarga em andamento: com o banco lento, cancelar e refazer vira fila.
        recarregar: () => {
          for (const chave of CHAVES_TEMPO_REAL)
            void qc.invalidateQueries({ queryKey: [...chave] }, { cancelRefetch: false });
        },
        ocupado: () => CHAVES_TEMPO_REAL.some((c) => qc.isFetching({ queryKey: [...c] }) > 0),
        visivel: () => typeof document === "undefined" || !document.hidden,
        minimo: () => esperaPara(RECARGA_MINIMA_MS),
      });
      const aoVoltar = () => freio.voltou();
      document.addEventListener("visibilitychange", aoVoltar);
      const canal = supabase
        .channel(canalDaEmpresa(empresaId), { config: { private: true } })
        .on("broadcast", { event: "mudou" }, () => freio.avisar())
        .on("broadcast", { event: "presenca" }, (m) => registrarPresenca(m["payload"]));
      // Canal privado exige o JWT da pessoa no Realtime antes de entrar.
      void supabase.realtime.setAuth().then(() => canal.subscribe());
      assinaturas.set(empresaId, {
        usos: 1,
        sair: () => {
          freio.parar();
          document.removeEventListener("visibilitychange", aoVoltar);
          void supabase.removeChannel(canal);
        },
      });
    }
    return () => {
      const a = assinaturas.get(empresaId);
      if (!a) return;
      a.usos--;
      if (a.usos <= 0) {
        a.sair();
        assinaturas.delete(empresaId);
      }
    };
  }, [ativo, qc, empresaId]);
}
