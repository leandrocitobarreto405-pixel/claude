/**
 * Modelos de mensagem (Meta) e textos sem aprovação: regras puras, sem banco nem rede, para poder
 * testar. A tela "Modelos de mensagem" e o servidor usam estas funções.
 *
 * - Modelo da Meta: precisa de aprovação. O formulário vira os "components" da API de gestão de
 *   modelos (cabeçalho em texto, corpo com {{1}}, {{2}}..., rodapé e botões).
 * - Texto sem aprovação: o Nexa envia como mensagem comum (cliente escreveu nas últimas 24 h, ou
 *   texto que vai dentro do modelo de aviso). Usa variáveis com chaves simples: {nome}.
 */

// ---------------------------------------------------------------- modelos da Meta
export type CategoriaModelo = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type BotaoMeta = {
  type?: string;
  text?: string;
  url?: string;
  phone_number?: string;
  [k: string]: unknown;
};

export type ComponenteMeta = {
  type: string;
  format?: string;
  text?: string;
  example?: { body_text?: string[][]; header_text?: string[]; [k: string]: unknown };
  buttons?: BotaoMeta[];
  [k: string]: unknown;
};

/** Modelo como a API da Meta (ou o Chatwoot) devolve. */
export type ModeloDaMeta = {
  id?: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  quality_score?: { score?: string } | string | null;
  rejected_reason?: string | null;
  components?: ComponenteMeta[];
};

export type BotaoForm =
  | { tipo: "QUICK_REPLY"; texto: string }
  | { tipo: "URL"; texto: string; url: string }
  | { tipo: "PHONE_NUMBER"; texto: string; telefone: string };

export type FormModelo = {
  nome: string;
  idioma: string;
  categoria: CategoriaModelo;
  cabecalho: string;
  corpo: string;
  /** Exemplo de cada variável do corpo ({{1}}, {{2}}...), exigido pela Meta. */
  exemplos: string[];
  rodape: string;
  botoes: BotaoForm[];
};

export const FORM_VAZIO: FormModelo = {
  nome: "",
  idioma: "pt_BR",
  categoria: "MARKETING",
  cabecalho: "",
  corpo: "",
  exemplos: [],
  rodape: "",
  botoes: [],
};

const VAR = /\{\{\s*([^}]*?)\s*\}\}/g;

/** Variáveis do texto, na ordem em que aparecem (com repetição). */
export function variaveisDoTexto(texto: string): string[] {
  return [...texto.matchAll(VAR)].map((m) => m[1] ?? "");
}

/** Quantas variáveis numeradas o corpo usa (a maior: {{1}}..{{n}}). */
export function quantasVariaveis(corpo: string): number {
  const nums = variaveisDoTexto(corpo)
    .filter((v) => /^\d+$/.test(v))
    .map(Number);
  return nums.length ? Math.max(...nums) : 0;
}

export const LIMITES = { corpo: 1024, cabecalho: 60, rodape: 60, botao: 25, botoes: 10, nome: 512 };

