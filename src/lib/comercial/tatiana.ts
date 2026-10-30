/**
 * Tatiana (gerente comercial), fase 2: regras puras da passada da noite. Caixinhas, decisão por
 * lead (uma ação: chamar, agendar, esperar ou parar), "acertos no app" (cobranças) com o botão
 * certo, recado do dia por pessoa e os textos dos pushes. A leitura do banco e as chamadas à IA
 * ficam em noite.server.ts. Nada aqui envia mensagem a cliente.
 */

/** Nome que a equipe vê (no código e no banco continua "comercial"/"gerente"). */
export const NOME_GERENTE = "Tatiana";

export const CAIXINHAS = {
  1: "Comprou",
  2: "Em negociação",
  3: "Retorno com data",
  4: "Achou caro",
  5: "Sumiu depois do orçamento",
  6: "Não chegou a pedir orçamento",
  7: "Fechou com outra empresa",
  8: "Fora da área",
  9: "Descartado",
} as const;
export type Caixinha = keyof typeof CAIXINHAS;

// ---------------------------------------------------------------- cobranças ("acertos no app")

export const TIPOS_COBRANCA = [
  "orcamento_sem_app",
  "fechou_sem_os",
  "remarcar",
  "concluir_os",
  "pagamento",
  "demora_resposta",
  "demora_preco",
  "cadastro",
] as const;
export type TipoCobranca = (typeof TIPOS_COBRANCA)[number];

/** O que o botão do acerto abre. */
export type AcaoCobranca = "orcamento" | "os" | "remarcar" | "concluir" | "cadastro" | "entendi";

export const COBRANCA: Record<TipoCobranca, { rotulo: string; botao: string; acao: AcaoCobranca }> =
  {
    orcamento_sem_app: {
      rotulo: "Preço passado na conversa e sem orçamento no app",
      botao: "Criar orçamento",
      acao: "orcamento",
    },
    fechou_sem_os: { rotulo: "Cliente fechou e ainda não tem OS", botao: "Criar OS", acao: "os" },
    remarcar: {
      rotulo: "Cliente pediu outra data e a visita não foi remarcada",
      botao: "Remarcar",
      acao: "remarcar",
    },
    concluir_os: {
      rotulo: "Serviço feito e OS não concluída",
      botao: "Concluir",
      acao: "concluir",
    },
    pagamento: {
      rotulo: "Pagamento combinado e não lançado",
      botao: "Lançar pagamento",
      acao: "concluir",
    },
    demora_resposta: { rotulo: "Demora na 1ª resposta", botao: "Entendi", acao: "entendi" },
    demora_preco: { rotulo: "Demora até o preço", botao: "Entendi", acao: "entendi" },
    cadastro: {
      rotulo: "Dados do cliente na conversa que faltam no cadastro",
      botao: "Completar cadastro",
      acao: "cadastro",
    },
  };

/** Limites das demoras (minutos), contados pelo sistema. */
export const LIMITE_PRIMEIRA_RESPOSTA_MIN = 15;
export const LIMITE_PRECO_MIN = 60;

export type DemoraLead = {
  primeiraRespostaMin: number | null;
  primeiraRespostaDe: "alice" | "equipe" | null;
  tempoAtePrecoMin: number | null;
  anuncio: boolean;
};

/** Demoras que viram cobrança (só as da equipe; a Alice não é cobrada aqui). */
export function demorasDaEquipe(
  d: DemoraLead,
): Array<{ tipo: "demora_resposta" | "demora_preco"; texto: string }> {
  const saida: Array<{ tipo: "demora_resposta" | "demora_preco"; texto: string }> = [];
  const anuncio = d.anuncio ? " (lead de anúncio)" : "";
  if (
    d.primeiraRespostaDe === "equipe" &&
    d.primeiraRespostaMin !== null &&
    d.primeiraRespostaMin > LIMITE_PRIMEIRA_RESPOSTA_MIN
  )
    saida.push({
      tipo: "demora_resposta",
      texto: `A 1ª resposta levou ${tempoTexto(d.primeiraRespostaMin)}${anuncio}.`,
    });
  if (d.tempoAtePrecoMin !== null && d.tempoAtePrecoMin > LIMITE_PRECO_MIN)
    saida.push({
      tipo: "demora_preco",
      texto: `O preço saiu ${tempoTexto(d.tempoAtePrecoMin)} depois do primeiro contato${anuncio}.`,
    });
  return saida;
}

