/**
 * Gerente comercial: números do Resumo na ordem de quem decide (regras puras, sem banco). Período e
 * grupo (Google × outras), "Como estamos", funil com a queda entre etapas e "O que corrigir"
 * (defeitos da Alice e erros da equipe por ficha, com a tendência antes × depois de 28/10 e
 * exemplos tirados das próprias fichas, que já vêm sem o nome do cliente).
 */
import { DEFEITOS_ALICE, NOME_DEFEITO, type DefeitoAlice, type Ficha, type Regra } from "./ficha";
import { CORTE_ALICE, NOME_TEMA_EQUIPE, TEMAS_EQUIPE, type TemaEquipe } from "./relatorio";
import type { FichaResumo } from "./resumo";

export type FichaPainel = FichaResumo & { criadoEm: string | null };

// ---------------------------------------------------------------- período e grupo

export type Periodo = "outubro" | "este_mes" | "30_dias";
export const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: "outubro", rotulo: "Outubro" },
  { id: "este_mes", rotulo: "Este mês" },
  { id: "30_dias", rotulo: "Últimos 30 dias" },
];

/** Quando o lead começou: 1ª mensagem do cliente ou, sem ela, a criação do lead. */
export function inicioDoLead(f: FichaPainel): string | null {
  return f.fatos?.primeiraMensagemCliente ?? f.criadoEm;
}

/** Mês em São Paulo ("2026-10") de um instante. */
function mesSP(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 7);
}

export function noPeriodo(f: FichaPainel, p: Periodo, agora = new Date()): boolean {
  const ini = inicioDoLead(f);
  if (!ini) return p === "outubro";
  if (p === "outubro") return mesSP(ini) === "2026-10";
  if (p === "este_mes") return mesSP(ini) === mesSP(agora.toISOString());
  return new Date(ini).getTime() >= agora.getTime() - 30 * 86_400_000;
}

export type Grupo = "todos" | "google" | "outras";
export const noGrupo = (f: FichaResumo, g: Grupo) => g === "todos" || f.grupo === g;

// ---------------------------------------------------------------- como estamos

export function comoEstamos(fichas: FichaResumo[]) {
  const ok = fichas.filter((f) => f.status === "ok");
  const comOrcamento = ok.filter((f) => f.resultado !== "sem_orcamento");
  const vendas = ok.filter((f) => f.resultado === "vendeu");
  const orcado = comOrcamento.reduce((s, f) => s + (f.valorOrcado ?? 0), 0);
  const perdido = comOrcamento
    .filter((f) => f.resultado === "perdeu" || f.resultado === "sem_desfecho")
    .reduce((s, f) => s + (f.valorOrcado ?? 0), 0);
  return {
    leads: ok.length,
    pctOrcamento: ok.length ? comOrcamento.length / ok.length : 0,
    comOrcamento: comOrcamento.length,
    conversao: ok.length ? vendas.length / ok.length : 0,
    vendas: vendas.length,
    vendido: vendas.reduce((s, f) => s + (f.valorVendido ?? 0), 0),
    orcado,
    perdido,
  };
}

/** Funil com a queda (em %) em relação à etapa anterior. */
export function funilComQueda(fichas: FichaResumo[]) {
  const ok = fichas.filter((f) => f.status === "ok");
  const etapas = [
    { etapa: "Chegaram", n: ok.length },
    {
      etapa: "Conversaram",
      n: ok.filter((f) => (f.fatos?.mensagens.cliente ?? 0) > 1).length,
    },
    { etapa: "Orçamento", n: ok.filter((f) => f.resultado !== "sem_orcamento").length },
    { etapa: "Compraram", n: ok.filter((f) => f.resultado === "vendeu").length },
  ];
  return etapas.map((e, i) => {
    const antes = i ? etapas[i - 1]!.n : null;
    return {
      ...e,
      pctDoTotal: ok.length ? e.n / ok.length : 0,
      queda: antes ? Math.max(0, (antes - e.n) / antes) : null,
    };
  });
}

// ---------------------------------------------------------------- o que corrigir

export type Tendencia = "caiu" | "subiu" | "igual" | "sem_base";

export type ItemCorrigir = {
  id: string;
  nome: string;
  casos: number;
  /** % dos leads de cada lado do corte (28/10) que tiveram o problema. */
  antes: number | null;
  depois: number | null;
  tendencia: Tendencia;
  exemplos: string[];
};

/** Tendência só com pelo menos 5 leads de cada lado e diferença de 2 pontos ou mais. */
export function tendencia(
  antes: { casos: number; leads: number },
  depois: { casos: number; leads: number },
): { antes: number | null; depois: number | null; tendencia: Tendencia } {
  const a = antes.leads ? antes.casos / antes.leads : null;
  const d = depois.leads ? depois.casos / depois.leads : null;
  if (a === null || d === null || antes.leads < 5 || depois.leads < 5)
    return { antes: a, depois: d, tendencia: "sem_base" };
  const dif = d - a;
  return {
    antes: a,
    depois: d,
    tendencia: dif <= -0.02 ? "caiu" : dif >= 0.02 ? "subiu" : "igual",
  };
}