/** Problemas que fariam a Meta recusar o envio (em português, para mostrar na tela). */
export function validarFormulario(f: FormModelo): string[] {
  const p: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(f.nome))
    p.push("Nome: só letras minúsculas sem acento, números e _ (ex.: promocao_agenda).");
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(f.idioma)) p.push("Idioma inválido (ex.: pt_BR).");
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(f.categoria))
    p.push("Escolha a categoria.");
  const corpo = f.corpo.trim();
  if (!corpo) p.push("Escreva o texto da mensagem.");
  if (corpo.length > LIMITES.corpo) p.push(`Texto com mais de ${LIMITES.corpo} caracteres.`);
  const vars = variaveisDoTexto(corpo);
  if (vars.some((v) => !/^\d+$/.test(v)))
    p.push("Use variáveis numeradas: {{1}}, {{2}}... (sem nomes).");
  const n = quantasVariaveis(corpo);
  for (let i = 1; i <= n; i++)
    if (!vars.includes(String(i))) p.push(`Falta a variável {{${i}}} (elas vão em sequência).`);
  for (let i = 0; i < n; i++)
    if (!(f.exemplos[i] ?? "").trim()) p.push(`Preencha um exemplo para {{${i + 1}}}.`);
  if (n && /^\s*\{\{/.test(corpo)) p.push("A Meta não aceita o texto começando com variável.");
  if (n && /\}\}\s*$/.test(corpo)) p.push("A Meta não aceita o texto terminando com variável.");
  if (/\}\}\s*\{\{/.test(corpo)) p.push("Coloque alguma palavra entre duas variáveis.");
  if (f.cabecalho.length > LIMITES.cabecalho)
    p.push(`Título com mais de ${LIMITES.cabecalho} caracteres.`);
  if (variaveisDoTexto(f.cabecalho).length) p.push("O título não pode ter variável.");
  if (f.rodape.length > LIMITES.rodape) p.push(`Rodapé com mais de ${LIMITES.rodape} caracteres.`);
  if (variaveisDoTexto(f.rodape).length) p.push("O rodapé não pode ter variável.");
  if (f.botoes.length > LIMITES.botoes) p.push(`No máximo ${LIMITES.botoes} botões.`);
  for (const b of f.botoes) {
    if (!b.texto.trim()) p.push("Botão sem texto.");
    else if (b.texto.length > LIMITES.botao)
      p.push(`Botão "${b.texto}" com mais de ${LIMITES.botao} caracteres.`);
    if (b.tipo === "URL" && !/^https:\/\/\S+$/.test(b.url))
      p.push(`Botão "${b.texto}": link inválido.`);
    if (b.tipo === "PHONE_NUMBER" && !/^\+?\d{10,15}$/.test(b.telefone.replace(/\D/g, "")))
      p.push(`Botão "${b.texto}": telefone inválido.`);
  }
  return p;
}

/** Formulário → "components" da API de gestão de modelos. */
export function componentesDoFormulario(f: FormModelo): ComponenteMeta[] {
  const c: ComponenteMeta[] = [];
  if (f.cabecalho.trim()) c.push({ type: "HEADER", format: "TEXT", text: f.cabecalho.trim() });
  const corpo = f.corpo.trim();
  const n = quantasVariaveis(corpo);
  c.push(
    n
      ? {
          type: "BODY",
          text: corpo,
          example: { body_text: [f.exemplos.slice(0, n).map((e) => e.trim())] },
        }
      : { type: "BODY", text: corpo },
  );
  if (f.rodape.trim()) c.push({ type: "FOOTER", text: f.rodape.trim() });
  if (f.botoes.length)
    c.push({
      type: "BUTTONS",
      buttons: f.botoes.map((b) =>
        b.tipo === "URL"
          ? { type: "URL", text: b.texto.trim(), url: b.url.trim() }
          : b.tipo === "PHONE_NUMBER"
            ? { type: "PHONE_NUMBER", text: b.texto.trim(), phone_number: b.telefone.trim() }
            : { type: "QUICK_REPLY", text: b.texto.trim() },
      ),
    });
  return c;
}

/**
 * Modelo da Meta → formulário. Formatos que o app não edita (cabeçalho com imagem ou vídeo,
 * carrossel, botões de código ou de fluxo) voltam com o motivo em `naoEditavel`.
 */
