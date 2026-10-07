/** Fila de envios do app (uma só, para todas as telas) e os ganchos de tela. */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { fetchDireto } from "@/lib/enderecos";
import {
  ErroConexao,
  criarFila,
  pedacoPorXhr,
  type Dependencias,
  type Envio,
  type Fila,
} from "@/lib/envio-midia";
import {
  abrirEnvioMidiaFn,
  registrarEnvioMidiaFn,
  situacaoEnvioMidiaFn,
  uploadOsMedia,
} from "@/lib/os-media.functions";

/** Erro de rede (sem resposta) vira ErroConexao; o resto passa com a mensagem do servidor. */
async function semRede<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message))
      throw new ErroConexao(e.message);
    throw e;
  }
}

const deps: Dependencias = {
  abrir: (e) =>
    semRede(async () => {
      const r = await abrirEnvioMidiaFn({
        fetch: fetchDireto,
        data: {
          workOrderId: e.workOrderId,
          destination: e.destino,
          nome: e.nome,
          tipo: e.tipo,
          tamanho: e.tamanho,
          origem: window.location.origin,
        },
      });
      return r.sessao;
    }),
  situacao: (sessao, tamanho) =>
    semRede(() => situacaoEnvioMidiaFn({ fetch: fetchDireto, data: { sessao, tamanho } })),
  registrar: (e, fileId) =>
    semRede(async () => {
      await registrarEnvioMidiaFn({
        fetch: fetchDireto,
        data: { workOrderId: e.workOrderId, destination: e.destino, fileId },
      });
    }),
  reserva: (e) =>
    semRede(async () => {
      const form = new FormData();
      form.set("workOrderId", e.workOrderId);
      form.set("destination", e.destino);
      form.set("file", e.arquivo);
      await uploadOsMedia({ fetch: fetchDireto, data: form });
    }),
  pedaco: pedacoPorXhr,
  online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  guardar: (chave, sessao) => {
    try {
      if (sessao) localStorage.setItem(chave, JSON.stringify({ sessao, em: Date.now() }));
      else localStorage.removeItem(chave);
    } catch {
      /* sem armazenamento: só não continua depois de recarregar */
    }
  },
  lembrar: (chave) => {
    try {
      const v = JSON.parse(localStorage.getItem(chave) ?? "null") as {
        sessao: string;
        em: number;
      } | null;
      // O Google guarda o envio por uma semana; aqui, até 6 dias.
      return v && Date.now() - v.em < 6 * 86_400_000 ? v.sessao : null;
    } catch {
      return null;
    }
  },
};

let fila: Fila | null = null;
export function filaDeEnvios(): Fila {
  if (!fila) {
    fila = criarFila(deps);
    if (typeof window !== "undefined") {
      // Avisa antes de fechar a página com envio em andamento.
      window.addEventListener("beforeunload", (ev) => {
        if (!fila?.emAndamento()) return;
        ev.preventDefault();
        ev.returnValue = "";
      });
    }
  }
  return fila;
}

const vazio: Envio[] = [];

/** Envios da fila (todos ou só de uma OS). */
export function useEnvios(workOrderId?: string): Envio[] {
  const lista = useSyncExternalStore(
    (fn) => filaDeEnvios().ouvir(fn),
    () => filaDeEnvios().lista(),
    () => vazio,
  );
  return workOrderId ? lista.filter((e) => e.workOrderId === workOrderId) : lista;
}

/** Chama `aoTerminar` sempre que mais um arquivo da OS fica pronto (para recarregar a lista). */
export function useAoTerminarEnvio(workOrderId: string | undefined, aoTerminar: () => void) {
  const envios = useEnvios(workOrderId);
  const prontos = envios.filter((e) => e.estado === "pronto").length;
  const anterior = useRef(prontos);
  const fn = useRef(aoTerminar);
  fn.current = aoTerminar;
  useEffect(() => {
    if (prontos > anterior.current) fn.current();
    anterior.current = prontos;
  }, [prontos]);
}
