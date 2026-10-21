// Enquanto a barra de resposta está em foco (teclado aberto) ou gravando, a barra de navegação
// inferior some: no iPhone ela subia junto com o teclado e ficava no meio da tela.
import { useSyncExternalStore } from "react";

let emFoco = false;
const ouvintes = new Set<() => void>();

export function marcarRespostaEmFoco(valor: boolean) {
  if (emFoco === valor) return;
  emFoco = valor;
  for (const f of ouvintes) f();
}

function assinar(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

export function useRespostaEmFoco() {
  return useSyncExternalStore(
    assinar,
    () => emFoco,
    () => false,
  );
}
