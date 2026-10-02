/**
 * Configuração da empresa (checklist de implantação): as etapas, quem resolve cada uma e como o
 * sistema sabe que ficou pronta. Sem banco nem rede, para poder testar; os fatos vêm de
 * implantacao.server.ts.
 */

export type Responsavel = "nexa" | "empresa";
export type Marcacao = "revisado" | "nao_se_aplica";

export type ChaveEtapa =
  | "dados"
  | "usuarios"
  | "precos"
  | "taxas"
  | "textos"
  | "tecnicos"
  | "whatsapp"
  | "modelos"
  | "alice"
  | "token_meta"
  | "veiculos"
  | "google"
  | "marketing"
  | "notificacoes";

/** O que o servidor levantou da empresa. */
export type Fatos = {
  empresa: { nome: string; cnpj: string | null; telefone: string | null };
  usuarios: { admin: number; atendente: number; tecnico: number; convitesPendentes: number };
  precos: number;
  taxas: number;
  /** A empresa salvou a mensagem padrão ou a da nota depois de cadastrada. */
  textosSalvos: boolean;
  tecnicosAtivos: number;
  horariosBase: number;
  whatsapp: { caixasChatwoot: number };
  /** null = não deu para conferir (sem conexão com a Meta nem com o Chatwoot). */
  modelos: { faltando: string[]; naoAprovados: string[] } | null;
  alice: {
    nome: boolean;
    descricao: boolean;
    instrucoes: boolean;
    perguntas: boolean;
    horario: boolean;
    area: boolean;
  } | null;
  tokenMeta: boolean;
  veiculos: number;
  google: boolean;
  marketing: { contatos: number; campanhas: number };
  notificacoes: number;
  marcadas: Partial<Record<ChaveEtapa, Marcacao>>;
};

export type SituacaoEtapa = "pronta" | "falta" | "aguardando" | "nao_se_aplica";

export type Etapa = {
  chave: ChaveEtapa;
  titulo: string;
  responsavel: Responsavel;
  obrigatoria: boolean;
  situacao: SituacaoEtapa;
  /** O que falta (ou o que foi feito, quando pronta). */
  detalhe: string;
  /** Tela onde se resolve (caminho interno do app). */
  resolver: { rotulo: string; para: string } | null;
  /** A etapa aceita "Revisei" (não há como o sistema saber sozinho). */
  podeRevisar: boolean;
  /** A etapa aceita "Não se aplica" (só opcionais). */
  podeNaoSeAplica: boolean;
  marcada: Marcacao | null;
};

export const ROTULO_RESPONSAVEL: Record<Responsavel, string> = { nexa: "Nexa", empresa: "Empresa" };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const faltam = (itens: string[]) =>
  itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;
const cheio = (t: string | null | undefined) => Boolean(t && t.trim());

type Def = Omit<Etapa, "situacao" | "detalhe" | "marcada"> & {
  avaliar: (f: Fatos) => { situacao: SituacaoEtapa; detalhe: string };
};

const pronta = (detalhe: string) => ({ situacao: "pronta" as const, detalhe });
const falta = (detalhe: string) => ({ situacao: "falta" as const, detalhe });