const depoisDoCorte = (f: FichaPainel, corte: string) => {
  const ini = inicioDoLead(f);
  return ini ? new Date(ini).getTime() >= new Date(corte).getTime() : false;
};

/** Monta a lista: cada ficha diz se teve o problema e qual trecho serve de exemplo. */
function lista<T extends string>(
  fichas: FichaPainel[],
  ids: readonly T[],
  nome: (id: T) => string,
  achar: (f: Ficha, id: T) => string | null,
  corte: string,
): ItemCorrigir[] {
  const ok = fichas.filter((f) => f.status === "ok" && f.ficha);
  const leadsDepois = ok.filter((f) => depoisDoCorte(f, corte)).length;
  const leadsAntes = ok.length - leadsDepois;
  return ids
    .map((id) => {
      let antes = 0;
      let depois = 0;
      const exemplos: string[] = [];
      for (const f of ok) {
        const ex = achar(f.ficha!, id);
        if (ex === null) continue;
        if (depoisDoCorte(f, corte)) depois++;
        else antes++;
        if (ex && exemplos.length < 3 && !exemplos.includes(ex)) exemplos.push(ex);
      }
      return {
        id,
        nome: nome(id),
        casos: antes + depois,
        ...tendencia({ casos: antes, leads: leadsAntes }, { casos: depois, leads: leadsDepois }),
        exemplos,
      };
    })
    .filter((l) => l.casos > 0)
    .sort((a, b) => b.casos - a.casos);
}

const erroDe = (f: Ficha, quem: "alice" | "equipe", re?: RegExp) =>
  f.erros.find((e) => e.quem === quem && (!re || re.test(e.erro)))?.erro ?? null;

/** Evidência da regra quebrada por quem atendeu (ou null se não quebrou). */
const regraQuebrada = (f: Ficha, regra: Regra, quem: "alice" | "equipe") => {
  const r = f.regras.find((x) => x.regra === regra && x.situacao === "quebrou" && x.quem === quem);
  return r ? r.evidencia || "" : null;
};

const REGRA_DO_DEFEITO: Partial<Record<DefeitoAlice, Regra>> = {
  ficou_com_duvida: "sem_ficou_com_duvida",
  repetiu_outra_pergunta: "nao_repetir_pergunta",
  pediu_cep_de_novo: "nao_repetir_pergunta",
  sem_empatia: "empatia",
};

export function defeitosAlice(fichas: FichaPainel[], corte = CORTE_ALICE): ItemCorrigir[] {
  return lista(
    fichas,
    DEFEITOS_ALICE,
    (d) => NOME_DEFEITO[d],
    (f, d) => {
      if (!(f.defeitos_alice ?? []).includes(d)) return null;
      const regra = REGRA_DO_DEFEITO[d];
      return (regra ? regraQuebrada(f, regra, "alice") : null) || erroDe(f, "alice") || "";
    },
    corte,
  );
}

/** Erros da equipe nos 6 temas: pelas regras quebradas ou pelo texto dos erros da ficha. */
const PADRAO_TEMA: Partial<Record<TemaEquipe, RegExp>> = {
  demora_ate_preco:
    /(demor|levou|horas? (para|até)|minutos (para|até)).{0,40}(preço|orçamento|valor|responder|resposta)|(preço|orçamento).{0,30}(demor|tard)/i,
  sem_resumo_para_quem_decide: /(marido|esposa|esposo|quem decide|decidir com|sócio)/i,
  prometeu_sem_olhar_agenda:
    /(prometeu|ofereceu|confirmou|marcou|garantiu|deu).{0,40}(horário|agenda|vaga|data)|(sem|antes de) (olhar|consultar|ver|checar) a agenda|mudou a data|remarc/i,
};
const REGRA_TEMA: Partial<Record<TemaEquipe, Regra>> = {
  repetiu_pergunta: "nao_repetir_pergunta",
  alguma_duvida: "sem_ficou_com_duvida",
  preco_sem_pix: "pix",
};

export function temaDaEquipe(f: Ficha, t: TemaEquipe): string | null {
  const regra = REGRA_TEMA[t];
  if (regra) return regraQuebrada(f, regra, "equipe");
  const re = PADRAO_TEMA[t];
  return re ? erroDe(f, "equipe", re) : null;
}

export function errosEquipe(fichas: FichaPainel[], corte = CORTE_ALICE): ItemCorrigir[] {
  return lista(fichas, TEMAS_EQUIPE, (t) => NOME_TEMA_EQUIPE[t], temaDaEquipe, corte);
}
