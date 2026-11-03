/**
 * Tatiana faz e informa (03/11/2026): regras puras do que ela faz sozinha no app em modo ativo,
 * a partir dos acertos lidos na conversa à noite. Previsão de pagamento na OS (nunca "pago"),
 * orçamento em rascunho com os itens da conversa e cadastro do cliente só nos campos vazios.
 * Cada ação guarda o estado anterior para o botão Desfazer. A gravação fica em acoes.server.ts.
 * Nada aqui envia mensagem a cliente.
 */
import type { AcertoLido, CampoCadastro, ItemLido, TipoCobranca } from "./tatiana";

export type TipoAcao = "previsao_pagamento" | "orcamento_rascunho" | "cadastro" | "virar_os";
export type SituacaoAcao = "faria" | "feita" | "desfeita" | "falhou";

export const NOME_ACAO: Record<TipoAcao, string> = {
  previsao_pagamento: "Previsão de pagamento na OS",
  orcamento_rascunho: "Orçamento em rascunho",
  cadastro: "Cadastro do cliente",
  virar_os: "Orçamento virou OS",
};

export type FormaPagamento = "pix" | "cartao" | "debito" | "dinheiro" | "boleto" | "transferencia";
export const FORMAS_PAGAMENTO: FormaPagamento[] = [
  "pix",
  "cartao",
  "debito",
  "dinheiro",
  "boleto",
  "transferencia",
];

/** O que a IA leu sobre o pagamento combinado (só o que a conversa diz). */
export type PagamentoLido = {
  forma: FormaPagamento | "";
  parcelas: number | null;
  valor: number | null;
};

/** Forma lida → "Pagamento combinado" da OS (texto que o app já mostra) e parcelas. */
export function formaParaOs(p: PagamentoLido): { metodo: string; parcelas: number } | null {
  const parcelas = p.parcelas && p.parcelas > 1 ? Math.min(Math.round(p.parcelas), 24) : 1;
  switch (p.forma) {
    case "pix":
      return { metodo: "Pix", parcelas: 1 };
    case "cartao":
      return { metodo: parcelas > 1 ? `Crédito ${parcelas}x` : "Crédito", parcelas };
    case "debito":
      return { metodo: "Débito", parcelas: 1 };
    case "dinheiro":
      return { metodo: "Dinheiro", parcelas: 1 };
    case "boleto":
      return { metodo: "Boleto", parcelas: 1 };
    case "transferencia":
      return { metodo: "Transferência", parcelas: 1 };
    default:
      return parcelas > 1 ? { metodo: `${parcelas}x`, parcelas } : null;
  }
}

export const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Estado do app que decide o que a Tatiana pode fazer (vem de estadoDoLead). */
export type EstadoParaAcoes = {
  osId: string | null;
  osNumero: string | null;
  /** Pagamento lançado (linha em payments) ou previsão já combinada na OS. */
  pagamentoLancado: boolean;
  temOrcamento: boolean;
  clienteId: string | null;
  /** Campos do cadastro (null = vazio). Sem cadastro: null. */
  cliente: Record<CampoCadastro["campo"], string | null> | null;
  leadNome: string | null;
  telefone: string | null;
};

export type AcaoPlanejada =
  | {
      tipo: "previsao_pagamento";
      cobrancaTipo: TipoCobranca;
      titulo: string;
      frase: string;
      dados: { osId: string; metodo: string; parcelas: number; valor: number | null };
    }
  | {
      tipo: "orcamento_rascunho";
      cobrancaTipo: TipoCobranca;
      titulo: string;
      frase: string;
      dados: { itens: ItemLido[]; total: number; clienteNome: string; telefone: string | null };
    }
  | {
      tipo: "cadastro";
      cobrancaTipo: TipoCobranca;
      titulo: string;
      frase: string;
      dados: { clienteId: string; campos: Partial<Record<CampoCadastro["campo"], string>> };
    };

const ROTULO_CAMPO: Record<CampoCadastro["campo"], string> = {
  nome: "nome",
  cpf: "CPF",
  endereco: "endereço",
  email: "e-mail",
  cep: "CEP",
};

function itensComPreco(itens: ItemLido[]): ItemLido[] {
  return itens
    .filter((i) => i.descricao.trim() && typeof i.valor === "number" && i.valor > 0)
    .map((i) => ({
      descricao: i.descricao.trim().slice(0, 120),
      quantidade: i.quantidade > 0 ? i.quantidade : 1,
      valor: i.valor,
    }));
}

/** Valor combinado: o lido no acerto ou, sem ele, a soma dos itens com preço. */
function valorCombinado(a: AcertoLido): number | null {
  if (a.pagamento?.valor && a.pagamento.valor > 0) return a.pagamento.valor;
  const soma = itensComPreco(a.itens).reduce((s, i) => s + (i.valor ?? 0) * i.quantidade, 0);
  return soma > 0 ? soma : null;
}