export function tempoTexto(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24) return `${Math.round(h / 24)} dia(s)`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Estado do app que resolve a cobrança sozinho na noite seguinte. */
export type EstadoApp = {
  orcamentos: Array<{ criadoEm: string }>;
  temOs: boolean;
  visitas: Array<{ data: string | null; status: string | null; atualizadaEm: string }>;
  pagamentoLancado: boolean;
};

export function resolvidaPeloApp(
  c: { tipo: TipoCobranca; criadaEm: string },
  e: EstadoApp,
): boolean {
  const depois = (iso: string) => Date.parse(iso) >= Date.parse(c.criadaEm) - 86_400_000;
  switch (c.tipo) {
    case "orcamento_sem_app":
      return e.orcamentos.some((o) => depois(o.criadoEm));
    case "fechou_sem_os":
      return e.temOs;
    case "remarcar":
      return e.visitas.some((v) => depois(v.atualizadaEm));
    case "concluir_os":
      return e.visitas.some((v) => v.status === "Concluído");
    case "pagamento":
      return e.pagamentoLancado;
    default:
      return false;
  }
}

// ---------------------------------------------------------------- decisão da noite (IA)

export type ItemLido = { descricao: string; quantidade: number; valor: number | null };
export type CampoCadastro = { campo: "nome" | "cpf" | "endereco" | "email" | "cep"; valor: string };

export type DecisaoIA = {
  caixinha: Caixinha;
  servico: string;
  data_evento: string;
  valor_orcado: number | null;
  cidade: string;
  bairro: string;
  acao: "chamar" | "agendar" | "esperar" | "parar";
  quando: string;
  responsavel: "alice" | "equipe";
  motivo: string;
  prioridade: number;
  mensagem: string;
  negociacao: boolean;
  motivo_perda: string;
  acertos: Array<{
    tipo: Exclude<TipoCobranca, "demora_resposta" | "demora_preco">;
    texto: string;
    itens: ItemLido[];
    cadastro: CampoCadastro[];
  }>;
};

const s = { type: "string" } as const;

export const ESQUEMA_DECISAO = {
  type: "object",
  additionalProperties: false,
  required: [
    "caixinha",
    "servico",
    "data_evento",
    "valor_orcado",
    "cidade",
    "bairro",
    "acao",
    "quando",
    "responsavel",
    "motivo",
    "prioridade",
    "mensagem",
    "negociacao",
    "motivo_perda",
    "acertos",
  ],
  properties: {
    caixinha: { type: "integer", enum: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    servico: s,
    data_evento: s,
    valor_orcado: { type: ["number", "null"] },
    cidade: s,
    bairro: s,
    acao: { type: "string", enum: ["chamar", "agendar", "esperar", "parar"] },
    quando: s,
    responsavel: { type: "string", enum: ["alice", "equipe"] },
    motivo: s,
    prioridade: { type: "integer", enum: [1, 2, 3, 4, 5] },
    mensagem: s,
    negociacao: { type: "boolean" },
    motivo_perda: s,
    acertos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "texto", "itens", "cadastro"],
        properties: {
          tipo: {
            type: "string",
            enum: [
              "orcamento_sem_app",
              "fechou_sem_os",
              "remarcar",
              "concluir_os",
              "pagamento",
              "cadastro",
            ],
          },
          texto: s,
          itens: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["descricao", "quantidade", "valor"],
              properties: {
                descricao: s,
                quantidade: { type: "number" },
                valor: { type: ["number", "null"] },
              },
            },
          },
          cadastro: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["campo", "valor"],
              properties: {
                campo: { type: "string", enum: ["nome", "cpf", "endereco", "email", "cep"] },
                valor: s,
              },
            },
          },
        },
      },
    },
  },
} as const;

