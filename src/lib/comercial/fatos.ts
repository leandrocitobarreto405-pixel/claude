/**
 * Gerente comercial: os fatos de cada lead calculados pelo sistema, sem IA (regras puras, sem
 * banco). Tempo da 1ª resposta, preço enviado e tempo até o preço, quem atendeu, se vendeu e por
 * quanto, follow-ups recebidos e a conversa em texto para a IA ler. A IA só julga o que depende de
 * leitura (perfil, objeção, regras, motivo); os números vêm daqui.
 */

export type MensagemLead = {
  direcao: "entrada" | "saida";
  /** contact (cliente), agent_bot (Alice), user (equipe) ou null (enviada pelo celular). */
  remetente: string | null;
  tipo: string | null;
  texto: string | null;
  transcricao: string | null;
  em: string;
};

export type OrcamentoLead = {
  numero: number | null;
  total: number | null;
  valorPix: number | null;
  valorCartao: number | null;
  criadoEm: string;
  servicos: string[];
};

export type FollowupLead = {
  agendadoPara: string;
  situacao: string | null;
  concluidoEm: string | null;
  respondidoEm: string | null;
  trilha: string | null;
  etapa: string | null;
  canal: string | null;
  responsavel: string | null;
};

export type EntradaFatos = {
  criadoEm: string;
  google: boolean;
  origem: string | null;
  servicoInteresse: string | null;
  orcamentoEnviadoEm: string | null;
  perdidoEm: string | null;
  motivoPerda: string | null;
  desfechoObs: string | null;
  vendeu: boolean;
  valorOs: number | null;
  valorPago: number | null;
  osCanceladaOuTeste: boolean;
  mensagens: MensagemLead[];
  orcamentos: OrcamentoLead[];
  followups: FollowupLead[];
};

export type QuemAtendeu = "alice" | "equipe" | "alice_e_equipe" | "nao_identificado";
export type Resultado = "vendeu" | "perdeu" | "sem_desfecho" | "sem_orcamento";

export type Fatos = {
  grupo: "google" | "outras";
  origem: string | null;
  servico: string | null;
  resultado: Resultado;
  quemAtendeu: QuemAtendeu;
  primeiraMensagemCliente: string | null;
  primeiraRespostaMin: number | null;
  primeiraRespostaDe: "alice" | "equipe" | null;
  precoEnviado: { total: number | null; pix: number | null; cartao: number | null } | null;
  precoEnviadoEm: string | null;
  tempoAtePrecoMin: number | null;
  valorOrcado: number | null;
  valorVendido: number | null;
  valorPago: number | null;
  mensagens: { cliente: number; alice: number; equipe: number };
  audios: { cliente: number; alice: number; equipe: number; semTranscricao: number };
  followups: {
    total: number;
    respondidos: number;
    resumo: string[];
  };
  motivoPerdaRegistrado: string | null;
  ultimaMensagemCliente: string | null;
  ultimaMensagemEmpresa: string | null;
};

const ms = (s: string) => new Date(s).getTime();
const minutos = (de: string, ate: string) => Math.max(0, Math.round((ms(ate) - ms(de)) / 60_000));

export function quemMandou(
  m: Pick<MensagemLead, "direcao" | "remetente">,
): "cliente" | "alice" | "equipe" {
  if (m.direcao === "entrada" || m.remetente === "contact") return "cliente";
  return m.remetente === "agent_bot" ? "alice" : "equipe";
}

const ehAudio = (tipo: string | null) => /udio/i.test(tipo ?? "");