/**
 * Dos acertos saneados de um lead, o que a Tatiana faz sozinha. Regras: previsão de pagamento só
 * com OS, sem pagamento lançado e com forma ou parcelas combinadas; orçamento em rascunho só sem
 * orçamento e sem OS, com itens com preço; cadastro só nos campos vazios. Conclusão de visita e
 * "virar OS" nunca entram aqui (a equipe confirma com um toque; OS tem regra própria).
 */
export function planejarAcoes(acertos: AcertoLido[], e: EstadoParaAcoes): AcaoPlanejada[] {
  const saida: AcaoPlanejada[] = [];
  const os = e.osNumero ? `OS ${e.osNumero}` : "a OS";
  for (const a of acertos) {
    if (a.tipo === "pagamento" && e.osId && !e.pagamentoLancado && a.pagamento) {
      const forma = formaParaOs(a.pagamento);
      const valor = valorCombinado(a);
      if (!forma) continue;
      const como = `${valor ? `${brl(valor)} ` : ""}${forma.parcelas > 1 ? `em ${forma.metodo.toLowerCase().replace("crédito", "").trim()} no cartão` : `no ${forma.metodo.toLowerCase()}`}`;
      saida.push({
        tipo: "previsao_pagamento",
        cobrancaTipo: "pagamento",
        titulo: `Previsão de pagamento ${como.trim()} na ${os}`,
        frase: a.texto,
        dados: { osId: e.osId, metodo: forma.metodo, parcelas: forma.parcelas, valor },
      });
    }
    if (a.tipo === "orcamento_sem_app" && !e.temOrcamento && !e.osId) {
      const itens = itensComPreco(a.itens);
      if (!itens.length) continue;
      const total = itens.reduce((s, i) => s + (i.valor ?? 0) * i.quantidade, 0);
      saida.push({
        tipo: "orcamento_rascunho",
        cobrancaTipo: "orcamento_sem_app",
        titulo:
          `Orçamento em rascunho: ${itens.map((i) => `${i.quantidade > 1 ? `${i.quantidade}× ` : ""}${i.descricao} ${brl(i.valor ?? 0)}`).join(", ")}`.slice(
            0,
            200,
          ),
        frase: a.texto,
        dados: { itens, total, clienteNome: e.leadNome || "Cliente", telefone: e.telefone },
      });
    }
  }
  // Cadastro: campos vazios que a conversa preenche (de qualquer acerto), um só por lead.
  if (e.clienteId && e.cliente) {
    const campos: Partial<Record<CampoCadastro["campo"], string>> = {};
    for (const a of acertos)
      for (const c of a.cadastro ?? []) {
        const v = (c.valor ?? "").trim();
        if (!v || campos[c.campo] || e.cliente[c.campo]) continue;
        if (c.campo === "email" && !/^\S+@\S+\.\S+$/.test(v)) continue;
        if (c.campo === "cep" && v.replace(/\D/g, "").length !== 8) continue;
        if (c.campo === "cpf" && ![11, 14].includes(v.replace(/\D/g, "").length)) continue;
        campos[c.campo] = v.slice(0, 200);
      }
    const chaves = Object.keys(campos) as CampoCadastro["campo"][];
    if (chaves.length) {
      const fonte = acertos.find((a) => a.cadastro?.length);
      saida.push({
        tipo: "cadastro",
        cobrancaTipo: "cadastro",
        titulo: `Cadastro: ${chaves.map((k) => ROTULO_CAMPO[k]).join(", ")} ${chaves.length === 1 ? "preenchido" : "preenchidos"} pela conversa`,
        frase: fonte?.texto ?? "",
        dados: { clienteId: e.clienteId, campos },
      });
    }
  }
  return saida;
}

/** Texto do push e do aviso da manhã: "Feito pela Tatiana ontem à noite". */
export function textoFeitoPelaTatiana(
  feitas: Array<{ tipo: TipoAcao }>,
  modo: "ativo" | "teste",
): { titulo: string; corpo: string } {
  const n = feitas.length;
  const por = new Map<TipoAcao, number>();
  for (const f of feitas) por.set(f.tipo, (por.get(f.tipo) ?? 0) + 1);
  const lista = [...por.entries()].map(([t, k]) => `${k} ${NOME_ACAO[t].toLowerCase()}`).join(", ");
  return modo === "ativo"
    ? {
        titulo: `Tatiana: ${n} ${n === 1 ? "coisa feita" : "coisas feitas"} no app ontem à noite`,
        corpo: `${lista}. Confira em Follow-ups › Feito pela Tatiana; cada item tem Desfazer.`,
      }
    : {
        titulo: `Tatiana faria ${n} ${n === 1 ? "coisa" : "coisas"} no app (modo teste)`,
        corpo: `${lista}. Em modo ativo ela faz sozinha e avisa; veja em Follow-ups.`,
      };
}
