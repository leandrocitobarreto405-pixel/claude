/**
 * Estado da tela de conversas que precisa sobreviver à ida e volta entre a lista e a conversa:
 * a aba escolhida (guardada na sessão do navegador), se a conversa foi aberta a partir da lista
 * (para a seta e o gesto de voltar devolverem à mesma lista e rolagem), se é PC (lista e conversa
 * lado a lado) e a área visível do celular (com o teclado aberto, a tela da conversa encolhe junto).
 */
import { useEffect, useState, useSyncExternalStore } from "react";

export type AbaConversas = "precisam" | "minhas" | "alice" | "equipe" | "finalizadas";
const ABAS_VALIDAS: AbaConversas[] = ["precisam", "minhas", "alice", "equipe", "finalizadas"];
const CHAVE_ABA = "nexa.conversas.aba";

function lerAba(): AbaConversas | null {
  try {
    const v = sessionStorage.getItem(CHAVE_ABA);
    return ABAS_VALIDAS.includes(v as AbaConversas) ? (v as AbaConversas) : null;
  } catch {
    return null;
  }
}

let aba: AbaConversas | null = typeof window === "undefined" ? null : lerAba();
const ouvintesAba = new Set<() => void>();

export function escolherAba(nova: AbaConversas) {
  if (aba === nova) return;
  aba = nova;
  try {
    sessionStorage.setItem(CHAVE_ABA, nova);
  } catch {
    /* sem sessão do navegador: só nesta página */
  }
  for (const f of ouvintesAba) f();
}

/** Aba escolhida por último nesta sessão (null = ainda não escolheu: usa o padrão da lista). */
export function useAbaConversas(): AbaConversas | null {
  return useSyncExternalStore(
    (f) => {
      ouvintesAba.add(f);
      return () => {
        ouvintesAba.delete(f);
      };
    },
    () => aba,
    () => null,
  );
}

/** A conversa aberta veio da lista (aí voltar = história do navegador, com a rolagem de antes). */
let veioDaLista = false;
export function marcarAbertaPelaLista() {
  veioDaLista = true;
}
export function abertaPelaLista(): boolean {
  const v = veioDaLista;
  veioDaLista = false;
  return v;
}

const PC = "(min-width: 1024px)";

/** Tela larga (PC): lista e conversa lado a lado. */
export function useEhPc(): boolean {
  return useSyncExternalStore(
    (f) => {
      const m = window.matchMedia(PC);
      m.addEventListener("change", f);
      return () => m.removeEventListener("change", f);
    },
    () => window.matchMedia(PC).matches,
    () => false,
  );
}

/**
 * Área visível do celular. No iPhone, o teclado não encolhe a página: só a área visível. A tela
 * da conversa acompanha essa área, para a barra de cima e a de resposta ficarem sempre à vista.
 */
export function useAreaVisivel(): { topo: number; altura: number | null } {
  const [area, setArea] = useState<{ topo: number; altura: number | null }>({
    topo: 0,
    altura: null,
  });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () => setArea({ topo: Math.max(0, vv.offsetTop), altura: vv.height });
    medir();
    vv.addEventListener("resize", medir);
    vv.addEventListener("scroll", medir);
    return () => {
      vv.removeEventListener("resize", medir);
      vv.removeEventListener("scroll", medir);
    };
  }, []);
  return area;
}

const CHAVE_ROLAGEM = "nexa.conversas.rolagem.";

/**
 * Celular: guarda a rolagem da lista por aba e devolve ao voltar da conversa. `pronta` = a lista
 * já tem os cartões (antes disso não há altura para rolar).
 */
export function useRolagemDaLista(aba: string, pronta: boolean, ativa: boolean) {
  useEffect(() => {
    if (!ativa) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const guardar = () => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        try {
          sessionStorage.setItem(CHAVE_ROLAGEM + aba, String(Math.round(window.scrollY)));
        } catch {
          /* sem sessão do navegador */
        }
      }, 150);
    };
    window.addEventListener("scroll", guardar, { passive: true });
    return () => {
      window.removeEventListener("scroll", guardar);
      if (t) clearTimeout(t);
    };
  }, [aba, ativa]);
  useEffect(() => {
    if (!ativa || !pronta) return;
    let y = 0;
    try {
      y = Number(sessionStorage.getItem(CHAVE_ROLAGEM + aba) ?? 0);
    } catch {
      y = 0;
    }
    if (!y) return;
    // Repete por um instante: o roteador e as imagens podem mexer na rolagem logo depois.
    const ir = () => window.scrollTo(0, y);
    ir();
    const r = requestAnimationFrame(ir);
    const t1 = setTimeout(ir, 80);
    const t2 = setTimeout(ir, 250);
    return () => {
      cancelAnimationFrame(r);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // Só ao montar a lista ou trocar de aba (não a cada recarga dos dados).
  }, [aba, pronta, ativa]);
}
