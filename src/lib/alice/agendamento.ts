// Agendamento feito pela Alice: regras sem banco (número da OS, itens e valores a partir dos
// orçamentos, vendedora, origem e textos do aviso à equipe), para poder testar.
import { normalizarNome, reais } from "./regras";

/** Próximo número de OS, como a Nova OS sugere: maior número + 1, com 4 dígitos no mínimo. */
export function proximoNumeroOS(existentes: string[]): string {
  const numeros = existentes
    .map((n) => Number(String(n).replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  const proximo = numeros.length ? Math.max(...numeros) + 1 : 1;
  return String(proximo).padStart(4, "0");
}

// ---------------------------------------------------------------- itens e valores
export type ServicoOrcamento = "higienizacao" | "impermeabilizacao";

export type ItemOrcamento = {
  tabelaItemId: string | null;
  nome: string;
  servico: ServicoOrcamento;
  preco: number;
  quantidade: number;
};

export type OrcamentoReserva = {
  id: string;
  total: number;
  /** Preço no Pix (com o desconto do Pix); null = sem desconto no Pix. */
  pix: number | null;
  desconto: number;
  parcelas: number;
  itens: ItemOrcamento[];
};

export type ItemVisita = {
  description: string;
  quantity: number;
  unit_price: number;
  /** Mesmo grupo para o mesmo item da tabela nos dois serviços (o documento combinado junta). */
  grupo: string;
  display_order: number;
};

export type VisitaReserva = { servico: ServicoOrcamento; itens: ItemVisita[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Um atendimento por serviço (higienização antes da impermeabilização), na ordem dos itens. */
export function visitasDosOrcamentos(orcamentos: OrcamentoReserva[]): VisitaReserva[] {
  const grupos = new Map<string, string>();
  const grupoDe = (i: ItemOrcamento) => {
    const chave = i.tabelaItemId ?? `nome:${normalizarNome(i.nome)}`;
    let g = grupos.get(chave);
    if (!g) {
      g = `g${grupos.size + 1}`;
      grupos.set(chave, g);
    }
    return g;
  };
  const visitas: VisitaReserva[] = [];
  for (const servico of ["higienizacao", "impermeabilizacao"] as const) {
    const itens = orcamentos
      .flatMap((o) => o.itens)
      .filter((i) => i.servico === servico && i.quantidade > 0);
    if (!itens.length) continue;
    visitas.push({
      servico,
      itens: itens.map((i, idx) => ({
        description: i.nome,
        quantity: i.quantidade,
        unit_price: round2(i.preco),
        grupo: grupoDe(i),
        display_order: idx,
      })),
    });
  }
  return visitas;
}

export type Pagamento = "pix" | "cartao";

export type ValoresReserva = {
  somaItens: number;
  total: number;
  forma: "Pix" | "Crédito";
  parcelas: number;
  /** Motivo do ajuste quando o total é diferente da soma dos itens (descontos). */
  motivoAjuste: string | null;
};

export function valoresDaReserva(
  orcamentos: OrcamentoReserva[],
  pagamento: Pagamento,
  parcelasPedidas: number | null,
  pixPct: number,
): ValoresReserva {
  const somaItens = round2(
    orcamentos.flatMap((o) => o.itens).reduce((s, i) => s + i.preco * i.quantidade, 0),
  );
  const desconto = round2(orcamentos.reduce((s, o) => s + (Number(o.desconto) || 0), 0));
  const cartao = round2(orcamentos.reduce((s, o) => s + Number(o.total), 0));
  const pix = round2(orcamentos.reduce((s, o) => s + Number(o.pix ?? o.total), 0));
  const maxParcelas = Math.max(1, ...orcamentos.map((o) => Number(o.parcelas) || 1));
  const total = pagamento === "pix" ? pix : cartao;
  const parcelas =
    pagamento === "pix"
      ? 1
      : Math.min(maxParcelas, Math.max(1, Math.round(parcelasPedidas ?? maxParcelas)));
  const motivos: string[] = [];
  if (desconto > 0) motivos.push(`desconto do orçamento (${reais(desconto)})`);
  if (pagamento === "pix" && pix < cartao) motivos.push(`desconto de ${pixPct}% no Pix`);
  return {
    somaItens,
    total,
    forma: pagamento === "pix" ? "Pix" : "Crédito",
    parcelas,
    motivoAjuste:
      Math.abs(total - somaItens) >= 0.01
        ? `Orçamento da Alice: ${motivos.join(" e ") || "valor combinado"}.`
        : null,
  };
}

// ---------------------------------------------------------------- vendedora
export type Vendedora = {
  id: string;
  nome: string;
  email: string | null;
  emailLogin: string | null;
  ehIa: boolean;
  comissao: number;
};

const primeiroNome = (s: string) => normalizarNome(s).split(" ")[0] ?? "";

/** Vendedora (não IA) pelo e-mail ou pelo nome (completo ou só o primeiro, se for único). */
export function casarVendedora(
  pessoa: { nome?: string | null; email?: string | null },
  vendedoras: Vendedora[],
): Vendedora | null {
  const humanas = vendedoras.filter((v) => !v.ehIa);
  const email = pessoa.email?.trim().toLowerCase();
  if (email) {
    const v = humanas.find(
      (x) => x.email?.toLowerCase() === email || x.emailLogin?.toLowerCase() === email,
    );
    if (v) return v;
  }
  const nome = pessoa.nome ? normalizarNome(pessoa.nome) : "";
  if (!nome) return null;
  const exato = humanas.find((x) => normalizarNome(x.nome) === nome);
  if (exato) return exato;
  const pn = primeiroNome(nome);
  const mesmos = humanas.filter((x) => primeiroNome(x.nome) === pn);
  return mesmos.length === 1 ? mesmos[0]! : null;
}

export type Participacao = {
  /** Mensagem escrita no Chatwoot (com remetente) ou pelo celular (eco, sem remetente). */
  nome: string | null;
  email: string | null;
  quando: string;
};

export type EscolhaVendedora = {
  vendedora: Vendedora | null;
  /** A Alice conduziu sozinha. */
  sozinha: boolean;
  /** Atendente participou, mas não deu para saber quem: a equipe confere. */
  conferir: string | null;
};

/**
 * Alice (IA) quando conduziu sozinha. Se uma atendente participou (respondeu ou assumiu), a
 * vendedora é ela: quem escreveu pelo Chatwoot (a mais recente); pelo celular, a responsável da
 * conversa no Chatwoot ou a vendedora do lead.
 */
export function escolherVendedora(o: {
  participacoes: Participacao[];
  assumiu: boolean;
  responsavel: { nome: string | null; email?: string | null } | null;
  vendedoraDoLead: string | null;
  vendedoras: Vendedora[];
}): EscolhaVendedora {
  const alice = o.vendedoras.find((v) => v.ehIa) ?? null;
  if (!o.participacoes.length && !o.assumiu)
    return { vendedora: alice, sozinha: true, conferir: null };

  const recentes = [...o.participacoes].sort((a, b) => b.quando.localeCompare(a.quando));
  for (const p of recentes) {
    if (!p.nome && !p.email) continue;
    const v = casarVendedora(p, o.vendedoras);
    if (v) return { vendedora: v, sozinha: false, conferir: null };
  }
  if (o.responsavel) {
    const v = casarVendedora(o.responsavel, o.vendedoras);
    if (v) return { vendedora: v, sozinha: false, conferir: null };
  }
  const doLead = o.vendedoras.find((v) => v.id === o.vendedoraDoLead && !v.ehIa);
  if (doLead) return { vendedora: doLead, sozinha: false, conferir: null };
  const humanas = o.vendedoras.filter((v) => !v.ehIa);
  if (humanas.length === 1) return { vendedora: humanas[0]!, sozinha: false, conferir: null };
  return {
    vendedora: alice,
    sozinha: false,
    conferir:
      "Uma atendente participou da conversa (pelo celular) e não deu para saber quem. A OS ficou com a Alice (IA): troque a vendedora se for o caso.",
  };
}

/**
 * Eco do celular que não é atendente: a saudação/ausência automática do WhatsApp Business
 * (até 10 s da primeira mensagem do cliente numa conversa nova, ou o mesmo texto de uma
 * saudação já vista). Mesma regra do banco (private.ia_mensagem_automatica).
 */
export function ecoAutomatico(o: {
  quando: string;
  texto: string;
  primeiraDoCliente: string | null;
  enviadaAntes: boolean;
  saudacoesVistas: Set<string>;
}): boolean {
  if (o.saudacoesVistas.has(o.texto.trim())) return true;
  if (!o.primeiraDoCliente || o.enviadaAntes) return false;
  return Math.abs(Date.parse(o.quando) - Date.parse(o.primeiraDoCliente)) <= 10_000;
}

// ---------------------------------------------------------------- origem da venda
export type OpcaoOrigem = { id: string; nome: string; codigo: string | null };
export type CliqueAnuncio = {
  gclid: string | null;
  gbraid: string | null;
  fbclid: string | null;
  utm_source: string | null;
};

/** Origem pedida quando ainda não existe na empresa (a reserva cria). */
export const ORIGEM_WHATSAPP = { nome: "WhatsApp", codigo: "whatsapp" } as const;

/**
 * Origem da venda: a do lead (anúncio, campanha, indicação... já marcada no CRM); se o lead não
 * tem, o clique do anúncio (Google pelo gclid, Meta pelo fbclid) ou a indicação; só "WhatsApp"
 * quando não houver outra. O GCLID fica no clique, ligado ao lead (não se perde).
 */
export function escolherOrigem(o: {
  origemDoLead: string | null;
  cliques: CliqueAnuncio[];
  indicado: boolean;
  opcoes: OpcaoOrigem[];
}): { id: string | null; nome: string; codigo: string } {
  const doLead = o.opcoes.find((x) => x.id === o.origemDoLead);
  if (doLead) return { id: doLead.id, nome: doLead.nome, codigo: doLead.codigo ?? "" };
  const por = (codigo: string, nome: string) => {
    const achada =
      o.opcoes.find((x) => x.codigo === codigo) ??
      o.opcoes.find((x) => normalizarNome(x.nome) === normalizarNome(nome));
    return { id: achada?.id ?? null, nome: achada?.nome ?? nome, codigo };
  };
  if (o.cliques.some((c) => c.gclid || c.gbraid)) return por("google", "Google");
  const meta = o.cliques.find(
    (c) => c.fbclid || /facebook|instagram|^fb|^ig/i.test(c.utm_source ?? ""),
  );
  if (meta)
    return /instagram|^ig/i.test(meta.utm_source ?? "")
      ? por("instagram", "Instagram")
      : por("facebook", "Facebook");
  if (o.indicado) return por("indicacao", "Indicação");
  return por(ORIGEM_WHATSAPP.codigo, ORIGEM_WHATSAPP.nome);
}

// ---------------------------------------------------------------- textos
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function diaCurto(data: string): string {
  const d = new Date(`${data}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

export function textoPagamento(v: Pick<ValoresReserva, "total" | "forma" | "parcelas">) {
  if (v.forma === "Pix") return `${reais(v.total)} no Pix`;
  return v.parcelas > 1
    ? `${reais(v.total)} no cartão em ${v.parcelas}x de ${reais(Math.round((v.total / v.parcelas) * 100) / 100)}`
    : `${reais(v.total)} no cartão`;
}

/** Aviso à equipe (Avisos e celular) a cada agendamento feito pela Alice. */
export function avisoAgendamento(a: {
  cliente: string;
  data: string;
  hora: string;
  valores: Pick<ValoresReserva, "total" | "forma" | "parcelas">;
  os: string;
  tecnico: string | null;
  vendedora: string | null;
  conferir: string | null;
}): { titulo: string; mensagem: string; push: string } {
  const quando = `${diaCurto(a.data)} às ${a.hora.slice(0, 5)}`;
  const linhas = [
    `${a.cliente} · ${quando}`,
    `Valor: ${textoPagamento(a.valores)}`,
    `OS ${a.os}${a.tecnico ? ` · Técnico: ${a.tecnico}` : ""}${a.vendedora ? ` · Vendedora: ${a.vendedora}` : ""}`,
    "Confira a OS no app.",
    ...(a.conferir ? [a.conferir] : []),
  ];
  return {
    titulo: "Agendamento feito pela Alice",
    mensagem: linhas.join("\n"),
    push: `${a.cliente} · ${quando} · ${reais(a.valores.total)}`,
  };
}
