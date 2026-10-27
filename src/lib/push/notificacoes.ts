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
      rotulo: "Campanha esperando aprovação ou pausada",
      descricao:
        "Quando uma campanha de marketing precisa do seu ok ou foi pausada sozinha (qualidade do número, opt-out ou modelo).",
      papeis: ["admin"],
    },
    {
      tipo: "agendamento_promocao",
      rotulo: "Agendamentos novos (promoção e Alice)",
      descricao:
        "Quando alguém que recebeu a promoção da agenda marca um serviço e quando a Alice agenda um cliente (o técnico recebe só o da promoção).",
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
  /** Usuário do app que é dono da conversa (assumiu ou está atribuído); null = sem dono. */
  donoUserId?: string | null;
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

// ---------------------------------------------------------------- esperas agrupadas (27/10)
/** Primeiro aviso aos 5 min, lembrete aos 10 min; no máximo um aviso a cada 15 min por pessoa. */
export const ESPERA_AVISO_MIN = 5;
export const ESPERA_LEMBRETE_MIN = 10;
export const ESPERA_INTERVALO_MIN = 15;

const tempo = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`;

/**
 * Um aviso só com todos os clientes esperando que são desta pessoa: conversas dela e, para
 * admin/atendente, as sem dono. Sai quando alguma espera chega aos 5 min (aviso) ou aos 10 min
 * (lembrete) e ainda não foi avisada nesse estágio, respeitando 15 min desde o último aviso.
 * `jaAvisadas` são as chaves `${id}:${desde}:1|2` já marcadas.
 */
export function avisoAgrupadoDeEsperas(o: {
  esperas: EsperaPush[];
  userId: string;
  papel: Papel;
  jaAvisadas: Set<string>;
  ultimoAvisoEm: string | null;
  agora?: Date;
}): { n: Notificacao; marcar: string[] } | null {
  const agora = (o.agora ?? new Date()).getTime();
  const idade = (e: EsperaPush) => Math.floor((agora - Date.parse(e.desde)) / MIN);
  const escritorio = o.papel === "admin" || o.papel === "atendente";
  const minhas = o.esperas
    .filter((e) => e.ultimaDoCliente && idade(e) < 24 * 60)
    .filter((e) => (e.donoUserId ? e.donoUserId === o.userId : escritorio))
    .filter((e) => idade(e) >= ESPERA_AVISO_MIN)
    .sort((a, b) => Date.parse(a.desde) - Date.parse(b.desde));
  const chaves = (e: EsperaPush) => [
    `${e.id}:${e.desde}:1`,
    ...(idade(e) >= ESPERA_LEMBRETE_MIN ? [`${e.id}:${e.desde}:2`] : []),
  ];
  const pendentes = minhas.flatMap(chaves).filter((k) => !o.jaAvisadas.has(k));
  if (!pendentes.length) return null;
  if (o.ultimoAvisoEm && agora - Date.parse(o.ultimoAvisoEm) < ESPERA_INTERVALO_MIN * MIN)
    return null;
  const primeira = minhas[0]!;
  const n: Notificacao =
    minhas.length === 1
      ? {
          titulo: "Cliente esperando a equipe",
          corpo: `${primeira.nome} espera resposta há ${tempo(idade(primeira))}.`,
          url: `/conversas/${primeira.id}`,
          tag: "esperas",
        }
      : {
          titulo: `${minhas.length} clientes esperando`,
          corpo: `${minhas
            .slice(0, 3)
            .map((e) => `${e.nome} (${tempo(idade(e))})`)
            .join(", ")}${minhas.length > 3 ? ` e mais ${minhas.length - 3}` : ""}.`,
          url: "/conversas",
          tag: "esperas",
        };
  return { n, marcar: minhas.flatMap(chaves) };
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

/** Agendamento feito pela Alice (aviso "agendamento_alice"): cliente, dia, horário e valor. */
export function notificacaoAgendamentoAlice(a: { titulo: string; mensagem: string }): Notificacao {
  const linhas = a.mensagem.split("\n").map((l) => l.trim());
  const os = /\bOS (\S+)/.exec(a.mensagem)?.[1]?.replace(/[^\w-]/g, "");
  return {
    titulo: a.titulo,
    corpo: [linhas[0], linhas[1]?.replace(/^Valor:\s*/, "")].filter(Boolean).join(" · "),
    url: os ? `/os/${encodeURIComponent(os)}` : "/agenda",
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

/** Resumo das 9h do técnico: só os serviços dele, em ordem de horário. */
export function notificacaoResumoTecnico(
  servicos: { hora: string; cliente: string; bairro: string | null }[],
  atrasados: number,
): Notificacao {
  const lista = [...servicos].sort((a, b) => a.hora.localeCompare(b.hora));
  const itens = lista
    .slice(0, 6)
    .map(
      (s) =>
        `${s.hora.slice(0, 5)} ${s.cliente.split(/\s+/)[0]}${s.bairro ? ` (${s.bairro})` : ""}`,
    )
    .join(", ");
  const mais = lista.length > 6 ? ` e mais ${lista.length - 6}` : "";
  const corpo = lista.length
    ? `Hoje você tem ${plural(lista.length, "serviço", "serviços")}: ${itens}${mais}.`
    : "Hoje você não tem serviços na agenda.";
  return {
    titulo: "Seu dia",
    corpo: atrasados
      ? `${corpo} ${plural(atrasados, "atrasado", "atrasados")} para resolver.`
      : corpo,
    url: "/agenda",
  };
}

/** O técnico deste usuário: pelo e-mail cadastrado no técnico; se não houver, pelo nome. */
export function tecnicoDoUsuario(
  usuario: { id?: string | null; email: string | null; nome: string | null },
  tecnicos: {
    id: string;
    email: string | null;
    nome: string;
    /** Login ligado ao técnico (Usuários e Equipe). */
    userId?: string | null;
    ativo?: boolean;
  }[],
): string | null {
  // Primeiro o técnico ligado ao login; depois e-mail e nome, só entre os ativos.
  const ativos = tecnicos.filter((t) => t.ativo !== false);
  if (usuario.id) {
    const t = ativos.find((x) => x.userId === usuario.id);
    if (t) return t.id;
  }
  const email = (usuario.email ?? "").trim().toLowerCase();
  if (email) {
    const t = ativos.find((x) => (x.email ?? "").trim().toLowerCase() === email);
    if (t) return t.id;
  }
  const nome = (usuario.nome ?? "").trim().toLowerCase();
  if (nome) {
    const iguais = ativos.filter((x) => x.nome.trim().toLowerCase() === nome);
    if (iguais.length === 1) return iguais[0]!.id;
  }
  return null;
}

/** Janela em que o resumo pode sair (São Paulo): das 9h às 11h, uma vez por dia. */
export function horaDoResumo(horaSP: number): boolean {
  return horaSP >= 9 && horaSP < 11;
}

/**
 * Inscrição morta: o serviço de push aceitou pelo menos 10 envios e o aparelho não devolveu
 * nenhum recibo nos últimos 7 dias (ex.: app apagado/reinstalado no iPhone, que a Apple segue
 * aceitando). Inscrição nova (menos de 2 dias) nunca é morta.
 */
export function inscricaoMorta(
  i: {
    created_at?: string | null;
    confirmado_em?: string | null;
    envios_sem_recibo?: number | null;
  },
  agora = new Date(),
): boolean {
  const dia = 86_400_000;
  if (!i.created_at || agora.getTime() - Date.parse(i.created_at) < 2 * dia) return false;
  if ((i.envios_sem_recibo ?? 0) < 10) return false;
  return !i.confirmado_em || agora.getTime() - Date.parse(i.confirmado_em) > 7 * dia;
}

/** Só caminhos internos do app (nada de link para fora). */
export function urlSegura(url: string): string {
  return /^\/(?!\/)[\w\-/?=&.%]*$/.test(url) ? url : "/inicio";
}
