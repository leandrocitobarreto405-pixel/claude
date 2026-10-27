/**
 * Orçamentos sem desfecho (regras puras, sem banco): os motivos padrão da aba e a sugestão da
 * Alice a partir do motivo que ela registra na conversa. Quem confirma é a equipe, com um clique.
 */
import type { MotivoPerda } from "@/lib/alice/regras";

/** Os 11 motivos padrão (os nomes são os da migração 20261228150000; cada empresa edita). */
export const MOTIVOS_SEM_DESFECHO = [
  "Agenda cheia",
  "Preço alto – fechou com outra empresa",
  "Preço alto – desistiu/adiou",
  "Fechou com outra empresa (motivo não informado)",
  "Não respondeu depois dos follow-ups",
  "Adiou",
  "Fora da área",
  "Não precisa mais",
  "Só cotando",
  "Serviço que não fazemos",
  "Duplicado/teste",
] as const;
export type MotivoSemDesfecho = (typeof MOTIVOS_SEM_DESFECHO)[number];

/** Motivos que a Alice pode sugerir (duplicado/teste é só da equipe). */
export const SUGESTOES_DA_ALICE = MOTIVOS_SEM_DESFECHO.filter((m) => m !== "Duplicado/teste");

const FALOU_DE_OUTRA =
  /outr[ao] (empresa|pessoa|lugar|profissional)|concorr|já fechei|ja fechei|fechei com/i;
const FALOU_DE_PRECO = /pre[cç]o|caro|barat|valor|or[cç]amento menor|mais em conta/i;

/**
 * Sugestão da Alice: usa a escolhida por ela (se for da lista) ou traduz o motivo antigo da
 * ferramenta, olhando o que o cliente disse para separar "preço alto" de "outra empresa".
 */
export function sugestaoDaAlice(
  motivo: MotivoPerda,
  detalhe?: string | null,
  escolhida?: string | null,
): MotivoSemDesfecho {
  if (escolhida && (SUGESTOES_DA_ALICE as readonly string[]).includes(escolhida))
    return escolhida as MotivoSemDesfecho;
  const d = detalhe ?? "";
  switch (motivo) {
    case "Preço":
      return FALOU_DE_OUTRA.test(d)
        ? "Preço alto – fechou com outra empresa"
        : "Preço alto – desistiu/adiou";
    case "Fechou com outra empresa":
      return FALOU_DE_PRECO.test(d)
        ? "Preço alto – fechou com outra empresa"
        : "Fechou com outra empresa (motivo não informado)";
    case "Adiou":
      return "Adiou";
    case "Fora da área":
      return "Fora da área";
    case "Não precisa mais":
      return "Não precisa mais";
    case "Sumiu sem responder":
      return "Não respondeu depois dos follow-ups";
  }
}

/** Rótulo do serviço do relatório (tipo do item do orçamento). */
export function rotuloServico(s: string | null | undefined): string {
  return (
    (s ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) =>
        x === "higienizacao" ? "Higienização" : x === "impermeabilizacao" ? "Impermeabilização" : x,
      )
      .join(" + ") || "Sem serviço"
  );
}