export function instrucoesDecisao(o: {
  empresa: string;
  temAlice: boolean;
  motivos: string[];
  pixPct: number | null;
}): string {
  const pix = o.pixPct ? `${String(o.pixPct).replace(".", ",")}%` : "o da empresa";
  return [
    `Você é a Tatiana, gerente comercial da ${o.empresa} (limpeza e higienização de estofados; atendimento pelo WhatsApp${o.temAlice ? " com a atendente virtual Alice e a equipe" : " pela equipe"}). Toda noite você lê um lead em aberto (a conversa e o que está no app) e decide o que fazer amanhã. Nada do que você escreve é enviado sozinho ao cliente.`,
    "",
    'Responda em português do Brasil. Use os dados do sistema como verdade (datas, valores, se há orçamento, OS, visita, pagamento). Linhas "Campanha" na conversa são envios em massa do Marketing.',
    "",
    "1. caixinha (uma só, lendo a conversa): 1 Comprou · 2 Em negociação (conversa viva, cliente decidindo) · 3 Retorno com data (cliente deu ou aceitou uma data) · 4 Achou caro · 5 Sumiu depois do orçamento · 6 Não chegou a pedir orçamento · 7 Fechou com outra empresa · 8 Fora da área (preencha cidade e bairro se a conversa disser) · 9 Descartado (spam, parceria, engano, fornecedor).",
    "   servico: o serviço orçado ou feito (curto). data_evento: AAAA-MM-DD se o cliente citou uma data importante (mudança, visita, festa), senão vazio. valor_orcado: o valor do orçamento, se houver.",
    "2. acao (UMA): chamar (alguém deve escrever amanhã), agendar (retomar numa data que faz sentido: quando = AAAA-MM-DDTHH:MM), esperar (não fazer nada agora: o cliente pediu tempo ou já há toque/retorno marcado) ou parar (o cliente recusou ou não é cliente: sugira motivo_perda exatamente com um nome da lista).",
    `   Para chamar, quando = amanhã (AAAA-MM-DDTHH:MM) só se o horário importar (ex.: cliente disse que fala depois das 18h); senão vazio. Motivos da lista: ${o.motivos.join("; ")}.`,
    `3. responsavel: ${o.temAlice ? "alice para toque simples (lembrar, oferecer horário, mandar resumo); equipe para negociação, desconto, reclamação, pedido especial, ou se a equipe já estava conduzindo a conversa. negociacao = true quando envolver preço, desconto ou condição." : "sempre equipe (esta empresa não tem Alice)."}`,
    '   motivo: 1 frase curta, para a equipe, do porquê (ex.: "pediu para falar amanhã depois das 18h").',
    "   prioridade: 1 (mais urgente: cliente quente, data próxima, dinheiro alto) a 5.",
    `4. mensagem (só para chamar ou agendar; senão vazio): o que dizer, pronto para copiar. Cite algo desta conversa, empatia primeiro se o cliente contou um problema, traga algo novo e útil (um horário, um resumo para quem decide, um cuidado), termine com UMA pergunta. Até 3 frases curtas. Pode usar o primeiro nome do cliente. Proibido: "ficou alguma dúvida", "passando para saber", "conseguiu decidir", "está aí?". Ao falar de preço, cite o Pix (${pix}). Nunca invente desconto ou horário exato que não esteja na conversa.`,
    "5. acertos: compare a conversa com o app e liste só o que está faltando no app (lista vazia se nada):",
    "   orcamento_sem_app: alguém passou preço na conversa e não há orçamento no app (itens = o que foi orçado, com quantidade e valor lidos da conversa);",
    "   fechou_sem_os: o cliente fechou (aceitou e combinou data) e não há OS;",
    "   remarcar: o cliente pediu outra data e a visita no app continua na data antiga;",
    "   concluir_os: o serviço foi feito (conversa diz) e a visita não está concluída;",
    "   pagamento: o cliente pagou ou combinou o pagamento e não há pagamento lançado;",
    "   cadastro: a conversa traz nome completo, CPF, endereço, CEP ou e-mail que não estão no cadastro (cadastro = campos e valores lidos).",
    '   texto: 1 frase carinhosa e objetiva, sem bronca (ex.: "O preço de R$ 320 do sofá foi passado na conversa; falta criar o orçamento no app.").',
  ].join("\n");
}

