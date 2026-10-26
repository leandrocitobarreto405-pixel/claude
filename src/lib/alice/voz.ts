/**
 * Resposta da Alice em áudio (Google Text-to-Speech, vozes Chirp 3 HD pt-BR). Funções puras: quando
 * usar áudio, que parte da resposta vai falada, como o texto vira fala e quanto custa.
 *
 * Regra: só quando a última mensagem do cliente foi áudio, a empresa ligou "Responder em áudio", a
 * conversa não está "só texto" e a resposta é normal (nunca follow-up). Vai falado só o começo
 * conversado da resposta; do primeiro trecho com dado em diante (valor, orçamento, endereço,
 * data/hora, link, Pix, lista) tudo vai em texto, na ordem.
 */

/** US$ por caractere das vozes Chirp 3 HD (tabela do Google: US$ 30 por milhão). */
export const USD_POR_CARACTERE = 30 / 1_000_000;
/** Fala em português: ~15 caracteres por segundo. */
export const CARACTERES_POR_SEGUNDO = 15;
/** Tempo máximo para o Google devolver o áudio antes de mandar o texto. */
export const TEMPO_MAX_SINTESE_MS = 8000;

export const FRASE_EXEMPLO =
  "Oi! Aqui é a Alice. Recebi seu áudio, já anotei tudo e vou te ajudar com o orçamento, tá bom?";

export type Genero = "feminina" | "masculina";
export type Voz = { nome: string; rotulo: string; genero: Genero };

const FEMININAS = [
  "Achernar",
  "Aoede",
  "Autonoe",
  "Callirrhoe",
  "Despina",
  "Erinome",
  "Gacrux",
  "Kore",
  "Laomedeia",
  "Leda",
  "Pulcherrima",
  "Sulafat",
  "Vindemiatrix",
  "Zephyr",
];
const MASCULINAS = [
  "Achird",
  "Algenib",
  "Algieba",
  "Alnilam",
  "Charon",
  "Enceladus",
  "Fenrir",
  "Iapetus",
  "Orus",
  "Puck",
  "Rasalgethi",
  "Sadachbia",
  "Sadaltager",
  "Schedar",
  "Umbriel",
  "Zubenelgenubi",
];

const PREFIXO = "pt-BR-Chirp3-HD-";
const VOZ_VALIDA = /^pt-BR-Chirp3-HD-[A-Za-z]+$/;

export function vozValida(nome: string | null | undefined): nome is string {
  return Boolean(nome && VOZ_VALIDA.test(nome));
}

export function voz(nome: string, genero: Genero): Voz {
  return { nome, rotulo: nome.slice(PREFIXO.length), genero };
}

/** Lista conhecida (documentação do Google), usada se a lista da API não vier. */
export const VOZES_CONHECIDAS: Voz[] = [
  ...FEMININAS.map((n) => voz(PREFIXO + n, "feminina")),
  ...MASCULINAS.map((n) => voz(PREFIXO + n, "masculina")),
];

/** Vozes da API (voices.list) → só Chirp 3 HD pt-BR, femininas primeiro, em ordem alfabética. */
export function vozesDaApi(lista: Array<{ name?: string; ssmlGender?: string }>): Voz[] {
  return lista
    .filter((v) => vozValida(v.name))
    .map((v) => voz(v.name!, v.ssmlGender === "MALE" ? "masculina" : "feminina"))
    .sort((a, b) =>
      a.genero === b.genero ? a.rotulo.localeCompare(b.rotulo) : a.genero === "feminina" ? -1 : 1,
    );
}

// ---------------------------------------------------------------- custo

export function custoReais(caracteres: number, cotacaoDolar: number): number {
  return Math.round(caracteres * USD_POR_CARACTERE * cotacaoDolar * 10000) / 10000;
}

export function segundosEstimados(caracteres: number): number {
  return Math.round((caracteres / CARACTERES_POR_SEGUNDO) * 10) / 10;
}

// ---------------------------------------------------------------- "manda por escrito"

const POR_ESCRITO = [
  /\bpor escrito\b/,
  /\b(manda|mande|envia|envie|escreve|escreva|responde|responda|prefiro|pode ser|so|somente|apenas)\b[^.?!]{0,25}\b(texto|escrito|mensagem escrita|digitad[oa])\b/,
  /\bnao (consigo|posso|da pra|da para|tenho como|vou conseguir) (ouvir|escutar|abrir (o |os )?audio)/,
  /\bsem audio\b/,
  /\b(nao|nem) (manda|mande|envia|envie) (mais )?audio/,
];

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** O cliente pediu para a Alice escrever em vez de mandar áudio. */
export function pediuPorEscrito(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = semAcento(texto);
  return POR_ESCRITO.some((re) => re.test(t));
}

