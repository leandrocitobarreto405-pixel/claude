/**
 * Toques da equipe na trilha A (05/11): o 3 (manhã do dia seguinte) e o 4 (horário da sequência)
 * não saem pela Alice; viram tarefa da atendente com a mensagem pronta. No 3, a atendente se
 * apresenta ("Aqui é a Maria, da equipe da …"); nos dois, nunca condição nem desconto novo (se já
 * houve desconto, só lembrar o valor já passado) e uma pergunta simples no fim.
 */

export type EntradaToqueEquipe = {
  /** A3/A4: toques da equipe na trilha A; VC: "voltar na conversa" (a equipe entrou no meio). */
  etapa: "A3" | "A4" | "VC";
  nomeCliente: string | null;
  atendente: string | null;
  empresa: string;
};

/** Abertura obrigatória do 3: a atendente se apresenta e diz que a Alice passou o orçamento. */
export function aberturaDoToque(e: EntradaToqueEquipe): string {
  const oi = e.nomeCliente ? `Oi, ${e.nomeCliente}, tudo bem?` : "Oi, tudo bem?";
  if (e.etapa !== "A3") return e.nomeCliente ? `Oi, ${e.nomeCliente}!` : "Oi!";
  const quem = e.atendente
    ? `Aqui é a ${e.atendente}, da equipe da ${e.empresa}.`
    : `Aqui é da equipe da ${e.empresa}.`;
  return `${oi} ${quem} A Alice me passou seu orçamento`;
}

/** Mensagem pronta sem IA (quando a escrita falha ou sai fora das regras). */
export function mensagemReserva(e: EntradaToqueEquipe): string {
  if (e.etapa === "A3")
    return `${aberturaDoToque(e)} e eu queria te ajudar a escolher o melhor dia pro serviço. Qual dia da semana fica melhor pra você?`;
  if (e.etapa === "VC")
    return `${aberturaDoToque(e)} Passei aqui pra gente continuar de onde paramos. Quer que eu já veja um horário pra você?`;
  return `${aberturaDoToque(e)} Seu orçamento vence amanhã. Quer que eu já reserve um horário pra você?`;
}

const PROIBIDAS =
  /ficou (alguma|com alguma) d[uú]vida|alguma d[uú]vida\?|condi[cç][aã]o (melhor|especial|diferenciada)|consigo (um|uma) (desconto|condi)|ver com (a equipe|o gestor|meu gestor|o meu gestor)|passando (pra|para) saber|est[aá] a[ií]\?/i;

/** Confere a mensagem escrita: abertura certa no 3, sem frase proibida, uma pergunta só no fim. */
export function mensagemValida(texto: string, e: EntradaToqueEquipe): boolean {
  const t = texto.trim();
  if (!t || t.length > 700) return false;
  if (PROIBIDAS.test(t)) return false;
  if (/\[|\]|\{\{|R\$\s*_+/.test(t)) return false;
  const abertura = aberturaDoToque(e);
  if (e.etapa === "A3" && !t.startsWith(abertura)) return false;
  const depois = e.etapa === "A3" ? t.slice(abertura.length) : t;
  return depois.trim().endsWith("?") && (depois.match(/\?/g) ?? []).length === 1;
}

export function instrucoesToqueEquipe(e: EntradaToqueEquipe): string {
  const abertura = aberturaDoToque(e);
  return [
    `Você escreve a mensagem de WhatsApp que ${e.atendente ?? "a atendente"}, da equipe da ${e.empresa} (limpeza de estofados), vai copiar e mandar a um cliente que recebeu o orçamento e parou de responder.`,
    e.etapa === "A3"
      ? `Comece EXATAMENTE com: "${abertura}" e continue a mesma frase de um jeito natural (ex.: "… e eu queria te ajudar a…"). Depois, no máximo mais uma frase curta e a pergunta.`
      : e.etapa === "VC"
        ? `Comece com "${abertura}". A equipe já está conversando com o cliente: retome do ponto em que a conversa parou (o que a equipe falou por último e o que o cliente respondeu), sem repetir o que já foi dito, e traga algo útil para ele decidir.`
        : `Comece com "${abertura}". Lembre com carinho que o orçamento vence amanhã e ofereça reservar um horário.`,
    "Cite algo específico da conversa (o item, o problema que o cliente contou). Tom humano e carinhoso, sem pressão. Até 3 frases curtas.",
    "Nunca ofereça condição, desconto ou valor novo. Se a conversa já teve desconto, só lembre o valor que já foi passado. Nunca invente prazo, horário ou preço que não estejam na conversa.",
    'Termine com UMA pergunta simples que leve ao próximo passo (ex.: "Qual dia da semana fica melhor pra você?"). Proibido: "ficou alguma dúvida", "passando pra saber", "está aí?", "condição melhor", "ver com a equipe/gestor".',
  ].join("\n");
}
