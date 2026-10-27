/**
 * Leitura do contexto antes de qualquer toque automático (regras puras). O histórico do cliente é
 * classificado pela IA barata; se ele já disse que fechou/vai fechar com outra empresa, achou mais
 * barato, já fez o serviço, não quer mais ou pediu para não receber, o toque NÃO sai e o lead vai
 * para "Sem desfecho" com o motivo sugerido (27/10: 4 dos 22 da retomada já tinham dito isso).
 */
export const CLASSES_CONTEXTO = [
  "segue",
  "fechou_outra",
  "mais_barato",
  "ja_fez",
  "nao_quer",
  "pediu_parar",
] as const;
export type ClasseContexto = (typeof CLASSES_CONTEXTO)[number];

export const ROTULO_CONTEXTO: Record<Exclude<ClasseContexto, "segue">, string> = {
  fechou_outra: "fechou ou vai fechar com outra empresa",
  mais_barato: "achou mais barato em outro lugar",
  ja_fez: "já fez o serviço",
  nao_quer: "não quer mais",
  pediu_parar: "pediu para não receber mensagens",
};

/** Motivo sugerido na aba "Sem desfecho" (nomes da migração 20261228150000). */
export const MOTIVO_DO_CONTEXTO: Record<Exclude<ClasseContexto, "segue">, string> = {
  fechou_outra: "Fechou com outra empresa (motivo não informado)",
  mais_barato: "Preço alto – fechou com outra empresa",
  ja_fez: "Fechou com outra empresa (motivo não informado)",
  nao_quer: "Não precisa mais",
  pediu_parar: "Não precisa mais",
};

/** Concorrente ou preço: vira tarefa urgente da equipe (tentar recuperar). */
export function ehConcorrencia(c: ClasseContexto): boolean {
  return c === "fechou_outra" || c === "mais_barato";
}

export const INSTRUCAO_CLASSIFICADOR = `Você lê o histórico de um atendimento de WhatsApp de uma empresa de higienização de estofados e responde SÓ um JSON.
Decida se a empresa ainda pode mandar um follow-up (lembrete do orçamento) para o cliente.
Classes:
- "fechou_outra": o cliente disse que fechou, agendou ou vai fazer com outra empresa/pessoa.
- "mais_barato": disse que achou mais barato/tem orçamento menor em outro lugar.
- "ja_fez": disse que já fez/resolveu o serviço.
- "nao_quer": disse que não quer/não precisa mais, desistiu ou não vai fazer.
- "pediu_parar": pediu para não receber mais mensagens.
- "segue": nada disso (inclui "vou pensar", "depois eu vejo", "agora não dá", "vou ver com meu marido", dúvidas, sem resposta).
Só conta o que o CLIENTE escreveu (linhas "cliente:"), e só se ele não voltou atrás depois (ex.: disse que fechou com outra e depois pediu orçamento de novo → "segue").
Formato: {"classe": "<classe>", "trecho": "<até 120 caracteres do que o cliente disse, ou vazio>"}`;

/** Texto do histórico para o classificador (mais antigas primeiro, só texto). */
export function historicoParaClassificar(
  msgs: { direcao: string; texto: string | null; quando: string }[],
): string {
  return msgs
    .filter((m) => (m.texto ?? "").trim())
    .map(
      (m) =>
        `${m.quando.slice(0, 10)} ${m.direcao === "Recebida" ? "cliente" : "empresa"}: ${(m.texto ?? "").replace(/\s+/g, " ").slice(0, 400)}`,
    )
    .join("\n");
}

/** Lê a resposta da IA; qualquer coisa estranha vira "segue" (na dúvida, não bloqueia). */
export function lerClassificacao(texto: string): { classe: ClasseContexto; trecho: string } {
  const m = /\{[\s\S]*\}/.exec(texto);
  try {
    const j = JSON.parse(m?.[0] ?? "{}") as { classe?: string; trecho?: string };
    const classe = (CLASSES_CONTEXTO as readonly string[]).includes(j.classe ?? "")
      ? (j.classe as ClasseContexto)
      : "segue";
    return { classe, trecho: String(j.trecho ?? "").slice(0, 160) };
  } catch {
    return { classe: "segue", trecho: "" };
  }
}