const DEFS: Def[] = [
  // ------------------------------------------------------------------ obrigatórias
  {
    chave: "dados",
    titulo: "Dados da empresa",
    responsavel: "empresa",
    obrigatoria: true,
    resolver: null, // editado na própria etapa
    podeRevisar: false,
    podeNaoSeAplica: false,
    avaliar: ({ empresa: e }) => {
      const sem = [
        !cheio(e.nome) && "o nome",
        !cheio(e.cnpj) && "o CNPJ",
        !cheio(e.telefone) && "o telefone",
      ].filter((x): x is string => Boolean(x));
      return sem.length ? falta(`Falta ${faltam(sem)}.`) : pronta("Nome, CNPJ e telefone.");
    },
  },
  {
    chave: "usuarios",
    titulo: "Usuários convidados",
    responsavel: "empresa",
    obrigatoria: true,
    resolver: { rotulo: "Convidar", para: "/usuarios" },
    podeRevisar: false,
    podeNaoSeAplica: false,
    avaliar: ({ usuarios: u }) => {
      const sem = [
        !u.admin && "o dono (administrador)",
        !u.atendente && "1 atendente",
        !u.tecnico && "1 técnico",
      ].filter((x): x is string => Boolean(x));
      if (!sem.length)
        return pronta(
          `${plural(u.admin + u.atendente + u.tecnico, "pessoa", "pessoas")} com acesso.`,
        );
      const convites = u.convitesPendentes
        ? ` ${plural(u.convitesPendentes, "convite ainda não aceito", "convites ainda não aceitos")}.`
        : "";
      return falta(`Falta ${faltam(sem)} com acesso.${convites}`);
    },
  },
  {
    chave: "precos",
    titulo: "Tabela de preços",
    responsavel: "empresa",
    obrigatoria: true,
    resolver: { rotulo: "Abrir tabela", para: "/configuracoes?aba=precos" },
    podeRevisar: false,
    podeNaoSeAplica: false,
    avaliar: ({ precos }) =>
      precos ? pronta(plural(precos, "item", "itens") + ".") : falta("Nenhum item cadastrado."),
  },
  {
    chave: "taxas",
    titulo: "Taxas de pagamento e Pix",
    responsavel: "empresa",
    obrigatoria: true,
    resolver: { rotulo: "Abrir taxas", para: "/configuracoes?aba=taxas" },
    podeRevisar: true,
    podeNaoSeAplica: false,
    avaliar: ({ taxas, marcadas }) =>
      taxas && marcadas.taxas === "revisado"
        ? pronta(`${plural(taxas, "taxa cadastrada", "taxas cadastradas")} e revisadas.`)
        : taxas
          ? falta(
              `${plural(taxas, "taxa cadastrada", "taxas cadastradas")}. Confira as taxas da maquininha e o desconto do Pix (na Alice) e toque em "Revisei".`,
            )
          : falta("Nenhuma taxa da maquininha cadastrada."),
  },
  {
    chave: "textos",
    titulo: "Modelos de orçamento e OS",
    responsavel: "empresa",
    obrigatoria: true,
    resolver: { rotulo: "Abrir mensagens", para: "/configuracoes?aba=mensagem" },
    podeRevisar: true,
    podeNaoSeAplica: false,
    avaliar: ({ textosSalvos, marcadas }) =>
      textosSalvos
        ? pronta("Mensagem padrão salva pela empresa.")
        : marcadas.textos === "revisado"
          ? pronta("Revisados pela empresa.")
          : falta(
              'Os textos ainda são os que vieram de padrão. Ajuste a mensagem padrão, a da nota e o modelo da OS, ou toque em "Revisei".',
            ),
  },
  {
    chave: "tecnicos",
    titulo: "Técnicos e horários base",
    responsavel: "empresa",
    obrigatoria: true,
    resolver: { rotulo: "Abrir agenda", para: "/agenda-config" },
    podeRevisar: false,
    podeNaoSeAplica: false,
    avaliar: ({ tecnicosAtivos, horariosBase }) =>
      !tecnicosAtivos
        ? falta("Nenhum técnico ativo (cadastre em Configurações → Equipe).")
        : !horariosBase
          ? falta(`${plural(tecnicosAtivos, "técnico", "técnicos")}, mas sem horários base.`)
          : pronta(
              `${plural(tecnicosAtivos, "técnico", "técnicos")} e ${plural(horariosBase, "horário base", "horários base")}.`,
            ),
  },
  {
    chave: "whatsapp",
    titulo: "WhatsApp conectado",
    responsavel: "nexa",
    obrigatoria: true,
    resolver: null,
    podeRevisar: false,
    podeNaoSeAplica: false,
    avaliar: ({ whatsapp }) =>
      whatsapp.caixasChatwoot
        ? pronta(`Pelo Chatwoot (${plural(whatsapp.caixasChatwoot, "caixa", "caixas")}).`)
        : { situacao: "aguardando", detalhe: "Aguardando conexão." },
  },
  {
    chave: "modelos",
    titulo: "Modelos de mensagem aprovados",
    responsavel: "nexa",
    obrigatoria: true,
    resolver: { rotulo: "Abrir modelos", para: "/modelos-mensagem" },
    podeRevisar: true,
    podeNaoSeAplica: false,
    avaliar: ({ modelos, marcadas }) => {
      if (marcadas.modelos === "revisado") return pronta("Conferidos pela Nexa.");
      if (!modelos)
        return {
          situacao: "aguardando",
          detalhe: "Não dá para conferir ainda: falta conectar o WhatsApp ou o token da Meta.",
        };
      const sem = [
        modelos.faltando.length &&
          `${plural(modelos.faltando.length, "modelo não existe", "modelos não existem")} na Meta (${modelos.faltando.join(", ")})`,
        modelos.naoAprovados.length &&
          `${plural(modelos.naoAprovados.length, "modelo não aprovado", "modelos não aprovados")} (${modelos.naoAprovados.join(", ")})`,
      ].filter((x): x is string => Boolean(x));
      return sem.length ? falta(`${faltam(sem)}.`) : pronta("Os modelos usados estão aprovados.");
    },
  },
  {
    chave: "alice",
    titulo: "Alice configurada",
    responsavel: "nexa",
    obrigatoria: true,
    resolver: { rotulo: "Abrir Alice", para: "/configuracoes?aba=alice" },
    podeRevisar: false,
    podeNaoSeAplica: false,
    avaliar: ({ alice: a }) => {
      if (!a) return falta("A Alice ainda não foi configurada.");
      const sem = [
        !a.nome && "o nome",
        !a.descricao && "o que a empresa faz",
        !a.instrucoes && "as instruções",
        !a.perguntas && "as perguntas frequentes",
        !a.horario && "o horário",
        !a.area && "a área de atendimento",
      ].filter((x): x is string => Boolean(x));
      return sem.length
        ? falta(`Falta ${faltam(sem)}.`)
        : pronta("Nome, descrição, instruções, perguntas, horário e área.");
    },
  },
  // ------------------------------------------------------------------ opcionais
  {
    chave: "token_meta",
    titulo: "Token da Meta",
    responsavel: "nexa",
    obrigatoria: false,
    resolver: { rotulo: "Configurar", para: "/modelos-mensagem" },
    podeRevisar: false,
    podeNaoSeAplica: true,
    avaliar: ({ tokenMeta }) =>
      tokenMeta
        ? pronta("Configurado: os modelos são criados e editados pelo Nexa.")
        : falta("Sem o token, os modelos são criados direto no WhatsApp Manager."),
  },
  {
    chave: "veiculos",
    titulo: "Veículos e rodízio",
    responsavel: "empresa",
    obrigatoria: false,
    resolver: { rotulo: "Abrir agenda", para: "/agenda-config" },
    podeRevisar: false,
    podeNaoSeAplica: true,
    avaliar: ({ veiculos }) =>
      veiculos
        ? pronta(plural(veiculos, "veículo cadastrado", "veículos cadastrados") + ".")
        : falta('Nenhum veículo. Fora de São Paulo, toque em "Não se aplica".'),
  },
  {
    chave: "google",
    titulo: "Google Drive e Agenda",
    responsavel: "empresa",
    obrigatoria: false,
    resolver: { rotulo: "Conectar", para: "/configuracoes?aba=documentos" },
    podeRevisar: false,
    podeNaoSeAplica: true,
    avaliar: ({ google }) =>
      google ? pronta("Conta do Google conectada.") : falta("Conta do Google não conectada."),
  },
  {
    chave: "marketing",
    titulo: "Marketing (contatos e calendário)",
    responsavel: "empresa",
    obrigatoria: false,
    resolver: { rotulo: "Abrir marketing", para: "/marketing" },
    podeRevisar: false,
    podeNaoSeAplica: true,
    avaliar: ({ marketing: m }) =>
      m.contatos && m.campanhas
        ? pronta(
            `${plural(m.contatos, "contato", "contatos")} e ${plural(m.campanhas, "campanha", "campanhas")}.`,
          )
        : falta(!m.contatos ? "Contatos ainda não importados." : "Nenhuma campanha no calendário."),
  },
  {
    chave: "notificacoes",
    titulo: "Notificações no celular",
    responsavel: "empresa",
    obrigatoria: false,
    resolver: { rotulo: "Ativar", para: "/avisos" },
    podeRevisar: false,
    podeNaoSeAplica: true,
    avaliar: ({ notificacoes }) =>
      notificacoes
        ? pronta(plural(notificacoes, "celular ativado", "celulares ativados") + ".")
        : falta("Nenhum celular recebendo notificações."),
  },
];