export function calcularFatos(e: EntradaFatos): Fatos {
  const msgs = [...e.mensagens].sort((a, b) => ms(a.em) - ms(b.em));
  const cont = { cliente: 0, alice: 0, equipe: 0 };
  const aud = { cliente: 0, alice: 0, equipe: 0, semTranscricao: 0 };
  for (const m of msgs) {
    const q = quemMandou(m);
    cont[q]++;
    if (ehAudio(m.tipo)) {
      aud[q]++;
      if (!m.transcricao && !(q === "alice" && m.texto)) aud.semTranscricao++;
    }
  }
  const primeiraCliente = msgs.find((m) => quemMandou(m) === "cliente") ?? null;
  const resposta = primeiraCliente
    ? (msgs.find((m) => quemMandou(m) !== "cliente" && ms(m.em) >= ms(primeiraCliente.em)) ?? null)
    : null;
  const quemAtendeu: QuemAtendeu =
    cont.alice && cont.equipe
      ? "alice_e_equipe"
      : cont.alice
        ? "alice"
        : cont.equipe
          ? "equipe"
          : "nao_identificado";

  const orcs = [...e.orcamentos].sort((a, b) => ms(a.criadoEm) - ms(b.criadoEm));
  const primeiro = orcs[0] ?? null;
  const ultimo = orcs[orcs.length - 1] ?? null;
  const enviadoEm = e.orcamentoEnviadoEm ?? primeiro?.criadoEm ?? null;
  const resultado: Resultado =
    e.vendeu && !e.osCanceladaOuTeste
      ? "vendeu"
      : e.perdidoEm
        ? "perdeu"
        : orcs.length || e.orcamentoEnviadoEm
          ? "sem_desfecho"
          : "sem_orcamento";

  const servicos = [...new Set(orcs.flatMap((o) => o.servicos))];
  const fus = [...e.followups].sort((a, b) => ms(a.agendadoPara) - ms(b.agendadoPara));
  const ultimaDe = (quem: "cliente" | "empresa") =>
    [...msgs].reverse().find((m) => (quemMandou(m) === "cliente") === (quem === "cliente"))?.em ??
    null;

  return {
    grupo: e.google ? "google" : "outras",
    origem: e.origem,
    servico: servicos.length ? servicos.join(", ") : e.servicoInteresse,
    resultado,
    quemAtendeu,
    primeiraMensagemCliente: primeiraCliente?.em ?? null,
    primeiraRespostaMin:
      primeiraCliente && resposta ? minutos(primeiraCliente.em, resposta.em) : null,
    primeiraRespostaDe: resposta ? (quemMandou(resposta) === "alice" ? "alice" : "equipe") : null,
    precoEnviado: primeiro
      ? { total: primeiro.total, pix: primeiro.valorPix, cartao: primeiro.valorCartao }
      : null,
    precoEnviadoEm: enviadoEm,
    tempoAtePrecoMin:
      enviadoEm && (primeiraCliente?.em ?? e.criadoEm)
        ? minutos(primeiraCliente?.em ?? e.criadoEm, enviadoEm)
        : null,
    valorOrcado: ultimo ? (ultimo.total ?? ultimo.valorCartao ?? ultimo.valorPix) : null,
    valorVendido: resultado === "vendeu" ? e.valorOs : null,
    valorPago: resultado === "vendeu" ? e.valorPago : null,
    mensagens: cont,
    audios: aud,
    followups: {
      total: fus.length,
      respondidos: fus.filter((f) => f.respondidoEm).length,
      resumo: fus.map((f) =>
        [
          dataHora(f.agendadoPara),
          [f.trilha, f.etapa].filter(Boolean).join(""),
          f.canal,
          f.responsavel,
          f.situacao,
          f.respondidoEm ? "respondeu" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    },
    motivoPerdaRegistrado: e.motivoPerda,
    ultimaMensagemCliente: ultimaDe("cliente"),
    ultimaMensagemEmpresa: ultimaDe("empresa"),
  };
}

/** "28/10 14:05" no horário de São Paulo. */
export function dataHora(iso: string): string {
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

/** Limite de caracteres da conversa enviada à IA: o começo e o fim inteiros, o meio resumido. */
export const MAX_CARACTERES_CONVERSA = 60_000;

/** A conversa em texto, uma linha por mensagem: "[28/10 14:05] Cliente: ...". */
export function conversaEmTexto(mensagens: MensagemLead[]): string {
  const linhas = [...mensagens]
    .sort((a, b) => ms(a.em) - ms(b.em))
    .map((m) => {
      const q = quemMandou(m);
      const nome = q === "cliente" ? "Cliente" : q === "alice" ? "Alice" : "Equipe";
      let corpo = (m.texto ?? "").trim();
      if (ehAudio(m.tipo)) {
        const t = (m.transcricao ?? (q === "alice" ? m.texto : null) ?? "").trim();
        corpo = t ? `(áudio) ${t}` : "(áudio sem transcrição)";
      } else if (!corpo) {
        corpo = /imag|foto/i.test(m.tipo ?? "") ? "(foto)" : `(${m.tipo ?? "mensagem"})`;
      }
      return `[${dataHora(m.em)}] ${nome}: ${corpo.replace(/\s+/g, " ")}`;
    });
  const texto = linhas.join("\n");
  if (texto.length <= MAX_CARACTERES_CONVERSA) return texto;
  const inicio = texto.slice(0, MAX_CARACTERES_CONVERSA / 3);
  const fim = texto.slice(-((MAX_CARACTERES_CONVERSA * 2) / 3));
  return `${inicio}\n[... parte do meio da conversa omitida por tamanho ...]\n${fim}`;
}
