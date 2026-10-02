// Regras da tela Avisos (sem acesso a banco, para poder testar).
// Os avisos vêm de várias fontes que já existem; nada aqui grava no banco.
import type { TomChip } from "@/components/nexa";
import type { Papel } from "@/lib/tenant";

export type Aviso = {
  id: string;
  tom: TomChip;
  titulo: string;
  texto: string;
  /** Quando aconteceu (ISO), para ordenar e mostrar "há X min". */
  quando: string | null;
  /** Ainda não lido (só os avisos de marketing guardam leitura). */
  novo: boolean;
  /** Para onde o toque leva. */
  link: { to: string; search?: Record<string, string>; params?: Record<string, string> };
  /** Só a equipe do escritório vê (marketing, conversas, financeiro). */
  escritorio: boolean;
};

export type FontesDeAvisos = {
  conversasEsperando: {
    id: string;
    nome: string;
    desde: string;
    motivo: string | null;
    posVenda: boolean;
  }[];
  marketing: {
    id: string;
    tipo: string;
    titulo: string;
    mensagem: string;
    criadoEm: string;
    lidoEm: string | null;
  }[];
  atrasados: number;
  semTecnico: number;
  reagendados: { id: string; cliente: string; data: string; hora: string }[];
  pagamentosPendentes: number;
};

const ORDEM_TOM: Record<TomChip, number> = { problema: 0, atencao: 1, sucesso: 2, neutro: 3 };

function tomDoMarketing(tipo: string): TomChip {
  if (tipo === "problema_pos_venda" || tipo === "prioridade_urgente") return "problema";
  if (tipo === "pausa_automatica") return "atencao";
  return "neutro";
}

/**
 * Junta as fontes numa lista só, do mais urgente para o menos. O técnico recebe só os avisos
 * da operação (atrasados, sem técnico, reagendados); nada de marketing, conversa ou financeiro.
 */
export function montarAvisos(f: FontesDeAvisos, papel: Papel | null): Aviso[] {
  const lista: Aviso[] = [];

  for (const c of f.conversasEsperando) {
    lista.push({
      id: `conversa-${c.id}`,
      tom: c.posVenda ? "problema" : "atencao",
      titulo: c.posVenda ? `Problema no pós-venda: ${c.nome}` : `${c.nome} espera resposta`,
      texto: c.motivo ? `A Alice passou para a equipe: ${c.motivo}` : "Cliente esperando a equipe.",
      quando: c.desde,
      novo: true,
      link: { to: "/conversas/$conversaId", params: { conversaId: c.id } },
      escritorio: true,
    });
  }

  for (const m of f.marketing) {
    lista.push({
      id: `mkt-${m.id}`,
      tom: tomDoMarketing(m.tipo),
      titulo: m.titulo,
      texto: m.mensagem,
      quando: m.criadoEm,
      novo: !m.lidoEm,
      link: { to: "/marketing" },
      escritorio: true,
    });
  }

  if (f.atrasados > 0) {
    lista.push({
      id: "atrasados",
      tom: "atencao",
      titulo:
        f.atrasados === 1
          ? "1 serviço atrasado sem conclusão"
          : `${f.atrasados} serviços atrasados sem conclusão`,
      texto: "Conclua ou reagende na Agenda.",
      quando: null,
      novo: true,
      link: { to: "/agenda", search: { modo: "atrasados" } },
      escritorio: false,
    });
  }

  if (f.semTecnico > 0) {
    lista.push({
      id: "sem-tecnico",
      tom: "atencao",
      titulo: f.semTecnico === 1 ? "1 serviço sem técnico" : `${f.semTecnico} serviços sem técnico`,
      texto: "Defina quem vai atender.",
      quando: null,
      novo: true,
      link: { to: "/agenda", search: { modo: "sem-tecnico" } },
      escritorio: false,
    });
  }

  for (const r of f.reagendados) {
    lista.push({
      id: `reagendado-${r.id}`,
      tom: "neutro",
      titulo: `Serviço reagendado: ${r.cliente}`,
      texto: `Novo horário: ${r.data.split("-").reverse().join("/")} às ${r.hora.slice(0, 5)}.`,
      quando: null,
      novo: false,
      link: { to: "/agenda", search: { dia: r.data } },
      escritorio: false,
    });
  }

  if (f.pagamentosPendentes > 0) {
    lista.push({
      id: "pagamentos",
      tom: "neutro",
      titulo:
        f.pagamentosPendentes === 1
          ? "1 OS com pagamento pendente"
          : `${f.pagamentosPendentes} OS com pagamento pendente`,
      texto: "Confira os recebimentos.",
      quando: null,
      novo: false,
      link: { to: "/pagamentos", search: { status: "Não pago" } },
      escritorio: true,
    });
  }

  const visiveis = papel === "tecnico" ? lista.filter((a) => !a.escritorio) : lista;
  return visiveis.sort(
    (a, b) =>
      ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom] ||
      Number(b.novo) - Number(a.novo) ||
      (b.quando ?? "").localeCompare(a.quando ?? ""),
  );
}

