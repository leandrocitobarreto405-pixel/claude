// Regras da promoção para agenda vazia e do alerta de rodízio (sem banco, para poder testar).
import { chaveTelefone } from "@/lib/avisos";

export type HorarioBase = { tecnicoId: string; tecnico: string; diaSemana: number; hora: string };
export type Ocupacao = {
  tecnicoId: string | null;
  hora: string;
  status: string;
  /** Minutos que o atendimento ocupa (sem valor: a duração padrão da empresa). */
  duracaoMin?: number | null;
  /** Valor do atendimento (regra do dia inteiro: soma do dia do técnico). */
  valor?: number | null;
  /** Marcado à mão na visita: ocupa o dia inteiro (true), nunca (false) ou automático (null). */
  ocupaDia?: boolean | null;
};
export type HorarioLivre = { tecnicoId: string; tecnico: string; hora: string };

/**
 * Regras de capacidade da agenda (02/11/2026): cada atendimento ocupa o técnico por `duracaoMin`
 * a partir da hora marcada, e o dia do técnico fica inteiro quando a soma dos atendimentos chega a
 * `diaInteiroValor` (null ou 0 = regra do valor desligada) ou quando uma visita está marcada
 * "ocupa o dia". Padrão: 180 min e R$ 1.000 (Configurações › Agenda).
 */
export type RegrasAgenda = { duracaoMin: number; diaInteiroValor: number | null };
export const REGRAS_PADRAO: RegrasAgenda = { duracaoMin: 180, diaInteiroValor: 1000 };

/** Atendimentos que não ocupam mais o horário. */
const NAO_OCUPAM = ["Cancelado", "Reagendado", "Reagendado com deslocamento"];

/** 0 = domingo ... 6 = sábado, para uma data AAAA-MM-DD. */
export function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

const hhmm = (h: string) => h.slice(0, 5);

const minutosDe = (h: string) => {
  const t = hhmm(h);
  return /^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null;
};

/** Regras com os padrões no lugar do que vier vazio ou inválido. */
export function regrasDaAgenda(
  r: { duracaoMin?: number | string | null; diaInteiroValor?: number | string | null } | null,
): RegrasAgenda {
  const dur = Number(r?.duracaoMin ?? REGRAS_PADRAO.duracaoMin);
  const valor =
    r?.diaInteiroValor === undefined ? REGRAS_PADRAO.diaInteiroValor : r.diaInteiroValor;
  const v = valor === null ? null : Number(valor);
  return {
    duracaoMin: Number.isFinite(dur) && dur > 0 ? dur : REGRAS_PADRAO.duracaoMin,
    diaInteiroValor: v === null || !Number.isFinite(v) || v <= 0 ? null : v,
  };
}

/** Atendimento do técnico (ou sem técnico, que vale para todos). */
const doTecnico = (o: Ocupacao, tecnicoId: string) =>
  o.tecnicoId === null || o.tecnicoId === tecnicoId;

/**
 * O dia do técnico está tomado? Uma visita marcada "ocupa o dia" (do técnico ou sem técnico), ou
 * a soma dos atendimentos ativos do dia chega ao valor do dia inteiro (as marcadas "não ocupa"
 * ficam fora da soma).
 */
export function diaInteiroDoTecnico(
  ativas: Ocupacao[],
  tecnicoId: string,
  regras: RegrasAgenda = REGRAS_PADRAO,
): boolean {
  const suas = ativas.filter((o) => doTecnico(o, tecnicoId));
  if (suas.some((o) => o.ocupaDia === true)) return true;
  if (!regras.diaInteiroValor) return false;
  const soma = suas
    .filter((o) => o.ocupaDia !== false)
    .reduce((s, o) => s + Number(o.valor ?? 0), 0);
  return soma >= regras.diaInteiroValor;
}

/**
 * Horários base livres de um dia. O horário do técnico (janela de `duracaoMin` a partir da hora
 * base) está ocupado quando um atendimento ativo dele, ou sem técnico, sobrepõe essa janela: a
 * visita das 9h30 ocupa o horário das 9h; a das 16h ocupa o das 14h. Com o dia inteiro tomado
 * (visita "ocupa o dia" ou soma do dia no valor da regra), nenhum horário do técnico fica livre.
 */
