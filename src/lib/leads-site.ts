/**
 * Leads do site (regras puras, sem banco): ler as linhas da planilha da landing page, conferir o
 * telefone, a data e hora do cadastro e montar os textos dos avisos (só no app).
 */

export type LinhaLeadSite = {
  linha: number;
  /** Identifica o cadastro (data/hora + telefone), mesmo se apagarem ou inserirem linhas. */
  chave: string;
  cadastrado_em: string;
  nome: string | null;
  telefone_digitado: string | null;
  /** 55 + DDD + número; null quando o número é inválido. */
  telefone: string | null;
  servico: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  pagina: string | null;
};

type Campo =
  Exclude<keyof LinhaLeadSite, "linha" | "chave" | "cadastrado_em" | "telefone"> | "data_hora";

const sem = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Cabeçalho da planilha → campo. Aceita variações de acento, caixa e espaço. */
const CABECALHOS: Record<string, Campo> = {
  "data e hora": "data_hora",
  "data hora": "data_hora",
  data: "data_hora",
  nome: "nome",
  whatsapp: "telefone_digitado",
  telefone: "telefone_digitado",
  celular: "telefone_digitado",
  servico: "servico",
  "utm source": "utm_source",
  "utm medium": "utm_medium",
  "utm campaign": "utm_campaign",
  "utm term": "utm_term",
  "utm content": "utm_content",
  gclid: "gclid",
  gbraid: "gbraid",
  wbraid: "wbraid",
  fbclid: "fbclid",
  pagina: "pagina",
  "link da pagina": "pagina",
  "url da pagina": "pagina",
};

/** Posição de cada campo pelo cabeçalho (primeira linha da aba). */
export function mapaDoCabecalho(cabecalho: unknown[]): Partial<Record<Campo, number>> {
  const mapa: Partial<Record<Campo, number>> = {};
  cabecalho.forEach((c, i) => {
    const campo = CABECALHOS[sem(String(c ?? ""))];
    if (campo && mapa[campo] === undefined) mapa[campo] = i;
  });
  return mapa;
}

/**
 * Telefone digitado na LP (DDD + número, sem 55). Inválido: menos de 10 dígitos, mais de 11, DDD
 * começando com 0, ou 10 dígitos com 9 depois do DDD (celular sem um dígito).
 */
export function telefoneDoLead(digitado: string | null | undefined): string | null {
  let d = String(digitado ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length < 10 || d.length > 11) return null;
  if (!/^[1-9][1-9]/.test(d)) return null;
  if (d.length === 10 && d[2] === "9") return null;
  if (d.length === 11 && d[2] !== "9") return null;
  return `55${d}`;
}