// ---------------------------------------------------------------- o que vai falado

const DADO: RegExp[] = [
  /R\$|\breais\b|\d+\s*%|\bdesconto\b|\bparcel|\bvalor(es)?\b|\bpre[çc]o|\bor[çc]amento\b|\btotal\b/i,
  /\bpix\b|\bchave\b|\bcnpj\b|\bcpf\b/i,
  /https?:\/\/|www\.|\b[\w-]+\.(com|br|net|org)\b/i,
  /\bcep\b|\d{5}-?\d{3}\b|\b(rua|r\.|av\.?|avenida|alameda|travessa|estrada|rodovia|pra[çc]a|bairro|apto|apartamento|bloco|n[ºo°]\s*\d)\b/i,
  /\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}\s*h(\s*\d{2})?\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(de\s+)?(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i,
  /\b(segunda|ter[çc]a|quarta|quinta|sexta)(-feira)?\b.{0,20}\b(\d|manh[ãa]|tarde|noite)|\b(s[áa]bado|domingo|amanh[ãa]|hoje)\b.{0,15}\b(às|as|\d)\b/i,
  /^\s*([-•*]|\d+[.)])\s+/m,
];

/** Trecho com dado que precisa ficar escrito (valor, endereço, data/hora, link, Pix, lista). */
export function temDado(trecho: string): boolean {
  return DADO.some((re) => re.test(trecho));
}

export type Separacao = {
  /** Começo conversado da resposta (vai em áudio); vazio = nada para falar. */
  fala: string;
  /** Do primeiro trecho com dado em diante (vai em texto, na ordem). */
  texto: string;
};

/** Divide a resposta em parágrafos: os conversados do começo vão falados, o resto escrito. */
export function separarResposta(resposta: string): Separacao {
  const paragrafos = resposta
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const i = paragrafos.findIndex(temDado);
  const corte = i === -1 ? paragrafos.length : i;
  return {
    fala: paragrafos.slice(0, corte).join("\n\n"),
    texto: paragrafos.slice(corte).join("\n\n"),
  };
}

// ---------------------------------------------------------------- texto → fala

const ABREVIACOES: Array<[RegExp, string]> = [
  [/\bvcs\b/gi, "vocês"],
  [/\bvc\b/gi, "você"],
  [/\bpq\b/gi, "porque"],
  [/\btbm?\b/gi, "também"],
  [/\bobg\b/gi, "obrigada"],
  [/\bblz\b/gi, "beleza"],
  [/\bqdo\b/gi, "quando"],
  [/\bmsg\b/gi, "mensagem"],
  [/\bhj\b/gi, "hoje"],
];

/**
 * Mesmo texto da resposta, pronto para falar: sem emojis nem marcação, abreviações por extenso. Os
 * números ficam em algarismos: a voz do Google já lê por extenso e acerta o gênero ("2 fotos" →
 * "duas fotos"), o que uma troca automática aqui erraria.
 */
