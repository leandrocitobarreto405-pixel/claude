// Regras da tela Conversas (sem acesso a banco, para poder testar).
// A leitura usa só as tabelas do Nexa (conversas, whatsapp_*), que continuam iguais quando o
// Chatwoot for trocado pela API oficial do WhatsApp; o que é do Chatwoot fica nas ações.

export type GrupoConversa = "precisam" | "alice" | "equipe" | "finalizadas";

/**
 * Em que aba a conversa entra, pelo status do Chatwoot:
 * pending = com a Alice; open = com a equipe (precisa de você se o cliente espera resposta);
 * resolved = finalizada; snoozed (adiada) conta como com a equipe.
 */
/**
 * Aba da conversa. "Precisam de você" só quando o cliente está esperando de verdade: a conversa
 * está com a equipe, marcada como aguardando e a última mensagem é do cliente (se a equipe falou
 * por último, não está esperando, mesmo que o Chatwoot ainda marque).
 */
export function grupoDaConversa(
  status: string | null,
  aguardandoDesde: string | null,
  ultimaDoCliente = true,
): GrupoConversa {
  if (status === "pending") return "alice";
  if (status === "resolved") return "finalizadas";
  return aguardandoDesde && ultimaDoCliente ? "precisam" : "equipe";
}

/** Direção da última mensagem de cada conversa (lista em ordem da mais nova para a mais antiga). */
export function ultimaDirecaoPorConversa(
  msgs: { conversa_id: string | null; direction: string }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of msgs)
    if (x.conversa_id && !m.has(x.conversa_id)) m.set(x.conversa_id, x.direction);
  return m;
}

/** "agora", "há 4 min", "há 2 h", "ontem" ou "12/09". */
export function haQuanto(iso: string | null, agora = new Date()): string {
  if (!iso) return "";
  const quando = new Date(iso);
  const min = Math.floor((agora.getTime() - quando.getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  if (horas < 48) return "ontem";
  return quando.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
}

/** Iniciais do nome ("Fernanda Lima" -> "FL"). Sem letras (só telefone), vazio. */
export function iniciais(nome: string): string {
  const palavras = nome
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  if (!palavras.length) return "";
  const primeira = palavras[0]!;
  const ultima = palavras.length > 1 ? palavras[palavras.length - 1]! : "";
  return (primeira[0]! + (ultima[0] ?? primeira[1] ?? "")).toUpperCase();
}

/** Texto de uma mensagem para a lista: o texto, ou o tipo de mídia entre parênteses. */
export function textoDaMensagem(texto: string | null, tipo: string | null): string {
  if (texto && texto.trim()) return texto.trim();
  const t = (tipo ?? "").toLowerCase();
  if (t.includes("imag") || t.includes("foto")) return "(foto)";
  if (t.includes("áudio") || t.includes("audio")) return "(áudio)";
  if (t.includes("víd") || t.includes("vid")) return "(vídeo)";
  if (t.includes("doc")) return "(documento)";
  return "(mídia)";
}

/** Cliente esperando resposta há mais de 24 h (destaque no cartão). */
export function semRespostaHaMuito(desde: string | null, agora = new Date(), horas = 24): boolean {
  if (!desde) return false;
  return agora.getTime() - new Date(desde).getTime() >= horas * 3_600_000;
}

/** Tipo de mensagem (message_type) é áudio / imagem. */
export function ehAudio(tipo: string | null): boolean {
  const t = (tipo ?? "").toLowerCase();
  return t.includes("áudio") || t.includes("audio");
}

export function ehImagem(tipo: string | null): boolean {
  const t = (tipo ?? "").toLowerCase();
  return t.includes("imag") || t.includes("foto");
}

export type Passagem = { motivo: string; resumo: string | null; posVenda: boolean };

/**
 * Motivo da última vez que a Alice passou a conversa para a equipe, a partir das execuções
 * (mais novas primeiro) com a lista de ferramentas usadas.
 */
export function ultimaPassagem(execucoes: { ferramentas: unknown }[]): Passagem | null {
  for (const e of execucoes) {
    if (!Array.isArray(e.ferramentas)) continue;
    const f = (e.ferramentas as Array<{ nome?: string; entrada?: Record<string, unknown> }>).find(
      (x) => x.nome === "transferir_para_humano" || x.nome === "passar_para_atendente",
    );
    if (!f) continue;
    const entrada = f.entrada ?? {};
    return {
      motivo: String(entrada["motivo"] ?? "").trim() || "Passada pela Alice",
      resumo: entrada["resumo"] ? String(entrada["resumo"]) : null,
      posVenda: entrada["problema_pos_venda"] === true,
    };
  }
  return null;
}

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Data no fuso de São Paulo, como "2026-10-22" (para comparar dias). */
function diaSP(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Hora na lista de conversas, como no WhatsApp: hoje "14:32", ontem "ontem", nesta semana o dia
 * ("seg"), antes disso a data ("12/10").
 */
export function horaNaLista(iso: string | null, agora = new Date()): string {
  if (!iso) return "";
  const quando = new Date(iso);
  if (!Number.isFinite(quando.getTime())) return "";
  const hoje = diaSP(agora);
  const dia = diaSP(quando);
  if (dia === hoje)
    return quando.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
  const dias = Math.round((Date.parse(hoje) - Date.parse(dia)) / 86_400_000);
  if (dias === 1) return "ontem";
  if (dias > 1 && dias < 7) return DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()]!;
  return quando.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
}

/** "há 3 h" → "3 h" (para o detalhe curto da lista). */
export function esperaCurta(iso: string | null, agora = new Date()): string {
  return haQuanto(iso, agora).replace(/^há /, "");
}