export const CHAVES_ETAPAS = DEFS.map((d) => d.chave);

export function avaliarEtapas(f: Fatos): Etapa[] {
  return DEFS.map(({ avaliar, ...def }) => {
    const marcada = f.marcadas[def.chave] ?? null;
    const r =
      def.podeNaoSeAplica && marcada === "nao_se_aplica"
        ? { situacao: "nao_se_aplica" as const, detalhe: "Marcada como não se aplica." }
        : avaliar(f);
    return { ...def, ...r, marcada };
  });
}

export type Resumo = {
  obrigatorias: { prontas: number; total: number };
  opcionais: { prontas: number; total: number };
  /** Todas as obrigatórias prontas: a Nexa pode liberar. */
  podeLiberar: boolean;
};

export function resumoEtapas(etapas: Etapa[]): Resumo {
  const conta = (obrigatoria: boolean) => {
    const lista = etapas.filter((e) => e.obrigatoria === obrigatoria);
    return {
      prontas: lista.filter((e) => e.situacao === "pronta" || e.situacao === "nao_se_aplica")
        .length,
      total: lista.length,
    };
  };
  const obrigatorias = conta(true);
  return {
    obrigatorias,
    opcionais: conta(false),
    podeLiberar: obrigatorias.prontas === obrigatorias.total,
  };
}

export function textoProgresso(r: Resumo): string {
  return `${r.obrigatorias.prontas} de ${r.obrigatorias.total} obrigatórias · ${r.opcionais.prontas} de ${r.opcionais.total} opcionais`;
}

/** A marcação pedida vale para esta etapa? */
export function marcacaoPermitida(chave: string, m: Marcacao | "pendente"): chave is ChaveEtapa {
  const def = DEFS.find((d) => d.chave === chave);
  if (!def) return false;
  if (m === "pendente") return true;
  return m === "revisado" ? def.podeRevisar : def.podeNaoSeAplica;
}