/** "13/10/2026, 14:05:33" (horário de São Paulo) → ISO. null se não der para ler. */
export function lerDataHora(valor: unknown): string | null {
  const s = String(valor ?? "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  const [, dd, mm, aaaa, hh, mi, ss] = m;
  const n = (x: string | undefined, t = 2) => String(Number(x ?? 0)).padStart(t, "0");
  const iso = `${aaaa}-${n(mm)}-${n(dd)}T${n(hh)}:${n(mi)}:${n(ss)}-03:00`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  // 31/02 vira março no Date: confere que o dia continua o mesmo.
  const sp = new Date(t - 3 * 3600_000);
  if (sp.getUTCDate() !== Number(dd) || sp.getUTCMonth() + 1 !== Number(mm)) return null;
  return d.toISOString();
}

const texto = (v: unknown, max = 300): string | null => {
  const s = String(v ?? "")
    .replace(/[\p{Cc}]/gu, " ")
    .trim();
  return s ? s.slice(0, max) : null;
};

/** Cadastro de teste (nome começando com "teste"): ignorado. */
export function cadastroDeTeste(nome: string | null | undefined): boolean {
  return /^\s*teste/i.test(nome ?? "");
}

/**
 * Chave do cadastro: data e hora de São Paulo ("13/10/2026 14:05:33") + dígitos do telefone
 * digitado (sem telefone, o nome). Sem data legível, usa o texto da célula. Igual à do banco.
 */
export function chaveDoCadastro(
  cadastradoEm: string | null,
  dataBruta: string | null,
  digitado: string | null,
  nome: string | null,
): string {
  let quando: string;
  if (cadastradoEm) {
    const s = new Date(cadastradoEm).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const [d, h] = s.split(" ");
    const [a, m, dia] = d!.split("-");
    quando = `${dia}/${m}/${a} ${h}`;
  } else quando = `sem-data:${dataBruta ?? ""}`;
  const digitos = (digitado ?? "").replace(/\D/g, "");
  return `${quando}|${digitos || `nome:${nome ?? ""}`}`;
}

/**
 * Cadastros da aba. `valores` começa na linha `primeiraLinha` da planilha (1 = cabeçalho, que vem
 * à parte). Linhas sem nome e sem telefone, e cadastros de teste, são pulados. Data que não dá
 * para ler usa `agora` (a chave usa o texto da célula, então não duplica na próxima leitura).
 */
export function linhasNovas(
  cabecalho: unknown[],
  valores: unknown[][],
  primeiraLinha: number,
  agora: Date,
): { linhas: LinhaLeadSite[]; ultima: number; erro: string | null } {
  const mapa = mapaDoCabecalho(cabecalho);
  if (mapa.telefone_digitado === undefined)
    return {
      linhas: [],
      ultima: primeiraLinha - 1,
      erro: 'A primeira linha da aba não tem a coluna "WhatsApp".',
    };
  const pega = (row: unknown[], campo: Campo, max?: number) =>
    mapa[campo] === undefined ? null : texto(row[mapa[campo]!], max);
  const linhas: LinhaLeadSite[] = [];
  valores.forEach((row, i) => {
    const digitado = pega(row, "telefone_digitado", 40);
    const nome = pega(row, "nome", 120);
    if (!digitado && !nome) return;
    if (cadastroDeTeste(nome)) return;
    const dataBruta = pega(row, "data_hora");
    const quando = lerDataHora(dataBruta);
    linhas.push({
      linha: primeiraLinha + i,
      chave: chaveDoCadastro(quando, dataBruta, digitado, nome),
      cadastrado_em: quando ?? agora.toISOString(),
      nome,
      telefone_digitado: digitado,
      telefone: telefoneDoLead(digitado),
      servico: pega(row, "servico", 120),
      utm_source: pega(row, "utm_source"),
      utm_medium: pega(row, "utm_medium"),
      utm_campaign: pega(row, "utm_campaign"),
      utm_term: pega(row, "utm_term"),
      utm_content: pega(row, "utm_content"),
      gclid: pega(row, "gclid"),
      gbraid: pega(row, "gbraid"),
      wbraid: pega(row, "wbraid"),
      fbclid: pega(row, "fbclid"),
      pagina: pega(row, "pagina", 2000),
    });
  });
  return { linhas, ultima: primeiraLinha + valores.length - 1, erro: null };
}

/** Hora e data de São Paulo de um instante. */
export function horarioSP(d: Date): { data: string; hora: string } {
  const s = d.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

/** "08:00" ≤ agora < "20:00" (São Paulo). */
export function dentroDoHorario(agora: Date, inicio: string, fim: string): boolean {
  const h = horarioSP(agora).hora;
  return h >= inicio.slice(0, 5) && h < fim.slice(0, 5);
}

export function primeiroNomeLead(nome: string | null | undefined): string {
  const p = String(nome ?? "")
    .trim()
    .split(/\s+/)[0];
  if (!p || !/\p{L}/u.test(p)) return "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

export function textoSemChamar(l: { nome: string | null; lp: string; cadastrado_em: string }) {
  const nome = primeiroNomeLead(l.nome) || "Um lead";
  return `${nome} (${l.lp}) se cadastrou às ${horarioSP(new Date(l.cadastrado_em)).hora} e ainda não chamou no WhatsApp. Ligue ou chame em Leads do site.`;
}

export type ContagemDia = {
  total: number;
  chamou: number;
  naoChamou: number;
  invalido: number;
  chamadoEquipe: number;
};

export function textoResumoLeads(data: string, c: ContagemDia): string {
  const [a, m, d] = data.split("-");
  const partes = [
    `${c.total} ${c.total === 1 ? "cadastro" : "cadastros"} nas LPs em ${d}/${m}/${a}`,
    `${c.chamou} ${c.chamou === 1 ? "chamou" : "chamaram"} no WhatsApp`,
    `${c.naoChamou} não ${c.naoChamou === 1 ? "chamou" : "chamaram"}`,
  ];
  if (c.chamadoEquipe)
    partes.push(`${c.chamadoEquipe} ${c.chamadoEquipe === 1 ? "chamado" : "chamados"} pela equipe`);
  if (c.invalido) partes.push(`${c.invalido} com número inválido`);
  return `${partes.join(", ")}. Veja em Leads do site.`;
}
