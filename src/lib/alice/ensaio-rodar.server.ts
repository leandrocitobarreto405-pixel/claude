/**
 * Roda a Alice de verdade (mesmo modelo, instruções e ferramentas da empresa) numa conversa de
 * ensaio. Nada é enviado nem gravado: cada ferramenta devolve o texto de `respostaDeEnsaio`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { COM_FALLBACK, SEM_SISTEMA_NO_MEIO } from "./motor.server";
import { montarTurnos, type MensagemHistorico, type Uso } from "./prompt";
import { RECUSA_PRECO_TRAVADO, temPreco } from "./preco-depois";

export type FalaEnsaio = { de: "cliente" | "alice"; texto: string };

export type RespostaEnsaio = {
  resposta: string[];
  ferramentas: Array<{ nome: string; entrada: unknown }>;
  /** Tokens somados das rodadas (para o custo). */
  uso: Uso;
  rodadas: number;
  /** Textos com preço barrados pela trava (regra nº 1): não iriam ao cliente. */
  retidos: string[];
};

export async function rodarAliceEnsaio(opcoes: {
  cliente: Anthropic;
  modelo: string;
  esforco: string;
  ferramentas: Anthropic.Beta.BetaToolUnion[];
  fixas: string;
  momento: string;
  historico: FalaEnsaio[];
  respostaDeEnsaio: (ferramenta: string, entrada: unknown) => string | Promise<string>;
  /** Regra nº 1: preço travado nesta resposta (como no motor). */
  precoTravado?: boolean;
  /** Como a produção: cache automático no fim e o sistema em cache de 1 hora. */
  cacheComoProducao?: boolean;
  /** Ajusta os turnos antes do envio (ex.: ponto de cache do histórico). */
  prepararTurnos?: (t: Anthropic.Beta.BetaMessageParam[]) => Anthropic.Beta.BetaMessageParam[];
}): Promise<RespostaEnsaio> {
  const hist: MensagemHistorico[] = opcoes.historico.map((m) => ({
    direcao: m.de === "cliente" ? "Recebida" : "Enviada",
    texto: m.texto,
    tipo: "Texto",
    remetente: m.de === "cliente" ? null : "agent_bot",
    imagens: [],
  }));
  const turnos0 = montarTurnos(hist) ?? [];
  const turnos = opcoes.prepararTurnos ? opcoes.prepararTurnos(turnos0) : turnos0;
  const noMeio = !SEM_SISTEMA_NO_MEIO.includes(opcoes.modelo);
  const mensagens: Anthropic.Beta.BetaMessageParam[] = noMeio
    ? [...turnos, { role: "system", content: opcoes.momento } as never]
    : [...turnos];
  const sistema: Anthropic.Beta.BetaTextBlockParam[] = [
    opcoes.cacheComoProducao
      ? { type: "text", text: opcoes.fixas, cache_control: { type: "ephemeral", ttl: "1h" } }
      : { type: "text", text: opcoes.fixas },
    ...(noMeio ? [] : [{ type: "text" as const, text: opcoes.momento }]),
  ];
  const resposta: string[] = [];
  const retidos: string[] = [];
  const trava = Boolean(opcoes.precoTravado);
  const usadas: Array<{ nome: string; entrada: unknown }> = [];
  const uso: Uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, cacheEscrita1h: 0 };
  let rodadas = 0;
  for (let rodada = 0; rodada < 5; rodada++) {
    rodadas++;
    const r = await opcoes.cliente.beta.messages.create({
      model: opcoes.modelo,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: opcoes.esforco as "low" | "medium" | "high" },
      ...(COM_FALLBACK.includes(opcoes.modelo)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      ...(opcoes.cacheComoProducao ? { cache_control: { type: "ephemeral" as const } } : {}),
      system: sistema,
      tools: opcoes.ferramentas,
      messages: mensagens,
    });
    uso.entrada += r.usage.input_tokens;
    uso.saida += r.usage.output_tokens;
    uso.cacheLeitura += r.usage.cache_read_input_tokens ?? 0;
    // Igual ao motor: total gravado (5 min + 1 hora) e a parte de 1 hora.
    uso.cacheEscrita += r.usage.cache_creation_input_tokens ?? 0;
    uso.cacheEscrita1h! += r.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    for (const b of r.content) {
      if (b.type !== "text" || !b.text.trim()) continue;
      if (trava && temPreco(b.text)) retidos.push(b.text.trim());
      else resposta.push(b.text.trim());
    }
    const chamadas = r.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (r.stop_reason !== "tool_use" || !chamadas.length) break;
    mensagens.push({ role: "assistant", content: r.content });
    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const ch of chamadas) {
      usadas.push({ nome: ch.name, entrada: ch.input });
      const texto = (ch.input as { texto?: string }).texto;
      const barrada =
        trava &&
        (ch.name === "criar_orcamento" || (ch.name === "enviar_mensagem" && temPreco(texto)));
      if (barrada && ch.name === "enviar_mensagem" && texto) retidos.push(texto.trim());
      else if (ch.name === "enviar_mensagem" && texto) resposta.push(texto.trim());
      resultados.push({
        type: "tool_result",
        tool_use_id: ch.id,
        content: barrada ? RECUSA_PRECO_TRAVADO : await opcoes.respostaDeEnsaio(ch.name, ch.input),
        ...(barrada ? { is_error: true } : {}),
      });
    }
    mensagens.push({ role: "user", content: resultados });
  }
  return { resposta, ferramentas: usadas, uso, rodadas, retidos };
}