// ---------------------------------------------------------------- recado do dia

/** Frases de reserva (quando a IA falha): curtas, carinhosas e animadas, com o nome. */
export const FRASES_RESERVA = [
  "Bom dia, {nome}! Bora vender, que quem vende vence 💙",
  "Bora fazer acontecer hoje, {nome}!",
  "Bom dia, {nome}! Hoje é dia de fechar negócio 💪",
  "{nome}, bora fazer dinheiro, time! 💙",
  "Bom dia, {nome}! Cada conversa é uma chance, bora aproveitar!",
  "Vamos com tudo hoje, {nome}! ✨",
  "Bom dia, {nome}! Um cliente feliz de cada vez 💙",
  "{nome}, hoje a gente faz bonito! Bora?",
];

/** Escolhe a frase de reserva que não saiu nos últimos 7 dias (estável por dia e pessoa). */
export function fraseReserva(nome: string, recentes: string[], semente: number): string {
  const comNome = FRASES_RESERVA.map((f) => f.replaceAll("{nome}", nome));
  const livres = comNome.filter((f) => !recentes.includes(f));
  const lista = livres.length ? livres : comNome;
  return lista[Math.abs(semente) % lista.length]!;
}

export const ESQUEMA_RECADO = {
  type: "object",
  additionalProperties: false,
  required: ["frase", "resumo"],
  properties: { frase: s, resumo: s },
} as const;

export function instrucoesRecado(): string {
  return [
    "Você é a Tatiana, gerente comercial carinhosa e animada. Escreva o recado do dia para uma pessoa da equipe de vendas, em português do Brasil.",
    'frase: UMA frase curta (até 90 caracteres), motivacional, carinhosa e animada, começando pelo nome da pessoa (ex.: "Bom dia, Maria! Bora vender, que quem vende vence 💙", "Bora fazer acontecer hoje, Carol!"). Não repita nenhuma das frases recentes. Se houver conquista de ontem, use-a (ex.: "ontem saíram 2 vendas, bora repetir!"). Em dia fraco, encoraje sem cobrar. No máximo um emoji.',
    "resumo: até 2 frases com as prioridades do dia (quantas tarefas, o mais importante primeiro, acertos no app se houver). Sem nomes de clientes; pode citar o serviço.",
  ].join("\n");
}

// ---------------------------------------------------------------- pushes

export function textoPushTarefas(
  n: number,
  frase: string | null,
): { titulo: string; corpo: string } {
  return {
    titulo:
      n === 1
        ? `A ${NOME_GERENTE} separou 1 tarefa pra você hoje`
        : `A ${NOME_GERENTE} separou ${n} tarefas pra você hoje`,
    corpo: frase || "Abra a aba Follow-ups para ver.",
  };
}

export function textoPushCobrancas(o: {
  empresa: string;
  total: number;
  resolvidas: number;
  pendentes: number;
}): { titulo: string; corpo: string } {
  return {
    titulo: `${o.empresa}: cobranças da ${NOME_GERENTE}`,
    corpo: `Hoje a ${NOME_GERENTE} fez ${o.total} ${o.total === 1 ? "cobrança" : "cobranças"}: ${o.resolvidas} ${o.resolvidas === 1 ? "resolvida" : "resolvidas"}, ${o.pendentes} ${o.pendentes === 1 ? "pendente" : "pendentes"}.`,
  };
}

