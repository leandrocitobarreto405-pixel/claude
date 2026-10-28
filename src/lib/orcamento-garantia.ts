/**
 * Valor garantido do orçamento (28/10, serviço para data futura): o cliente só pode fazer daqui a
 * mais de 2 semanas e a empresa guarda o valor até uma data. A mensagem e o PDF do orçamento mostram
 * "Valor garantido até dd/mm" no lugar da validade em dias. Sem banco, para poder testar.
 */

/** Até quantos dias à frente o valor pode ficar garantido. */
export const GARANTIA_MAX_DIAS = 90;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere a data (AAAA-MM-DD): de amanhã até 90 dias depois de hoje. */
export function dataDaGarantia(data: string, hoje: string): { data: string } | { erro: string } {
  if (!DATA.test(data) || Number.isNaN(Date.parse(`${data}T12:00:00Z`)))
    return { erro: "Data inválida; use AAAA-MM-DD." };
  const dias = Math.round(
    (Date.parse(`${data}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000,
  );
  if (dias < 1) return { erro: "A data precisa ser depois de hoje." };
  if (dias > GARANTIA_MAX_DIAS) return { erro: `No máximo ${GARANTIA_MAX_DIAS} dias à frente.` };
  return { data };
}

/** "Valor garantido até 15/12". */
export function textoGarantia(data: string): string {
  return `Valor garantido até ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

/**
 * Texto da mensagem com a garantia: a linha do modelo que fala da validade em dias ({validade}) vira
 * "Valor garantido até dd/mm." Sem garantia, o modelo fica como está.
 */
export function comGarantia(modelo: string, garantia: string | null | undefined): string {
  if (!garantia) return modelo;
  const linha = `${textoGarantia(garantia)}.`;
  const linhas = modelo.split("\n");
  return linhas.some((l) => l.includes("{validade}"))
    ? linhas.map((l) => (l.includes("{validade}") ? linha : l)).join("\n")
    : `${modelo}\n${linha}`;
}
