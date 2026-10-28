/**
 * Desempenho por pessoa no Dashboard (29/10): taxa de fechamento (orçamentos que a pessoa fez e
 * viraram OS) e 1ª resposta (da primeira mensagem do cliente na conversa até a primeira resposta,
 * mediana). A Alice responde como robô; quem responde pelo Chatwoot não é identificado (o Chatwoot
 * não diz qual atendente foi), então fica como "Equipe". Funções puras.
 */

export const EQUIPE_SEM_NOME = "Equipe";

export type OrcamentoAutor = { autor: string; virouOs: boolean };

export type MensagemConversa = {
  conversa: string;
  recebida: boolean;
  /** Quem mandou (só nas enviadas): vendedora, "Alice (IA)" ou "Equipe". */
  autor: string | null;
  quando: string;
};

export type DesempenhoPessoa = {
  vendedora: string;
  orcamentos: number;
  fechados: number;
  /** % dos orçamentos que viraram OS; null sem orçamento. */
  taxa: number | null;
  /** Mediana da 1ª resposta em minutos; null sem conversa respondida pela pessoa. */
  primeiraRespostaMin: number | null;
  conversas: number;
};

export function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Por conversa: minutos da 1ª mensagem do cliente até a 1ª resposta (e quem respondeu). */
export function primeirasRespostas(msgs: MensagemConversa[]): { autor: string; minutos: number }[] {
  const porConversa = new Map<string, MensagemConversa[]>();
  for (const m of msgs) porConversa.set(m.conversa, [...(porConversa.get(m.conversa) ?? []), m]);
  const r: { autor: string; minutos: number }[] = [];
  for (const lista of porConversa.values()) {
    const ord = [...lista].sort((a, b) => a.quando.localeCompare(b.quando));
    const cliente = ord.find((m) => m.recebida);
    if (!cliente) continue;
    const resposta = ord.find((m) => !m.recebida && m.quando > cliente.quando);
    if (!resposta) continue;
    r.push({
      autor: resposta.autor ?? EQUIPE_SEM_NOME,
      minutos: (Date.parse(resposta.quando) - Date.parse(cliente.quando)) / 60_000,
    });
  }
  return r;
}

export function desempenhoPorPessoa(
  orcamentos: OrcamentoAutor[],
  respostas: { autor: string; minutos: number }[],
): DesempenhoPessoa[] {
  const pessoas = new Map<string, { orc: number; fech: number; tempos: number[] }>();
  const de = (n: string) => {
    const p = pessoas.get(n) ?? { orc: 0, fech: 0, tempos: [] };
    pessoas.set(n, p);
    return p;
  };
  for (const o of orcamentos) {
    const p = de(o.autor);
    p.orc++;
    if (o.virouOs) p.fech++;
  }
  for (const r of respostas) de(r.autor).tempos.push(r.minutos);
  return [...pessoas.entries()]
    .map(([vendedora, p]) => ({
      vendedora,
      orcamentos: p.orc,
      fechados: p.fech,
      taxa: p.orc ? (p.fech / p.orc) * 100 : null,
      primeiraRespostaMin: mediana(p.tempos),
      conversas: p.tempos.length,
    }))
    .sort((a, b) => b.orcamentos - a.orcamentos || b.conversas - a.conversas);
}

/**
 * Respostas da equipe pelo Nexa (28/10): a equipe passou a responder pelas Conversas do Nexa, que
 * grava quem enviou. Por semana (segunda a domingo, horário de SP), quantas mensagens da equipe ao
 * cliente saíram pelo Nexa e quantas pelo Chatwoot ou pelo celular.
 */
export type RespostaEquipe = { quando: string; peloNexa: boolean };
export type SemanaRespostas = {
  /** Segunda-feira da semana (AAAA-MM-DD). */
  semana: string;
  total: number;
  peloNexa: number;
  /** % pelo Nexa; null sem mensagem na semana. */
  pct: number | null;
};

/** Segunda-feira (AAAA-MM-DD) da semana do instante, no horário de São Paulo. */
export function segundaDaSemanaSP(iso: string): string {
  const d = new Date(Date.parse(iso) - 3 * 3_600_000);
  const dia = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return new Date(d.getTime() - (dia - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** As `semanas` últimas semanas até `agora` (as sem mensagem aparecem com zero). */
export function respostasPeloNexaPorSemana(
  msgs: RespostaEquipe[],
  agora: Date,
  semanas = 8,
): SemanaRespostas[] {
  const atual = segundaDaSemanaSP(agora.toISOString());
  const base = Date.parse(`${atual}T12:00:00Z`);
  const lista = Array.from({ length: semanas }, (_, i) =>
    new Date(base - (semanas - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
  );
  const conta = new Map(lista.map((s) => [s, { total: 0, peloNexa: 0 }]));
  for (const m of msgs) {
    const c = conta.get(segundaDaSemanaSP(m.quando));
    if (!c) continue;
    c.total++;
    if (m.peloNexa) c.peloNexa++;
  }
  return lista.map((semana) => {
    const c = conta.get(semana)!;
    return {
      semana,
      ...c,
      pct: c.total ? Math.round((c.peloNexa / c.total) * 1000) / 10 : null,
    };
  });
}