export function paraFala(texto: string): string {
  let t = texto
    .replace(
      /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\p{Emoji_Modifier}|\u200d|\ufe0f|\u20e3/gu,
      "",
    )
    .replace(/[*_~`#>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "");
  for (const [re, por] of ABREVIACOES) t = t.replace(re, por);
  return t
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ---------------------------------------------------------------- decisão

// ---------------------------------------------------------------- ElevenLabs

export type Provedor = "google" | "elevenlabs";
export const MODELOS_ELEVEN = ["eleven_flash_v2_5", "eleven_v4"] as const;
export type ModeloEleven = (typeof MODELOS_ELEVEN)[number];
/**
 * Créditos da ElevenLabs por caractere: v4 ~1 (amostra de 26/10: 16 s = 257 créditos); Flash v2.5
 * gasta metade (tabela da ElevenLabs).
 */
export const CREDITOS_POR_CARACTERE: Record<ModeloEleven, number> = {
  eleven_v4: 1,
  eleven_flash_v2_5: 0.5,
};
/** Padrão: US$ 0,22 por mil créditos (plano Creator). A Nexa ajusta conforme o plano da conta. */
export const USD_POR_MIL_CREDITOS_PADRAO = 0.22;
const VOZ_ELEVEN = /^[A-Za-z0-9]{12,40}$/;

export function vozElevenValida(id: string | null | undefined): id is string {
  return Boolean(id && VOZ_ELEVEN.test(id));
}

export function modeloEleven(m: string | null | undefined): ModeloEleven {
  return (MODELOS_ELEVEN as readonly string[]).includes(m ?? "")
    ? (m as ModeloEleven)
    : "eleven_flash_v2_5";
}

export function custoElevenReais(
  caracteres: number,
  modelo: ModeloEleven,
  usdPorMilCreditos: number,
  cotacaoDolar: number,
): number {
  const usd = ((caracteres * CREDITOS_POR_CARACTERE[modelo]) / 1000) * usdPorMilCreditos;
  return Math.round(usd * cotacaoDolar * 10000) / 10000;
}

export type ConfigAudio = {
  audio_ativo: boolean;
  audio_voz: string | null;
  audio_max_caracteres: number;
  audio_max_segundos: number;
  audio_limite_diario_reais: number;
  audio_cotacao_dolar: number;
  /** Sem provedor: Google (como sempre foi). */
  audio_provedor?: Provedor;
  audio_eleven_voz?: string | null;
  audio_eleven_modelo?: string | null;
  eleven_usd_por_mil_creditos?: number;
};

export type Decisao =
  | { modo: "texto"; motivo: string; limite?: boolean }
  | {
      modo: "audio";
      provedor: Provedor;
      /** Voz do provedor (ElevenLabs: voice_id; Google: nome Chirp 3 HD). */
      voz: string;
      modelo: ModeloEleven | null;
      /** Voz do Google para cair nela se a ElevenLabs recusar (null = sem reserva). */
      vozReserva: string | null;
      /** Texto que vai falado. */
      fala: string;
      /** Parte escrita que sai depois do áudio (pode ser vazia). */
      texto: string;
      caracteres: number;
      custo: number;
    };

/** Decide se a resposta (texto do começo da resposta) sai com áudio. */
export function decidirAudio(e: {
  cfg: ConfigAudio;
  ultimaDoClienteEhAudio: boolean;
  soTexto: boolean;
  ehFollowup: boolean;
  gastoHojeReais: number;
  resposta: string;
}): Decisao {
  const { cfg } = e;
  const eleven = cfg.audio_provedor === "elevenlabs" && vozElevenValida(cfg.audio_eleven_voz);
  if (!cfg.audio_ativo || (!eleven && !vozValida(cfg.audio_voz)))
    return { modo: "texto", motivo: "áudio desligado" };
  if (e.ehFollowup) return { modo: "texto", motivo: "follow-up" };
  if (!e.ultimaDoClienteEhAudio) return { modo: "texto", motivo: "cliente escreveu" };
  if (e.soTexto) return { modo: "texto", motivo: "cliente pediu por escrito" };
  const { fala: bruto, texto } = separarResposta(e.resposta);
  const fala = paraFala(bruto);
  if (!fala) return { modo: "texto", motivo: "resposta só com dados" };
  if (fala.length > cfg.audio_max_caracteres)
    return { modo: "texto", motivo: "resposta longa (caracteres)" };
  if (segundosEstimados(fala.length) > cfg.audio_max_segundos)
    return { modo: "texto", motivo: "resposta longa (segundos)" };
  const modelo = eleven ? modeloEleven(cfg.audio_eleven_modelo) : null;
  const custo = modelo
    ? custoElevenReais(
        fala.length,
        modelo,
        cfg.eleven_usd_por_mil_creditos ?? USD_POR_MIL_CREDITOS_PADRAO,
        Number(cfg.audio_cotacao_dolar),
      )
    : custoReais(fala.length, Number(cfg.audio_cotacao_dolar));
  if (e.gastoHojeReais + custo > Number(cfg.audio_limite_diario_reais))
    return { modo: "texto", motivo: "limite diário", limite: true };
  return {
    modo: "audio",
    provedor: eleven ? "elevenlabs" : "google",
    voz: eleven ? cfg.audio_eleven_voz! : cfg.audio_voz!,
    modelo,
    vozReserva: eleven && vozValida(cfg.audio_voz) ? cfg.audio_voz : null,
    fala,
    texto,
    caracteres: fala.length,
    custo,
  };
}

/** Início do dia de hoje em Brasília (UTC−3), em ISO. */
export function inicioDoDiaBrasilia(agora = new Date()): string {
  const br = new Date(agora.getTime() - 3 * 3600_000);
  return new Date(
    Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate(), 3, 0, 0),
  ).toISOString();
}

export function inicioDoMesBrasilia(agora = new Date()): string {
  const br = new Date(agora.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), 1, 3, 0, 0)).toISOString();
}

export function diaBrasilia(agora = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}