export function horariosLivres(
  base: HorarioBase[],
  ocupacoes: Ocupacao[],
  data: string,
  regras: RegrasAgenda = REGRAS_PADRAO,
): HorarioLivre[] {
  const dia = diaDaSemana(data);
  const ativas = ocupacoes.filter((o) => !NAO_OCUPAM.includes(o.status));
  const dur = regras.duracaoMin;
  const ocupado = (b: HorarioBase) => {
    const ini = minutosDe(b.hora);
    if (ini === null) return false;
    const fim = ini + dur;
    return ativas.some((o) => {
      if (!doTecnico(o, b.tecnicoId)) return false;
      const oIni = minutosDe(o.hora);
      if (oIni === null) return false;
      const oFim = oIni + Number(o.duracaoMin ?? dur);
      return oIni < fim && ini < oFim;
    });
  };
  const diaInteiro = new Map<string, boolean>();
  const tomado = (tecnicoId: string) => {
    if (!diaInteiro.has(tecnicoId))
      diaInteiro.set(tecnicoId, diaInteiroDoTecnico(ativas, tecnicoId, regras));
    return diaInteiro.get(tecnicoId) ?? false;
  };
  return base
    .filter((b) => b.diaSemana === dia)
    .filter((b) => !tomado(b.tecnicoId) && !ocupado(b))
    .map((b) => ({ tecnicoId: b.tecnicoId, tecnico: b.tecnico, hora: hhmm(b.hora) }))
    .sort((a, b) => a.hora.localeCompare(b.hora) || a.tecnico.localeCompare(b.tecnico));
}

export type Candidato = {
  telefone: string;
  nome: string;
  origem: "orcamento" | "conversa";
  /** Data do orçamento ou da conversa (ISO), para mostrar. */
  desde: string;
};

export type Destinatario = Candidato & { chave: string };

/**
 * Quem recebe a promoção: orçamentos em aberto e conversas novas, sem repetir pessoa, sem quem
 * já tem agendamento, sem contato interno da equipe e sem quem saiu das ofertas.
 */
export function montarDestinatarios(
  candidatos: Candidato[],
  bloqueados: { comAgendamento: string[]; internos: string[]; optout: string[] },
): Destinatario[] {
  const fora = new Set(
    [...bloqueados.comAgendamento, ...bloqueados.internos, ...bloqueados.optout]
      .map(chaveTelefone)
      .filter((c): c is string => Boolean(c)),
  );
  const vistos = new Set<string>();
  const lista: Destinatario[] = [];
  for (const c of candidatos) {
    const chave = chaveTelefone(c.telefone);
    if (!chave || chave.length < 10 || fora.has(chave) || vistos.has(chave)) continue;
    if (!c.nome.trim()) continue;
    vistos.add(chave);
    lista.push({ ...c, nome: c.nome.trim(), chave });
  }
  return lista;
}

/** "20%" ou "12,5%". */
export function pct(n: number): string {
  return `${String(Number(n)).replace(".", ",")}%`;
}

/** Prévia da mensagem (o texto exato vem do modelo aprovado na Meta). */
export function previaMensagem(
  nome: string,
  desconto: number,
  pix: number,
  empresa: string,
): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  return `Oi, ${primeiro}! Aqui é da ${empresa}. Abriu um horário amanhã e consigo fazer o seu serviço com ${pct(
    desconto,
  )} de desconto, e mais ${pct(pix)} se pagar no Pix. Quer que eu reserve para você?`;
}

// ---------------------------------------------------------------- valores, distância e margem
export type Coordenada = { lat: number; lon: number };

/** Distância em linha reta (km), pela fórmula de haversine. */
export function distanciaKm(a: Coordenada, b: Coordenada): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** Valor com o desconto da promoção somado ao do Pix (ex.: 20% + 5% = 25% a menos). */
export function valorComDesconto(valor: number, descontoPct: number, pixPct: number): number {
  return Math.round(valor * (1 - (descontoPct + pixPct) / 100) * 100) / 100;
}

export type TipoOrcamento = "higienizacao" | "impermeabilizacao" | "ambos" | null;

/** Tipo do orçamento pelos itens (higienização, impermeabilização ou os dois). */
export function tipoDoOrcamento(tipos: Array<string | null | undefined>): TipoOrcamento {
  const hig = tipos.some((t) => /higien/i.test(t ?? ""));
  const imp = tipos.some((t) => /imperm/i.test(t ?? ""));
  if (hig && imp) return "ambos";
  if (imp) return "impermeabilizacao";
  if (hig) return "higienizacao";
  return null;
}

export type CustosEmpresa = {
  impostoPct: number;
  /** R$ por km rodado (null = não configurado). */
  custoKm: number | null;
  produtoHigienizacao: number;
  produtoImpermeabilizacao: number;
};

export function custoProduto(tipo: TipoOrcamento, c: CustosEmpresa): number {
  if (tipo === "ambos") return c.produtoHigienizacao + c.produtoImpermeabilizacao;
  if (tipo === "impermeabilizacao") return c.produtoImpermeabilizacao;
  if (tipo === "higienizacao") return c.produtoHigienizacao;
  return 0;
}

export type Margem = {
  valor: number;
  imposto: number;
  deslocamento: number | null;
  produto: number;
};

