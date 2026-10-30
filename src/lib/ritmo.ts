/**
 * Ritmo das atualizações automáticas das telas. O app mede quanto cada consulta demora: com o banco
 * lento (resposta acima de 3 s) ou com erro, as atualizações automáticas e as recargas do tempo
 * real esperam cada vez mais (o dobro a cada sinal, até 1 min); quando as respostas voltam a ser
 * rápidas, voltam ao intervalo de sempre. Assim uma lentidão do banco não vira uma fila de
 * chamadas repetidas.
 */
import type { QueryClient } from "@tanstack/react-query";

export const LENTO_MS = 3_000;
export const RAPIDO_MS = 1_000;
export const MAXIMO_MS = 60_000;
const FATOR_MAXIMO = 32;

let fator = 1;

/** Registra uma resposta: lenta ou com erro dobra a espera; rápida volta aos poucos ao normal. */
export function registrarResposta(ms: number, erro: boolean): void {
  if (erro || ms > LENTO_MS) fator = Math.min(fator * 2, FATOR_MAXIMO);
  else if (ms < RAPIDO_MS) fator = Math.max(1, fator / 2);
}

export const fatorAtual = () => fator;

/** Só para os testes. */
export function zerarRitmo(): void {
  fator = 1;
}

/**
 * Espera para um intervalo-base: o próprio intervalo com o banco normal; com lentidão, o intervalo
 * vezes o fator, até 1 min (um intervalo-base maior que 1 min fica como está).
 */
export function esperaPara(baseMs: number): number {
  if (fator <= 1) return baseMs;
  return Math.max(baseMs, Math.min(MAXIMO_MS, baseMs * fator));
}

/** Para `refetchInterval`: o intervalo-base ajustado ao ritmo do momento. */
export const intervalo = (baseMs: number) => () => esperaPara(baseMs);

/** Mede a duração de cada consulta do app (só no navegador). */
export function medirConsultas(qc: QueryClient): () => void {
  const inicio = new Map<string, number>();
  return qc.getQueryCache().subscribe((ev) => {
    if (ev.type !== "updated") return;
    const tipo = ev.action.type;
    const chave = ev.query.queryHash;
    if (tipo === "fetch") inicio.set(chave, Date.now());
    else if (tipo === "success" || tipo === "error") {
      const t0 = inicio.get(chave);
      inicio.delete(chave);
      if (t0 !== undefined) registrarResposta(Date.now() - t0, tipo === "error");
    }
  });
}
