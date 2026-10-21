/**
 * Textos dos documentos em PDF (Configurações › Documentos), editáveis por empresa. O padrão é o
 * dos modelos da Turbine Clean com o nome e os dados da empresa em variáveis:
 *   {empresa} {telefone} {endereco} {email} {meses} {visitas} {pct_manutencao} {valor_km}
 * Marcação: ver marcacao.ts (parágrafos, "- " listas, "## " subtítulos, **negrito**).
 */

export type ModoDocumento = "drive" | "pdf";

export type ConfigDocumentos = {
  modo: ModoDocumento;
  validade: string;
  cancelamento: string;
  beneficios: string;
  garantia_os: string;
  termo: string;
  agradecimento: string;
  garantia_meses: number;
  visitas_gratuitas: number;
  pct_manutencao: number;
  valor_km: number;
};

export const TEXTOS_PADRAO: Omit<ConfigDocumentos, "modo"> = {
  validade: "Esse orçamento é válido por 15 dias.",
  cancelamento: `A {empresa} trabalha com agenda programada e horários reservados exclusivamente para cada atendimento.

Por isso, em caso de cancelamento ou remarcação, pedimos que seja feito com no mínimo 24 horas de antecedência. Cancelamentos informados com menos tempo, principalmente na véspera ou no mesmo dia, comprometem a nossa programação e impedem que o horário seja oferecido a outro cliente.

Nesses casos, será aplicada uma taxa de 10% do valor total do orçamento, como forma de compensação pelos custos operacionais e bloqueio da agenda.`,
  beneficios: `- **Proteção contra líquidos** e manchas.
- **Aumenta a vida útil** do seu estofado.
- **Facilidade na limpeza** no dia a dia.
- **Tecnologia que protege sem alterar a textura do tecido.**`,
  garantia_os: `**Período de garantia: {meses} meses**

A {empresa} garante a qualidade e eficácia do nosso serviço de impermeabilização. Caso tenha qualquer problema dentro do período de garantia, entre em contato para suporte.

Observação: a impermeabilização não oferece proteção contra fluidos corporais, como urina, sangue, fezes e vômito, devido ao seu pH elevado e/ou composição ácida. Por esse motivo, ocorrências dessa natureza não são cobertas pela garantia. Caso seja necessária a realização de manutenção ou novo atendimento, será aplicada taxa adicional.

**Dicas para melhor conservação:**
- Evite o contato com produtos químicos agressivos.
- Para limpezas leves, utilize apenas pano umedecido com água.
- Não esfregue o tecido com força para preservar a camada protetora.`,
  termo: `**Garantia {empresa}: {meses} meses de proteção e cuidado**

A {empresa} assegura ao cliente que o serviço de impermeabilização de estofados realizado está coberto por garantia de {meses} meses a partir da data do serviço.

## Cobertura da garantia

Durante o período de vigência, o cliente tem direito a:
- {meses} meses de proteção contra penetração imediata de líquidos (quando limpos corretamente logo após o derramamento).
- {visitas} visitas técnicas gratuitas, mediante agendamento, para avaliação preventiva ou corretiva.
- Reaplicação sem custo adicional, caso o serviço tenha sido comprometido por falha de execução ou baixa fixação do produto.

## A garantia NÃO cobre

- Danos causados por uso inadequado do estofado (arranhões, rasgos, fogo, corte, tinta etc.).
- Problemas decorrentes de limpeza com produtos abrasivos ou sem orientação da {empresa}.
- Uso do estofado antes da secagem completa (mínimo de 2 horas após a aplicação).
- Infiltrações ou manchas causadas por fluidos corporais de pets ou pessoas (urina, sangue, fezes, vômito etc.).
- Líquidos densos, viscosos ou pigmentados, que aderem às fibras do tecido, como molho ou polpa de tomate, iogurte e similares.
- Sujeiras superficiais do uso diário, como marcas de mãos, pés, roupas sujas, gordura corporal, poeira, resíduos ou encardimento natural do tecido.

A impermeabilização tem como principal função proteger o tecido contra a penetração de líquidos e reduzir o risco de manchas permanentes por infiltração. Ela não impede o acúmulo de sujeiras superficiais causadas pelo uso do dia a dia.

## Manutenção fora da garantia

Quando a ocorrência não estiver coberta pela garantia, a {empresa} poderá realizar a manutenção da área afetada mediante cobrança de {pct_manutencao}% do valor pago pelo serviço do estofado afetado. O cálculo considera somente o estofado que precisa de manutenção, e não o valor total do serviço. A avaliação do técnico conta como uma das {visitas} visitas técnicas gratuitas.

Além do valor da manutenção, é cobrada uma taxa de deslocamento de R$ {valor_km} por quilômetro, calculada pela distância entre a sede da {empresa} ({endereco}) e o endereço do cliente, considerando ida e volta em cada dia de atendimento. A manutenção pode ser feita em 1 ou 2 dias, conforme a avaliação do técnico.

## Como acionar a garantia

Em caso de necessidade, o cliente deverá:
- Entrar em contato pelo WhatsApp da {empresa}: {telefone}.
- Enviar foto ou vídeo do problema identificado.
- Informar nome completo e data do serviço.
- Agendar uma das {visitas} visitas técnicas gratuitas (dias úteis, em horário comercial).

## Observações importantes

- A garantia é intransferível e válida apenas para o estofado atendido originalmente.
- O cliente deverá seguir as orientações de cuidados pós-serviço entregues junto a este termo.
- Após a aplicação do produto, é proibido ao cliente realizar testes por conta própria, como derramar líquidos ou pressionar a superfície de propósito. Somente o técnico responsável pode realizar testes de eficácia, seguindo os critérios técnicos e o tempo de cura adequado. Testes feitos pelo cliente podem comprometer o desempenho do produto e invalidar a garantia.`,
  agradecimento: "Agradecemos por escolher e confiar na {empresa}!",
  garantia_meses: 12,
  visitas_gratuitas: 3,
  pct_manutencao: 30,
  valor_km: 2,
};