/**
 * Margem de contribuição estimada já com o desconto: valor − imposto − deslocamento − produto.
 * Sem mão de obra. Deslocamento = km da ida (do ponto de partida até o cliente, sem volta) ×
 * custo por km (null se faltar um dos dois).
 */
export function margemEstimada(
  valorPromo: number,
  kmIda: number | null,
  tipo: TipoOrcamento,
  c: CustosEmpresa,
): Margem {
  const imposto = Math.round(valorPromo * (c.impostoPct / 100) * 100) / 100;
  const deslocamento =
    kmIda !== null && c.custoKm !== null ? Math.round(kmIda * c.custoKm * 100) / 100 : null;
  const produto = custoProduto(tipo, c);
  return {
    valor: Math.round((valorPromo - imposto - (deslocamento ?? 0) - produto) * 100) / 100,
    imposto,
    deslocamento,
    produto,
  };
}

/** Quem começa marcado: fora da margem mínima ou da distância máxima fica desmarcado, com o motivo. */
export function avaliarLimites(
  p: { margem: number | null; km: number | null },
  limites: { margemMin: number | null; kmMax: number | null },
): { marcado: boolean; motivo: string | null } {
  const motivos: string[] = [];
  if (limites.margemMin !== null && p.margem !== null && p.margem < limites.margemMin)
    motivos.push(
      `margem abaixo de ${limites.margemMin.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    );
  if (limites.kmMax !== null && p.km !== null && p.km > limites.kmMax)
    motivos.push(
      `a ${String(p.km).replace(".", ",")} km (máximo ${String(limites.kmMax).replace(".", ",")} km)`,
    );
  return { marcado: motivos.length === 0, motivo: motivos.length ? motivos.join(" e ") : null };
}

/** De onde o técnico sairia para o horário livre: o serviço anterior dele no dia ou a base. */
export type Partida = {
  tecnicoId: string;
  tecnico: string;
  /** Horário livre ("14:00"). */
  hora: string;
  tipo: "base" | "servico";
  coord: Coordenada;
};

/** Ponto de partida de cada horário livre: o último serviço do técnico antes dele, senão a base. */
export function partidasDosHorarios(
  livres: HorarioLivre[],
  bases: Map<string, Coordenada | null>,
  servicos: Array<{ tecnicoId: string; hora: string; coord: Coordenada }>,
): Partida[] {
  const lista: Partida[] = [];
  for (const l of livres) {
    const antes = servicos
      .filter((s) => s.tecnicoId === l.tecnicoId && s.hora.slice(0, 5) < l.hora)
      .sort((a, b) => b.hora.localeCompare(a.hora))[0];
    if (antes) {
      lista.push({
        tecnicoId: l.tecnicoId,
        tecnico: l.tecnico,
        hora: l.hora,
        tipo: "servico",
        coord: antes.coord,
      });
      continue;
    }
    const base = bases.get(l.tecnicoId);
    if (base)
      lista.push({
        tecnicoId: l.tecnicoId,
        tecnico: l.tecnico,
        hora: l.hora,
        tipo: "base",
        coord: base,
      });
  }
  return lista;
}

export type DistanciaPartida = {
  partida: Omit<Partida, "coord">;
  /** Km pelas ruas, só a ida. */
  km: number;
  /** O roteador não respondeu: linha reta × 1,3. */
  aproximado: boolean;
};

export type EntradaPromocao = {
  chave: string;
  telefone: string;
  nome: string;
  familias: string[];
  diasOrcamento: number | null;
  diasConversa: number | null;
  /** Valor total do orçamento em aberto (null = sem orçamento). */
  valor: number | null;
  /** Km de ida e volta calculado no orçamento (da base da empresa), se houver. */
  kmOrcamento: number | null;
  tipo: TipoOrcamento;
  /** O endereço do cliente foi localizado no mapa. */
  localizado: boolean;
  /** Distância até o cliente a partir de cada ponto de partida dos horários livres. */
  distancias: DistanciaPartida[];
};

export type DestinatarioPromocao = {
  chave: string;
  telefone: string;
  nome: string;
  familias: string[];
  diasOrcamento: number | null;
  diasConversa: number | null;
  valor: number | null;
  valorPromo: number | null;
  valorPix: number | null;
  /** Técnico e horário livre mais perto, e de onde ele sairia. */
  tecnico: string | null;
  hora: string | null;
  partida: "base" | "servico" | "orcamento" | null;
  /** Km da ida (sem volta): conta para o limite e para o deslocamento. */
  km: number | null;
  /** Linha reta × 1,3 porque o roteador não respondeu. */
  kmAproximado: boolean;
  margem: Margem | null;
  marcado: boolean;
  motivo: string | null;
  /** "sem orçamento", "sem endereço"…: só informam, não desmarcam. */
  avisos: string[];
  /** Sem nome não dá para enviar (o modelo usa o primeiro nome). */
  podeEnviar: boolean;
};

/**
 * Monta cada pessoa da promoção: valor com desconto (e no Pix), horário livre mais perto (pela
 * ida a partir do serviço anterior do técnico ou da base), km e margem estimada no Pix (o pior
 * caso). Fora da margem mínima ou da distância máxima começa desmarcado, com o motivo; sem
 * orçamento ou sem endereço começa marcado.
 */
export function prepararDestinatario(
  e: EntradaPromocao,
  cfg: { descontoPct: number; pixPct: number; margemMin: number | null; kmMax: number | null },
  custos: CustosEmpresa,
): DestinatarioPromocao {
  const avisos: string[] = [];
  const valorPromo = e.valor === null ? null : valorComDesconto(e.valor, cfg.descontoPct, 0);
  const valorPix = e.valor === null ? null : valorComDesconto(e.valor, cfg.descontoPct, cfg.pixPct);
  if (e.valor === null) avisos.push("sem orçamento");

  const melhor = [...e.distancias].sort((a, b) => a.km - b.km)[0] ?? null;
  let km: number | null = melhor?.km ?? null;
  let partida: DestinatarioPromocao["partida"] = melhor?.partida.tipo ?? null;
  if (km === null && e.kmOrcamento !== null && e.kmOrcamento > 0) {
    // Sem endereço localizado: metade do km de ida e volta do orçamento (da base da empresa).
    km = Math.round((e.kmOrcamento / 2) * 10) / 10;
    partida = "orcamento";
  }
  if (!e.localizado && km === null) avisos.push("sem endereço");

  const margem = valorPix === null ? null : margemEstimada(valorPix, km, e.tipo, custos);
  const podeEnviar = e.nome.trim().length > 0;
  const limites = avaliarLimites(
    { margem: margem?.valor ?? null, km },
    { margemMin: cfg.margemMin, kmMax: cfg.kmMax },
  );
  return {
    chave: e.chave,
    telefone: e.telefone,
    nome: e.nome.trim(),
    familias: e.familias,
    diasOrcamento: e.diasOrcamento,
    diasConversa: e.diasConversa,
    valor: e.valor,
    valorPromo,
    valorPix,
    tecnico: melhor?.partida.tecnico ?? null,
    hora: melhor?.partida.hora ?? null,
    partida,
    km,
    kmAproximado: Boolean(melhor?.aproximado) && partida !== "orcamento",
    margem,
    marcado: podeEnviar && limites.marcado,
    motivo: podeEnviar ? limites.motivo : "sem nome no cadastro: não dá para enviar",
    avisos,
    podeEnviar,
  };
}

// ---------------------------------------------------------------- rodízio
export type ConfigRodizio = {
  comecarAPartir: string; // "11:00"
  tardeInicio: string; // "17:00"
  duracaoMin: number;
  voltaMin: number;
};

export type Veiculo = { nome: string; tecnicoId: string | null; diaRodizio: number | null };

const minutos = (h: string) => {
  const [hh, mm] = h.split(":").map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
};
const horaTexto = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * Alerta (não bloqueia) ao marcar no dia do rodízio do veículo do técnico: começar antes do
 * horário mínimo, ou o fim do atendimento + a volta passar do início do rodízio da tarde.
 */
export function alertaRodizio(
  a: { data: string; hora: string; tecnicoId: string | null },
  veiculos: Veiculo[],
  cfg: ConfigRodizio,
): string | null {
  if (!a.data || !a.hora || !a.tecnicoId) return null;
  const dia = diaDaSemana(a.data);
  const v = veiculos.find((x) => x.tecnicoId === a.tecnicoId && x.diaRodizio === dia);
  if (!v) return null;
  const inicio = minutos(a.hora.slice(0, 5));
  const fimComVolta = inicio + cfg.duracaoMin + cfg.voltaMin;
  const problemas: string[] = [];
  if (inicio < minutos(cfg.comecarAPartir))
    problemas.push(`começa antes das ${cfg.comecarAPartir.slice(0, 5)}`);
  if (fimComVolta > minutos(cfg.tardeInicio))
    problemas.push(
      `com a volta, termina por volta das ${horaTexto(fimComVolta)} (rodízio a partir das ${cfg.tardeInicio.slice(0, 5)})`,
    );
  if (!problemas.length) return null;
  return `Dia de rodízio do ${v.nome} (${NOMES_DIA[dia]}): ${problemas.join(" e ")}.`;
}

/** Chaves do React Query da promoção (cartões e tela). */
export const CHAVE_RESUMO_PROMOCAO = ["promocao", "resumo"] as const;
export const CHAVE_SITUACAO_PROMOCAO = ["promocao", "situacao"] as const;
