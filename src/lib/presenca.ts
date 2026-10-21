/**
 * Presença de colegas na conversa (item 4, duas atendentes): quem está com a conversa aberta na
 * tela agora. Cada pessoa avisa pelo servidor ("aqui" ao abrir e a cada 25 s, "saiu" ao fechar);
 * o aviso chega a todos pelo canal privado da empresa no Realtime e fica só na memória da aba.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  INTERVALO_PRESENCA_MS,
  aplicarPresenca,
  colegasPresentes,
  type AvisoPresenca,
  type Presenca,
} from "@/lib/caixa-equipe";
import { presencaFn } from "@/lib/caixa-equipe.functions";

const VAZIA: Presenca[] = [];
let porConversa = new Map<string, Presenca[]>();
const ouvintes = new Set<() => void>();

/** Chamado pelo canal do Realtime a cada aviso de presença. */
export function registrarPresenca(aviso: unknown) {
  const a = (aviso && typeof aviso === "object" ? aviso : {}) as Partial<AvisoPresenca>;
  if (typeof a.conversaId !== "string" || typeof a.userId !== "string") return;
  const limpo: AvisoPresenca = {
    conversaId: a.conversaId,
    userId: a.userId,
    nome: typeof a.nome === "string" && a.nome ? a.nome : "Colega",
    estado: a.estado === "saiu" ? "saiu" : "aqui",
  };
  const proxima = new Map(porConversa);
  proxima.set(
    limpo.conversaId,
    aplicarPresenca(porConversa.get(limpo.conversaId) ?? [], limpo, Date.now()),
  );
  porConversa = proxima;
  for (const f of ouvintes) f();
}

function assinar(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

/** Colegas (sem mim) com esta conversa aberta agora; relê a cada 10 s para os ausentes sumirem. */
export function useColegasNaConversa(conversaId: string, meuId: string | null): Presenca[] {
  const lista = useSyncExternalStore(
    assinar,
    () => porConversa.get(conversaId) ?? VAZIA,
    () => VAZIA,
  );
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(
    () => (meuId ? colegasPresentes(lista, meuId, agora) : VAZIA),
    [lista, meuId, agora],
  );
}

/** Avisa que estou nesta conversa enquanto a tela está aberta e visível. */
export function useAvisarPresenca(conversaId: string | undefined) {
  const fn = useServerFn(presencaFn);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!conversaId) return;
    const avisar = (estado: "aqui" | "saiu") =>
      void fnRef.current({ data: { conversaId, estado } }).catch(() => undefined);
    const seVisivel = () => {
      if (document.visibilityState === "visible") avisar("aqui");
    };
    seVisivel();
    const t = setInterval(seVisivel, INTERVALO_PRESENCA_MS);
    const aoMudar = () => avisar(document.visibilityState === "visible" ? "aqui" : "saiu");
    document.addEventListener("visibilitychange", aoMudar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoMudar);
      avisar("saiu");
    };
  }, [conversaId]);
}