/** Configuração salva (parcial ou antiga) completada com o padrão; sem nada, vale o Drive. */
export function configDocumentos(salvo: unknown): ConfigDocumentos {
  const s = (salvo && typeof salvo === "object" ? salvo : {}) as Partial<ConfigDocumentos>;
  const texto = (k: keyof typeof TEXTOS_PADRAO) => {
    const v = s[k];
    return typeof v === "string" && v.trim() ? v : (TEXTOS_PADRAO[k] as string);
  };
  const numero = (k: keyof typeof TEXTOS_PADRAO, min: number, max: number) => {
    const v = Number(s[k]);
    return Number.isFinite(v) && v >= min && v <= max ? v : (TEXTOS_PADRAO[k] as number);
  };
  return {
    modo: s.modo === "pdf" ? "pdf" : "drive",
    validade: texto("validade"),
    cancelamento: texto("cancelamento"),
    beneficios: texto("beneficios"),
    garantia_os: texto("garantia_os"),
    termo: texto("termo"),
    agradecimento: texto("agradecimento"),
    garantia_meses: numero("garantia_meses", 1, 120),
    visitas_gratuitas: numero("visitas_gratuitas", 0, 20),
    pct_manutencao: numero("pct_manutencao", 0, 100),
    valor_km: numero("valor_km", 0, 100),
  };
}

export type ImagemDocumento = { bytes: Uint8Array; tipo: "png" | "jpg" };

export type EmpresaDocumento = {
  nome: string;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  instagram: string | null;
  logo: ImagemDocumento | null;
  /** Linha abaixo do nome no cabeçalho (ex.: "Limpeza & Higienização de Ambientes"). */
  slogan?: string | null;
  /** Vai ao lado do nome no rodapé: "NOME | atividade" (ex.: "Limpeza de Estofados"). */
  atividade?: string | null;
  /** Frase do rodapé (ex.: um versículo). */
  fraseRodape?: string | null;
  telefone2?: string | null;
  /** Assinatura (PNG com fundo transparente) e quem assina; só saem com mostrarAssinatura. */
  assinatura?: ImagemDocumento | null;
  assinante?: string | null;
  mostrarAssinatura?: boolean;
};

/** Variáveis dos textos ({empresa}, {meses}...). */
export function variaveis(empresa: EmpresaDocumento, c: ConfigDocumentos) {
  return {
    empresa: empresa.nome,
    telefone: empresa.telefone ?? "",
    endereco: empresa.endereco ?? "",
    email: empresa.email ?? "",
    meses: c.garantia_meses,
    visitas: c.visitas_gratuitas,
    pct_manutencao: c.pct_manutencao,
    valor_km: c.valor_km.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  };
}

/** "@empresa" a partir do que foi digitado (com ou sem @, ou o endereço inteiro). */
export function instagramCurto(valor: string | null | undefined): string | null {
  if (!valor || !valor.trim()) return null;
  const limpo = valor
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/\/$/, "")
    .replace(/^@/, "");
  return limpo ? `@${limpo}` : null;
}

/** "(61) 99863-7117" quando vier só com dígitos; senão, como foi digitado. */
export function telefoneBonito(valor: string | null | undefined): string | null {
  if (!valor || !valor.trim()) return null;
  const d = valor.replace(/\D/g, "");
  if (d !== valor.trim() && !/^\+?[\d\s()-]+$/.test(valor.trim())) return valor.trim();
  const n = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return valor.trim();
}

/** "43.007.121/0001-78" quando vierem só os 14 dígitos; senão, como foi digitado. */
export function cnpjBonito(valor: string | null | undefined): string | null {
  if (!valor || !valor.trim()) return null;
  const d = valor.replace(/\D/g, "");
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return valor.trim();
}

/**
 * Linhas do cabeçalho (abaixo do nome): só o slogan; os contatos ficam no rodapé. Mantido para
 * quem ainda monta cabeçalho antigo.
 */
export function linhasCabecalho(e: EmpresaDocumento): string[] {
  return e.slogan && e.slogan.trim() ? [e.slogan.trim()] : [];
}

export type RodapeDocumento = { esquerda: string[]; direita: string[] };

/**
 * Rodapé em duas colunas, só com o que existe. Esquerda: "NOME | atividade", CNPJ, frase,
 * Instagram. Direita: e-mail, WhatsApp, telefone, endereço.
 */
export function rodapeEmpresa(e: EmpresaDocumento): RodapeDocumento {
  const limpo = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const nome = e.atividade && e.atividade.trim() ? `${e.nome} | ${e.atividade.trim()}` : e.nome;
  const cnpj = cnpjBonito(e.cnpj);
  const tel = telefoneBonito(e.telefone);
  const tel2 = telefoneBonito(e.telefone2);
  const esquerda = [
    nome,
    cnpj ? `CNPJ: ${cnpj}` : null,
    limpo(e.fraseRodape),
    instagramCurto(e.instagram),
  ].filter((x): x is string => Boolean(x));
  const direita = [
    limpo(e.email),
    tel ? `WhatsApp: ${tel}` : null,
    tel2 ? `Telefone: ${tel2}` : null,
    limpo(e.endereco),
  ].filter((x): x is string => Boolean(x));
  return { esquerda, direita };
}