/** Há algo que pede atenção (para o ponto na aba Avisos). */
export function temAvisoImportante(avisos: Aviso[]): boolean {
  return (
    avisos.some((a) => a.novo && a.tom !== "neutro") || avisos.some((a) => a.tom === "problema")
  );
}

// ---------------------------------------------------------------- avisos no WhatsApp da equipe

/** Chave do telefone igual à do banco (private.telefone_chave): DDD + últimos 8 dígitos. */
export function chaveTelefone(telefone: string | null | undefined): string | null {
  let d = (telefone ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return d.length >= 8 ? d : null;
  return d.slice(2, 4) + d.slice(-8);
}

/** O número da equipe coincide com o de algum cliente? (então nada pode ser enviado). */
export function numeroDeCliente(
  numeroEquipe: string | null | undefined,
  telefonesDeClientes: (string | null | undefined)[],
): boolean {
  const chave = chaveTelefone(numeroEquipe);
  if (!chave) return false;
  return telefonesDeClientes.some((t) => chaveTelefone(t) === chave);
}

export type EsperaConversa = {
  id: string;
  nome: string;
  desde: string;
  motivo: string | null;
};

/**
 * Esperas que já passaram do limite e ainda não viraram aviso. Uma espera vira aviso uma vez
 * só: se já existe aviso da conversa criado depois do início da espera, não repete.
 */
export function esperasParaAvisar(
  esperas: EsperaConversa[],
  avisosExistentes: { conversaId: string; criadoEm: string }[],
  minutos: number,
  agora = new Date(),
): EsperaConversa[] {
  const limite = agora.getTime() - minutos * 60_000;
  return esperas.filter(
    (e) =>
      Date.parse(e.desde) <= limite &&
      !avisosExistentes.some((a) => a.conversaId === e.id && a.criadoEm >= e.desde),
  );
}

export function textoEspera(e: EsperaConversa, agora = new Date()): string {
  const min = Math.max(1, Math.round((agora.getTime() - Date.parse(e.desde)) / 60_000));
  return `${e.nome} espera resposta da equipe há ${min} min${e.motivo ? ` (${e.motivo})` : ""}. Abra Conversas no Nexa.`;
}

export function textoResumoDoDia(n: {
  servicosHoje: number;
  atrasados: number;
  semTecnico: number;
  esperando: number;
}): string {
  const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;
  return [
    `${plural(n.servicosHoje, "serviço", "serviços")} hoje`,
    plural(n.atrasados, "atrasado", "atrasados"),
    `${plural(n.semTecnico, "serviço", "serviços")} sem técnico`,
    `${plural(n.esperando, "cliente esperando", "clientes esperando")} a equipe`,
  ].join(" · ");
}