// ---------------------------------------------------------------- escopo e comparação

/**
 * Quem entra na noite: lead em aberto com orçamento ou conversa recente, e só com mensagem nova
 * desde a última decisão ou toque marcado para os próximos 2 dias (para baratear).
 */
export function entraNaNoite(l: {
  aberto: boolean;
  temOrcamento: boolean;
  ultimaMensagem: string | null;
  ultimaDecisao: string | null;
  toqueEmAte2Dias: boolean;
  agora: Date;
}): boolean {
  if (!l.aberto) return false;
  const recente =
    l.ultimaMensagem !== null &&
    l.agora.getTime() - Date.parse(l.ultimaMensagem) <= 14 * 86_400_000;
  if (!l.temOrcamento && !recente) return false;
  const nova =
    l.ultimaMensagem !== null &&
    (l.ultimaDecisao === null || Date.parse(l.ultimaMensagem) > Date.parse(l.ultimaDecisao));
  return nova || l.toqueEmAte2Dias;
}

/** O que a cadência padrão faria amanhã (para o teste "padrão faria × Tatiana decidiu"). */
export function padraoFaria(
  pendente: { etapa: string | null; quando: string; responsavel: string } | null,
): string {
  if (!pendente) return "nada marcado";
  const quem = pendente.responsavel === "alice" ? "Alice" : "equipe";
  return `toque ${pendente.etapa ?? ""} (${quem}) em ${dataHoraCurta(pendente.quando)}`.replace(
    "toque  (",
    "toque (",
  );
}

export function dataHoraCurta(iso: string): string {
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")} ${v("hour")}:${v("minute")}`;
}

/** "AAAA-MM-DDTHH:MM" (horário de SP) → ISO; inválido → null. */
export function quandoParaIso(q: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(q)) return null;
  const d = new Date(`${q}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------- histórico de cobranças

export type CobrancaResumo = {
  userId: string | null;
  situacao: "pendente" | "resolvida" | "ja_certo";
  criadaEm: string;
  resolvidaEm: string | null;
};

/** Totais da semana (últimos 7 dias) e da semana anterior, por pessoa. */
export function semanaPorPessoa(cobrancas: CobrancaResumo[], agora = new Date()) {
  const dia = 86_400_000;
  const ini = agora.getTime() - 7 * dia;
  const iniAnt = agora.getTime() - 14 * dia;
  const m = new Map<
    string,
    { semana: number; anterior: number; resolvidas: number; pendentes: number; horas: number[] }
  >();
  for (const c of cobrancas) {
    const k = c.userId ?? "";
    const l = m.get(k) ?? { semana: 0, anterior: 0, resolvidas: 0, pendentes: 0, horas: [] };
    const t = Date.parse(c.criadaEm);
    if (t >= ini) {
      l.semana++;
      if (c.situacao === "pendente") l.pendentes++;
      else {
        l.resolvidas++;
        if (c.resolvidaEm) l.horas.push((Date.parse(c.resolvidaEm) - t) / 3_600_000);
      }
    } else if (t >= iniAnt) l.anterior++;
    m.set(k, l);
  }
  return [...m.entries()].map(([userId, l]) => ({
    userId: userId || null,
    semana: l.semana,
    anterior: l.anterior,
    resolvidas: l.resolvidas,
    pendentes: l.pendentes,
    horasMedias: l.horas.length ? l.horas.reduce((a, b) => a + b, 0) / l.horas.length : null,
  }));
}

/** Pendente há mais de 2 dias (selo no menu). */
export const pendenteAntiga = (
  c: Pick<CobrancaResumo, "situacao" | "criadaEm">,
  agora = new Date(),
) => c.situacao === "pendente" && agora.getTime() - Date.parse(c.criadaEm) > 2 * 86_400_000;
