/**
 * "Precisa de você" (item F): o que depende da atendente hoje, em ordem de urgência. Só a parte
 * pura (tipos, filtro por pessoa, ordem e textos); a leitura do banco fica em
 * precisa-de-voce.functions.ts.
 */

export type SecaoPrecisa = "urgente" | "esperando" | "lead_site" | "followup";

export const ORDEM_SECOES: SecaoPrecisa[] = ["urgente", "esperando", "lead_site", "followup"];

export const TITULO_SECAO: Record<SecaoPrecisa, string> = {
  urgente: "Urgente",
  esperando: "Clientes esperando resposta",
  lead_site: "Leads do site que não chamaram",
  followup: "Follow-ups de hoje da equipe",
};

export type ItemPrecisa = {
  /** Única na lista (secao:id). */
  chave: string;
  secao: SecaoPrecisa;
  /** Nome do cliente (ou "Cliente"). */
  nome: string;
  detalhe: string;
  /** Desde quando (espera, cadastro, aviso) ou horário do follow-up. */
  quando: string | null;
  conversaId: string | null;
  /** Lead do CRM (destino em um clique). */
  leadId: string | null;
  /** Usuário dono (conversa assumida/atribuída ou follow-up atribuído); null = sem dono. */
  donoUserId: string | null;
  /** Aviso urgente (mkt_avisos) a marcar como resolvido. */
  avisoId?: string;
  /** Follow-up da equipe (crm_followups). */
  followupId?: string;
  /** Lead do site (leads_site). */
  leadSiteId?: string;
  /** Lead do site: modelo já enviado (então o botão abre a conversa). */
  modeloEnviado?: boolean;
  /** A última mensagem do cliente foi há menos de 24 h (pode mandar texto livre). */
  dentroDaJanela?: boolean;
};

export type PrecisaDeVoce = {
  itens: ItemPrecisa[];
  semDesfecho: { quantidade: number; valor: number };
  /** Admin vê todos e filtra por pessoa; atendente vê os dela e os sem dono. */
  souAdmin: boolean;
  meuId: string;
  pessoas: Array<{ id: string; nome: string }>;
};

/** Filtro do bloco: "meus" (meus + sem dono), "todos" ou o id de uma pessoa (dela + sem dono). */
export type FiltroPrecisa = "meus" | "todos" | string;

export function filtrarItens(
  itens: ItemPrecisa[],
  filtro: FiltroPrecisa,
  meuId: string,
): ItemPrecisa[] {
  if (filtro === "todos") return itens;
  const pessoa = filtro === "meus" ? meuId : filtro;
  return itens.filter((i) => i.donoUserId === null || i.donoUserId === pessoa);
}

/** Ordem: seção (urgente primeiro) e, dentro dela, o mais antigo primeiro (follow-up: horário). */
export function ordenarItens(itens: ItemPrecisa[]): ItemPrecisa[] {
  const pos = (s: SecaoPrecisa) => ORDEM_SECOES.indexOf(s);
  return [...itens].sort(
    (a, b) =>
      pos(a.secao) - pos(b.secao) ||
      (a.quando ?? "9999").localeCompare(b.quando ?? "9999") ||
      a.chave.localeCompare(b.chave),
  );
}

/** "há 14 min", "há 2 h", "há 3 dias". */
export function haQuanto(iso: string | null, agora = new Date()): string {
  if (!iso) return "";
  const min = Math.max(0, Math.round((agora.getTime() - Date.parse(iso)) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/** Texto do aviso das 10h no sininho (só o que tem; null se a lista está zerada). */
export function resumoDoDia(
  itens: ItemPrecisa[],
  semDesfecho: { quantidade: number },
): string | null {
  const conta = (s: SecaoPrecisa) => itens.filter((i) => i.secao === s).length;
  const partes = [
    [conta("urgente"), "urgente", "urgentes"],
    [conta("esperando"), "cliente esperando", "clientes esperando"],
    [conta("lead_site"), "lead do site sem chamar", "leads do site sem chamar"],
    [conta("followup"), "follow-up da equipe", "follow-ups da equipe"],
    [semDesfecho.quantidade, "orçamento sem desfecho", "orçamentos sem desfecho"],
  ] as const;
  const txt = partes
    .filter(([n]) => n > 0)
    .map(([n, um, varios]) => `${n} ${n === 1 ? um : varios}`);
  return txt.length ? `Hoje: ${txt.join(", ")}.` : null;
}
