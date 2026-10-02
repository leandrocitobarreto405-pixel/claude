/**
 * Notificações no celular: tipos, quem pode receber cada um (pelo papel), preferências e textos.
 * Sem banco nem rede, para poder testar. O técnico só recebe avisos da operação.
 */
import type { Papel } from "@/lib/tenant";

export type TipoPush =
  | "cliente_esperando"
  | "servico_concluido"
  | "campanha_aprovacao"
  | "agendamento_promocao"
  | "resumo_dia";

export const TIPOS_PUSH: { tipo: TipoPush; rotulo: string; descricao: string; papeis: Papel[] }[] =
  [
    {
      tipo: "cliente_esperando",
      rotulo: "Cliente esperando a equipe",
      descricao: "Quando um cliente fica sem resposta da equipe.",
      papeis: ["admin", "atendente"],
    },
    {
      tipo: "servico_concluido",
      rotulo: "Serviço concluído",
      descricao: "Quando um técnico conclui um serviço.",
      papeis: ["admin", "atendente", "tecnico"],
    },
    {
      tipo: "campanha_aprovacao",
      rotulo: "Campanha esperando aprovação",
      descricao: "Quando uma campanha de marketing precisa do seu ok.",
      papeis: ["admin"],
    },
    {
      tipo: "agendamento_promocao",
      rotulo: "Agendamento vindo da promoção",
      descricao: "Quando alguém que recebeu a promoção da agenda marca um serviço.",
      papeis: ["admin", "atendente", "tecnico"],
    },
    {
      tipo: "resumo_dia",
      rotulo: "Resumo do dia às 9h",
      descricao: "Serviços de hoje, atrasados e sem técnico.",
      papeis: ["admin", "atendente", "tecnico"],
    },
  ];

export function tiposDoPapel(papel: Papel | null): TipoPush[] {
  if (!papel) return [];
  return TIPOS_PUSH.filter((t) => t.papeis.includes(papel)).map((t) => t.tipo);
}

export type PreferenciasPush = {
  cliente_esperando: boolean;
  espera_minutos: number;
  servico_concluido: boolean;
  campanha_aprovacao: boolean;
  agendamento_promocao: boolean;
  resumo_dia: boolean;
};

export const PREFERENCIAS_PADRAO: PreferenciasPush = {
  cliente_esperando: true,
  espera_minutos: 10,
  servico_concluido: true,
  campanha_aprovacao: true,
  agendamento_promocao: true,
  resumo_dia: false,
};

export const MINUTOS_ESPERA = [5, 10, 15, 30, 60];

/** A pessoa recebe este tipo? (papel permite e ela deixou ligado). */
export function querReceber(tipo: TipoPush, papel: Papel | null, pref: PreferenciasPush): boolean {
  return tiposDoPapel(papel).includes(tipo) && Boolean(pref[tipo]);
}

export type Notificacao = { titulo: string; corpo: string; url: string; tag?: string };

// ---------------------------------------------------------------- cliente esperando
export type EsperaPush = {
  id: string;
  nome: string;
  desde: string;
  /** A última mensagem da conversa é do cliente (senão não é espera de verdade). */
  ultimaDoCliente: boolean;
};

const MIN = 60_000;

/**
 * Esperas que viram notificação para quem escolheu `minutos`: só esperas de verdade (o cliente
 * falou por último), há mais de `minutos` e de menos de 24 h (conversa esquecida não notifica).
 */
export function esperasParaNotificar(
  esperas: EsperaPush[],
  minutos: number,
  agora = new Date(),
): EsperaPush[] {
  const t = agora.getTime();
  return esperas.filter((e) => {
    const desde = Date.parse(e.desde);
    return e.ultimaDoCliente && desde <= t - minutos * MIN && desde >= t - 24 * 60 * MIN;
  });
}

export function notificacaoEspera(e: EsperaPush, agora = new Date()): Notificacao {
  const min = Math.max(1, Math.round((agora.getTime() - Date.parse(e.desde)) / MIN));
  const quanto =
    min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`;
  return {
    titulo: "Cliente esperando a equipe",
    corpo: `${e.nome} espera resposta há ${quanto}.`,
    url: `/conversas/${e.id}`,
    tag: `espera-${e.id}`,
  };
}

// ---------------------------------------------------------------- serviço, campanha, promoção
export function notificacaoConcluido(s: {
  cliente: string;
  tecnico: string | null;
  os: string | null;
}): Notificacao {
  return {
    titulo: "Serviço concluído",
    corpo: `${s.cliente}${s.tecnico ? ` · ${s.tecnico}` : ""}`,
    url: s.os ? `/os/${encodeURIComponent(s.os)}` : "/agenda",
  };
}

export function notificacaoCampanha(c: { nome: string }): Notificacao {
  return {
    titulo: "Campanha esperando aprovação",
    corpo: `${c.nome}: confira e aprove em Marketing.`,
    url: "/marketing",
  };
}

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function notificacaoPromocao(v: {
  cliente: string;
  data: string;
  hora: string;
}): Notificacao {
  return {
    titulo: "Agendamento da promoção",
    corpo: `${v.cliente} marcou para ${dataCurta(v.data)} às ${v.hora.slice(0, 5)}.`,
    url: `/agenda?modo=dia&dia=${v.data}`,
  };
}

// ---------------------------------------------------------------- resumo do dia
const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;

/** Resumo das 9h. O técnico recebe só a parte da operação (sem conversas). */
export function notificacaoResumo(
  papel: Papel,
  n: { servicosHoje: number; atrasados: number; semTecnico: number; esperando: number },
  textoEquipe?: string,
): Notificacao {
  if (papel === "tecnico")
    return {
      titulo: "Resumo do dia",
      corpo: `${plural(n.servicosHoje, "serviço", "serviços")} hoje · ${plural(n.atrasados, "atrasado", "atrasados")}.`,
      url: "/agenda",
    };
  return { titulo: "Resumo do dia", corpo: textoEquipe ?? "", url: "/inicio" };
}

/** Janela em que o resumo pode sair (São Paulo): das 9h às 11h, uma vez por dia. */
export function horaDoResumo(horaSP: number): boolean {
  return horaSP >= 9 && horaSP < 11;
}

/** Só caminhos internos do app (nada de link para fora). */
export function urlSegura(url: string): string {
  return /^\/(?!\/)[\w\-/?=&.%]*$/.test(url) ? url : "/avisos";
}
