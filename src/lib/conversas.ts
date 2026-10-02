// Regras da tela Conversas (sem acesso a banco, para poder testar).
// A leitura usa só as tabelas do Nexa (conversas, whatsapp_*), que continuam iguais quando o
// Chatwoot for trocado pela API oficial do WhatsApp; o que é do Chatwoot fica nas ações.

export type GrupoConversa = "precisam" | "alice" | "equipe" | "finalizadas";

/**
 * Em que aba a conversa entra, pelo status do Chatwoot:
 * pending = com a Alice; open = com a equipe (precisa de você se o cliente espera resposta);
 * resolved = finalizada; snoozed (adiada) conta como com a equipe.
 */
export function grupoDaConversa(
  status: string | null,
  aguardandoDesde: string | null,
): GrupoConversa {
  if (status === "pending") return "alice";
  if (status === "resolved") return "finalizadas";
  return aguardandoDesde ? "precisam" : "equipe";
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
