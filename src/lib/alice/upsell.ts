/**
 * Upsell depois do agendamento (26/10/2026): itens a mais no mesmo atendimento com o desconto de
 * item adicional da empresa sobre a tabela, e a conferência de que o atendimento ainda cabe antes
 * do próximo serviço do mesmo técnico no dia. Funções puras.
 */
import { ehColchao } from "@/lib/dupla-face";

/**
 * Preço do item adicional: tabela − desconto, terminando em ,90 para baixo (como a tabela).
 * Ex.: R$ 249,90 − 20% = R$ 199,92 → R$ 199,90.
 */
export function precoUpsell(precoTabela: number, pct: number): number {
  const v = Math.round(Number(precoTabela) * (1 - pct / 100) * 100) / 100;
  if (!(v > 1)) return Math.max(0, v);
  const inteiro = Math.floor(v);
  return v + 1e-9 >= inteiro + 0.9 ? inteiro + 0.9 : inteiro - 0.1;
}

/** Duração de referência (agenda e upsell): sofá e estofados 3 h, colchão 1h30, cadeira 15 min. */
export function duracaoDoItem(descricao: string, quantidade: number): number {
  const q = Math.max(1, Math.round(Number(quantidade) || 1));
  if (/cadeira/i.test(descricao) && !/gamer/i.test(descricao)) return 15 * q;
  if (ehColchao(descricao)) return 90 * q;
  return 180 * q;
}

export function duracaoDoAtendimento(itens: Array<{ descricao: string; quantidade: number }>) {
  return itens.reduce((s, i) => s + duracaoDoItem(i.descricao, i.quantidade), 0);
}

const minutos = (hora: string) => {
  const [h, m] = hora.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const hhmm = (min: number) =>
  `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;

/** Cabe antes do próximo serviço do mesmo técnico no dia? (sem próximo: cabe). */
export function cabeNoHorario(
  inicio: string,
  duracaoMin: number,
  proximo: string | null,
): { cabe: boolean; termina: string; texto: string } {
  const fim = minutos(inicio) + duracaoMin;
  const termina = hhmm(fim);
  if (!proximo) return { cabe: true, termina, texto: `termina por volta das ${termina}` };
  const cabe = fim <= minutos(proximo);
  return {
    cabe,
    termina,
    texto: cabe
      ? `termina por volta das ${termina}, antes do próximo serviço do técnico (${hhmm(minutos(proximo))})`
      : `passaria a terminar por volta das ${termina}, e o técnico tem outro serviço às ${hhmm(minutos(proximo))}`,
  };
}