export function formularioDoModelo(m: ModeloDaMeta): FormModelo & { naoEditavel: string | null } {
  const comps = m.components ?? [];
  let naoEditavel: string | null = null;
  const tipo = (c: ComponenteMeta) => String(c.type ?? "").toUpperCase();
  const cab = comps.find((c) => tipo(c) === "HEADER");
  if (cab && String(cab.format ?? "TEXT").toUpperCase() !== "TEXT")
    naoEditavel = "o título tem imagem, vídeo ou documento";
  else if (cab && variaveisDoTexto(cab.text ?? "").length) naoEditavel = "o título tem variável";
  const desconhecido = comps.find(
    (c) => !["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(tipo(c)),
  );
  if (desconhecido) naoEditavel = `tem um bloco do tipo ${tipo(desconhecido).toLowerCase()}`;
  const corpo = comps.find((c) => tipo(c) === "BODY");
  const botoes: BotaoForm[] = [];
  for (const b of comps.find((c) => tipo(c) === "BUTTONS")?.buttons ?? []) {
    const t = String(b.type ?? "QUICK_REPLY").toUpperCase();
    if (t === "QUICK_REPLY") botoes.push({ tipo: "QUICK_REPLY", texto: b.text ?? "" });
    else if (t === "URL") botoes.push({ tipo: "URL", texto: b.text ?? "", url: b.url ?? "" });
    else if (t === "PHONE_NUMBER")
      botoes.push({ tipo: "PHONE_NUMBER", texto: b.text ?? "", telefone: b.phone_number ?? "" });
    else naoEditavel = `tem um botão do tipo ${t.toLowerCase()}`;
  }
  const cat = String(m.category ?? "MARKETING").toUpperCase();
  return {
    nome: m.name,
    idioma: m.language,
    categoria: (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(cat)
      ? cat
      : "MARKETING") as CategoriaModelo,
    cabecalho: cab?.text ?? "",
    corpo: corpo?.text ?? "",
    exemplos: corpo?.example?.body_text?.[0] ?? [],
    rodape: comps.find((c) => tipo(c) === "FOOTER")?.text ?? "",
    botoes,
    naoEditavel,
  };
}

/** Texto como o cliente vê, com os exemplos no lugar das variáveis. */
export function previaDoFormulario(f: FormModelo): string {
  const corpo = f.corpo.replace(VAR, (_, v: string) =>
    /^\d+$/.test(v) ? f.exemplos[Number(v) - 1] || `{{${v}}}` : `{{${v}}}`,
  );
  return [f.cabecalho.trim(), corpo.trim(), f.rodape.trim()].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------- situação e limites
export type Tom = "neutro" | "sucesso" | "atencao" | "problema";

export function situacaoDoModelo(status: string): { rotulo: string; tom: Tom } {
  switch (String(status).toUpperCase()) {
    case "APPROVED":
      return { rotulo: "Aprovado", tom: "sucesso" };
    case "PENDING":
      return { rotulo: "Em análise", tom: "atencao" };
    case "IN_APPEAL":
      return { rotulo: "Em recurso", tom: "atencao" };
    case "REJECTED":
      return { rotulo: "Recusado", tom: "problema" };
    case "PAUSED":
      return { rotulo: "Pausado pela Meta", tom: "problema" };
    case "DISABLED":
      return { rotulo: "Desativado pela Meta", tom: "problema" };
    case "LIMIT_EXCEEDED":
      return { rotulo: "Limite de modelos", tom: "problema" };
    case "PENDING_DELETION":
    case "DELETED":
      return { rotulo: "Apagado", tom: "neutro" };
    case "ARCHIVED":
      return { rotulo: "Arquivado", tom: "neutro" };
    default:
      return { rotulo: status || "Desconhecido", tom: "neutro" };
  }
}

const MOTIVOS: Record<string, string> = {
  ABUSIVE_CONTENT: "conteúdo considerado abusivo",
  INCORRECT_CATEGORY: "categoria errada (ex.: promoção marcada como utilidade)",
  INVALID_FORMAT: "formato inválido (variáveis, exemplos ou caracteres)",
  PROMOTIONAL: "conteúdo promocional numa categoria que não é Marketing",
  TAG_CONTENT_MISMATCH: "o texto não combina com a categoria escolhida",
  SCAM: "suspeita de golpe",
};

/** Motivo da recusa em português ("" quando a Meta não informou). */
export function motivoDaRecusa(motivo: string | null | undefined): string {
  const m = String(motivo ?? "").toUpperCase();
  if (!m || m === "NONE") return "";
  return MOTIVOS[m] ?? m.toLowerCase().replace(/_/g, " ");
}

export type RegraEdicao = {
  pode: boolean;
  /** Por que não pode (ou "" quando pode). */
  motivo: string;
  /** Linha para mostrar na tela, ex.: "Edições: 1 de 10 nos últimos 30 dias". */
  resumo: string;
  usadas24h: number;
  usadas30d: number;
  /** Quando abre a próxima edição (ISO), se o limite estiver cheio. */
  liberaEm: string | null;
};

const DIA = 86_400_000;

/**
 * Limite da Meta: modelo aprovado aceita 1 edição a cada 24 h e 10 a cada 30 dias; recusado ou
 * pausado, edições à vontade; em análise, recurso, desativado etc., nenhuma.
 * `edicoes`: quando o Nexa editou este modelo enquanto ele estava aprovado.
 */
export function regraDeEdicao(status: string, edicoes: string[], agora = new Date()): RegraEdicao {
  const s = String(status).toUpperCase();
  const t = agora.getTime();
  const datas = edicoes.map((e) => Date.parse(e)).filter((d) => Number.isFinite(d) && d <= t);
  const em24 = datas.filter((d) => t - d < DIA).sort((a, b) => a - b);
  const em30 = datas.filter((d) => t - d < 30 * DIA).sort((a, b) => a - b);
  const base = {
    usadas24h: em24.length,
    usadas30d: em30.length,
    liberaEm: null as string | null,
  };
  if (s === "REJECTED" || s === "PAUSED")
    return { ...base, pode: true, motivo: "", resumo: "Pode editar à vontade até ser aprovado." };
  if (s !== "APPROVED")
    return {
      ...base,
      pode: false,
      motivo:
        s === "PENDING" || s === "IN_APPEAL"
          ? "A Meta ainda está analisando este modelo. Espere a resposta para editar."
          : "A Meta não permite editar um modelo nesta situação.",
      resumo: "",
    };
  const resumo = `Edições: ${em30.length} de 10 nos últimos 30 dias (no máximo 1 por dia).`;
  if (em24.length >= 1) {
    const libera = new Date(em24[0]! + DIA).toISOString();
    return {
      ...base,
      liberaEm: libera,
      pode: false,
      motivo: "Este modelo já foi editado nas últimas 24 h (limite da Meta: 1 por dia).",
      resumo,
    };
  }
  if (em30.length >= 10) {
    const libera = new Date(em30[em30.length - 10]! + 30 * DIA).toISOString();
    return {
      ...base,
      liberaEm: libera,
      pode: false,
      motivo: "Este modelo chegou a 10 edições em 30 dias (limite da Meta).",
      resumo,
    };
  }
  return { ...base, pode: true, motivo: "", resumo };
}

// ---------------------------------------------------------------- modelo de cada finalidade
/**
 * Cada envio usa o modelo da sua finalidade. A empresa escolhe o nome (cada empresa tem a própria
 * conta do WhatsApp na Meta); sem escolha, vale o nome neutro. A Turbine Clean usa os nomes tc_.
 */
export const FINALIDADES: { chave: string; rotulo: string; padrao: string }[] = [
  {
    chave: "posvenda",
    rotulo: "Pós-venda (dia seguinte ao serviço)",
    padrao: "posvenda_resultado",
  },
  { chave: "oferta", rotulo: "Campanhas: clientes de 3 a 12 meses", padrao: "oferta_trimestral" },
  {
    chave: "reativacao",
    rotulo: "Campanhas: reativação de clientes antigos",
    padrao: "reativacao_cliente",
  },
  {
    chave: "orcamento",
    rotulo: "Campanhas: orçamentos que não fecharam",
    padrao: "orcamento_retomada",
  },
  {
    chave: "higienizacao_6m",
    rotulo: "Lembrete de higienização (6 meses)",
    padrao: "higienizacao_6meses",
  },
  {
    chave: "imper_13m",
    rotulo: "Lembrete de impermeabilização (13 meses)",
    padrao: "imper_13meses",
  },
  {
    chave: "imper_13m_lembrete",
    rotulo: "Segundo lembrete de impermeabilização",
    padrao: "imper_13meses_lembrete",
  },
  {
    chave: "sazonal_prefixo",
    rotulo: "Campanha sazonal (começo do nome + mês)",
    padrao: "sazonal_",
  },
  {
    chave: "conversa",
    rotulo: "Listas: conversou e não pediu orçamento",
    padrao: "conversa_retomada",
  },
  { chave: "preco", rotulo: "Listas: perdido por preço", padrao: "preco_retomada" },
];

/** Nome do modelo de cada finalidade, com os padrões preenchidos. */
export function modelosDaEmpresa(salvos: unknown): Record<string, string> {
  const s = (salvos && typeof salvos === "object" ? salvos : {}) as Record<string, unknown>;
  return Object.fromEntries(
    FINALIDADES.map((f) => {
      const v = typeof s[f.chave] === "string" ? String(s[f.chave]).trim() : "";
      return [f.chave, v || f.padrao];
    }),
  );
}

export type ContextoUso = {
  modeloAviso: string | null;
  modeloPromocao: string | null;
  /** Nome do modelo de cada finalidade (de modelosDaEmpresa). */
  modelos: Record<string, string>;
};

/** Onde o Nexa usa o modelo (null = nenhum lugar conhecido). */
export function ondeEUsado(nome: string, ctx: ContextoUso): string | null {
  const base = nome.replace(/_sn$/, "");
  const sn = nome.endsWith("_sn") ? " (versão sem o nome do cliente)" : "";
  if (ctx.modeloAviso && nome === ctx.modeloAviso) return "Avisos da equipe no WhatsApp";
  if (ctx.modeloPromocao && nome === ctx.modeloPromocao) return "Promoção da agenda";
  const sazonal = ctx.modelos["sazonal_prefixo"];
  for (const f of FINALIDADES) {
    if (f.chave === "sazonal_prefixo") continue;
    if (ctx.modelos[f.chave] === base) return f.rotulo + sn;
  }
  if (sazonal && base.startsWith(sazonal))
    return `Campanha sazonal (${base.slice(sazonal.length)})${sn}`;
  return null;
}

/** Modelos que o Nexa usa e que precisam existir na Meta. */
export function modelosEsperados(ctx: ContextoUso): string[] {
  return [
    ...[
      "posvenda",
      "oferta",
      "reativacao",
      "orcamento",
      "higienizacao_6m",
      "imper_13m",
      "conversa",
      "preco",
    ].map((k) => ctx.modelos[k]),
    ctx.modeloPromocao,
    ctx.modeloAviso,
  ].filter((n, i, a): n is string => Boolean(n) && a.indexOf(n) === i);
}

/** Texto inicial para criar um modelo que falta (quando o Nexa sabe qual é). */
export function sugestaoDeModelo(
  nome: string,
  ctx: {
    modeloPromocao: string | null;
    modeloAviso: string | null;
    empresa: string;
    modelos?: Record<string, string>;
  },
): FormModelo | null {
  const base = nome.replace(/_sn$/, "");
  const semNome = nome.endsWith("_sn");
  // Listas novas: {{1}} = primeiro nome e {{2}} = condição da campanha; na versão _sn, {{1}} = condição.
  const oferta = (comNome: string, semNomeTexto: string): FormModelo => ({
    ...FORM_VAZIO,
    nome,
    categoria: "MARKETING",
    corpo: semNome ? semNomeTexto : comNome,
    exemplos: semNome ? ["10% de desconto"] : ["Carla", "10% de desconto"],
    botoes: [
      { tipo: "QUICK_REPLY", texto: "Quero um orçamento" },
      { tipo: "QUICK_REPLY", texto: "Não quero mais ofertas" },
    ],
  });
  if (ctx.modelos && base === ctx.modelos["conversa"])
    return oferta(
      `Oi, {{1}}! Aqui é da ${ctx.empresa}. Você falou com a gente sobre limpeza de estofado e ficou sem orçamento. Este mês estamos com {{2}}. Quer que eu faça o seu orçamento agora? É só mandar uma foto do estofado.`,
      `Olá! Aqui é da ${ctx.empresa}. Você falou com a gente sobre limpeza de estofado e ficou sem orçamento. Este mês estamos com {{1}}. Quer que eu faça o seu orçamento agora? É só mandar uma foto do estofado.`,
    );
  if (ctx.modelos && base === ctx.modelos["preco"])
    return oferta(
      `Oi, {{1}}! Aqui é da ${ctx.empresa}. Sei que o valor pesou da última vez. Agora consigo fazer o seu serviço com {{2}}, com a mesma garantia. Quer que eu refaça o orçamento com esse valor?`,
      `Olá! Aqui é da ${ctx.empresa}. Sei que o valor pesou da última vez. Agora consigo fazer o seu serviço com {{1}}, com a mesma garantia. Quer que eu refaça o orçamento com esse valor?`,
    );
  if (nome === ctx.modeloPromocao)
    return {
      ...FORM_VAZIO,
      nome,
      categoria: "MARKETING",
      corpo: `Oi, {{1}}! Aqui é da ${ctx.empresa}. Abriu um horário amanhã e consigo fazer o seu serviço com {{2}} de desconto, e mais {{3}} se pagar no Pix. Quer que eu reserve para você?`,
      exemplos: ["Carla", "20%", "5%"],
      botoes: [
        { tipo: "QUICK_REPLY", texto: "Quero reservar" },
        { tipo: "QUICK_REPLY", texto: "Não quero mais ofertas" },
      ],
    };
  if (nome === ctx.modeloAviso)
    return {
      ...FORM_VAZIO,
      nome,
      categoria: "UTILITY",
      corpo: "Aviso do Nexa: {{1}}. Abra o app para ver os detalhes.",
      exemplos: ["Carla espera resposta da equipe há 12 min"],
    };
  return null;
}

// ---------------------------------------------------------------- textos sem aprovação
export type VariavelTexto = { nome: string; descricao: string; exemplo: string };

export type DefTexto = {
  chave: string;
  titulo: string;
  /** Quando o texto sai, em linguagem simples. */
  quando: string;
  variaveis: VariavelTexto[];
  /** Texto padrão do app; null = igual ao modelo aprovado na Meta (o da `finalidade`). */
  padrao: string | null;
  /** "posvenda" (modelos da empresa) ou "promocao" (modelo da promoção da agenda). */
  finalidade?: string;
};

export const TEXTOS: DefTexto[] = [
  {
    chave: "livre_posvenda",
    titulo: "Pós-venda, quando o cliente escreveu há pouco",
    quando:
      "Sai no lugar do modelo de pós-venda quando o cliente mandou mensagem nas últimas 24 h.",
    variaveis: [{ nome: "nome", descricao: "primeiro nome do cliente", exemplo: "Carla" }],
    padrao: null,
    finalidade: "posvenda",
  },
  {
    chave: "livre_promocao",
    titulo: "Promoção da agenda, quando o cliente escreveu há pouco",
    quando: "Sai no lugar do modelo da promoção quando o cliente mandou mensagem nas últimas 24 h.",
    variaveis: [
      { nome: "nome", descricao: "primeiro nome do cliente", exemplo: "Carla" },
      { nome: "desconto", descricao: "desconto da promoção", exemplo: "20%" },
      { nome: "pix", descricao: "desconto a mais no Pix", exemplo: "5%" },
    ],
    padrao: null,
    finalidade: "promocao",
  },
  {
    chave: "aviso_espera",
    titulo: "Aviso: cliente esperando a equipe",
    quando: "Vai para o WhatsApp da equipe, dentro do modelo de aviso.",
    variaveis: [
      { nome: "cliente", descricao: "nome do cliente", exemplo: "Carla" },
      { nome: "minutos", descricao: "minutos de espera", exemplo: "12" },
      {
        nome: "motivo",
        descricao: "motivo entre parênteses, se houver",
        exemplo: " (pediu desconto)",
      },
    ],
    padrao: "{cliente} espera resposta da equipe há {minutos} min{motivo}. Abra Conversas no Nexa.",
  },
  {
    chave: "aviso_resumo",
    titulo: "Aviso: resumo do dia às 9h",
    quando: "Vai para o WhatsApp da equipe, dentro do modelo de aviso.",
    variaveis: [
      { nome: "servicos_hoje", descricao: "serviços de hoje", exemplo: "3 serviços" },
      { nome: "atrasados", descricao: "serviços atrasados", exemplo: "1 atrasado" },
      { nome: "sem_tecnico", descricao: "serviços sem técnico", exemplo: "2 serviços" },
      { nome: "esperando", descricao: "clientes esperando", exemplo: "1 cliente esperando" },
    ],
    padrao: "{servicos_hoje} hoje · {atrasados} · {sem_tecnico} sem técnico · {esperando} a equipe",
  },
  {
    chave: "tecnico_a_caminho",
    titulo: "Técnico: avisar que está indo",
    quando:
      'Mensagem pronta do botão "Avisar que estou indo" na tela do serviço. O técnico envia pelo WhatsApp dele.',
    variaveis: [
      { nome: "cliente", descricao: "primeiro nome do cliente", exemplo: "Carla" },
      { nome: "tecnico", descricao: "nome do técnico", exemplo: "Josué" },
      { nome: "empresa", descricao: "nome da empresa", exemplo: "Turbine Clean" },
      { nome: "hora", descricao: "horário do atendimento", exemplo: "14:00" },
    ],
    padrao:
      "Oi, {cliente}! Aqui é o {tecnico}, da {empresa}. Estou a caminho para o seu atendimento das {hora}. Até já!",
  },
  {
    chave: "orcamento_higienizacao",
    titulo: "Orçamento: apresentação da higienização",
    quando:
      "Começo da mensagem de orçamento (tela do orçamento → Gerar mensagem) só com higienização.",
    variaveis: [{ nome: "empresa", descricao: "nome da empresa", exemplo: "Turbine Clean" }],
    padrao: `*Higienização Premium {empresa}*

Higienização profunda com extração a quente, produtos biodegradáveis e sem cheiro forte. Removemos poeira, ácaros, manchas, suor e odores, devolvendo o toque e o frescor do seu estofado.

✅ Equipamento profissional de extração
✅ Produtos seguros para crianças e animais
✅ Secagem rápida, sem molhar o ambiente
✅ Equipe uniformizada e horário combinado`,
  },
  {
    chave: "orcamento_impermeabilizacao",
    titulo: "Orçamento: apresentação da impermeabilização",
    quando: "Começo da mensagem de orçamento só com impermeabilização.",
    variaveis: [{ nome: "empresa", descricao: "nome da empresa", exemplo: "Turbine Clean" }],
    padrao: `*Impermeabilização Premium {empresa}*

Aplicamos uma proteção invisível que envolve cada fibra do tecido. Líquidos escorrem sem penetrar, sujeira não gruda e a limpeza do dia a dia passa a ser feita com um pano.

✅ Proteção contra líquidos, manchas e sujeira
✅ Não altera a cor nem o toque do tecido
✅ Produto atóxico, seguro para crianças e animais
🛡️ *Garantia de 3 anos* na proteção aplicada`,
  },
  {
    chave: "orcamento_combinado",
    titulo: "Orçamento: apresentação dos dois serviços juntos",
    quando: "Começo da mensagem de orçamento com higienização e impermeabilização.",
    variaveis: [{ nome: "empresa", descricao: "nome da empresa", exemplo: "Turbine Clean" }],
    padrao: `*Higienização e Impermeabilização Premium {empresa}*

Primeiro fazemos a higienização profunda com extração a quente, removendo poeira, ácaros, manchas e odores. Depois aplicamos a impermeabilização, que protege cada fibra: líquidos escorrem sem penetrar e a sujeira não gruda.

✅ Higienização profunda com equipamento profissional
✅ Proteção contra líquidos, manchas e sujeira
✅ Produtos atóxicos, seguros para crianças e animais
✅ Secagem rápida, sem molhar o ambiente
🛡️ *Garantia de 3 anos* na impermeabilização`,
  },
  {
    chave: "orcamento_fechamento",
    titulo: "Orçamento: total e validade",
    quando: "Fim da mensagem de orçamento. Parcelas e validade vêm da configuração da Alice.",
    variaveis: [
      { nome: "parcelas", descricao: "número de parcelas", exemplo: "5" },
      { nome: "parcela", descricao: "valor de cada parcela", exemplo: "R$ 127,98" },
      { nome: "a_vista", descricao: "valor à vista", exemplo: "R$ 607,90" },
      { nome: "validade", descricao: "dias de validade", exemplo: "2" },
    ],
    padrao: `*Total: {parcelas}x de {parcela} sem juros ou à vista por {a_vista}*

_Orçamento válido por {validade} dias._`,
  },
  {
    chave: "crm_primeiro_contato",
    titulo: "CRM: primeiro contato",
    quando: "Mensagem pronta na tela do lead. A equipe envia pelo WhatsApp.",
    variaveis: [
      { nome: "nome", descricao: "nome do cliente", exemplo: "Carla" },
      { nome: "empresa", descricao: "nome da empresa", exemplo: "Turbine Clean" },
    ],
    padrao:
      "Olá {nome}! Aqui é da {empresa}. Vi seu contato sobre a higienização do seu estofado. Pode me contar quais peças você quer higienizar?",
  },
  {
    chave: "crm_orcamento_enviado",
    titulo: "CRM: orçamento enviado",
    quando: "Mensagem pronta na tela do lead.",
    variaveis: [
      { nome: "nome", descricao: "nome do cliente", exemplo: "Carla" },
      { nome: "empresa", descricao: "nome da empresa", exemplo: "Turbine Clean" },
    ],
    padrao:
      "Olá {nome}! Enviei o orçamento do seu estofado. Ficou alguma dúvida? Posso reservar uma data para você.",
  },
  {
    chave: "crm_repescagem",
    titulo: "CRM: repescagem",
    quando: "Mensagem pronta na tela do lead.",
    variaveis: [
      { nome: "nome", descricao: "nome do cliente", exemplo: "Carla" },
      { nome: "empresa", descricao: "nome da empresa", exemplo: "Turbine Clean" },
    ],
    padrao:
      "Oi {nome}, tudo bem? Passando para saber se você ainda tem interesse na higienização. Consigo encaixar você nesta semana.",
  },
  {
    chave: "crm_confirmacao",
    titulo: "CRM: confirmação de agendamento",
    quando: "Mensagem pronta na tela do lead.",
    variaveis: [
      { nome: "nome", descricao: "nome do cliente", exemplo: "Carla" },
      { nome: "empresa", descricao: "nome da empresa", exemplo: "Turbine Clean" },
    ],
    padrao:
      "Oi {nome}! Confirmando seu atendimento. Assim que fechar a data eu te envio todos os detalhes por aqui.",
  },
];

export const CHAVES_TEXTOS = TEXTOS.map((t) => t.chave);

export function defDoTexto(chave: string): DefTexto | undefined {
  return TEXTOS.find((t) => t.chave === chave);
}

/** Troca {variavel} pelos valores; variável sem valor vira texto vazio. */
export function preencherTexto(texto: string, valores: Record<string, string | null | undefined>) {
  return texto.replace(/\{([a-z_]+)\}/g, (inteiro, v: string) =>
    v in valores ? (valores[v] ?? "") : inteiro,
  );
}

/** Problemas do texto editado (variável desconhecida, vazio, longo demais). */
export function validarTexto(def: DefTexto, texto: string): string[] {
  const p: string[] = [];
  const t = texto.trim();
  if (!t) p.push("Escreva o texto (ou volte ao padrão).");
  if (t.length > 2000) p.push("Texto com mais de 2.000 caracteres.");
  const conhecidas = def.variaveis.map((v) => v.nome);
  for (const m of t.matchAll(/\{([^{}]*)\}/g)) {
    if (!conhecidas.includes(m[1] ?? ""))
      p.push(
        `Variável {${m[1]}} não existe aqui. Use: ${conhecidas.map((c) => `{${c}}`).join(", ")}.`,
      );
  }
  if (/\{\{/.test(t)) p.push("Aqui as variáveis usam uma chave só: {nome}.");
  return [...new Set(p)];
}

/** Texto da empresa (ou o padrão) para a chave. */
export function textoOuPadrao(chave: string, daEmpresa: Record<string, string>): string | null {
  return daEmpresa[chave] ?? defDoTexto(chave)?.padrao ?? null;
}
