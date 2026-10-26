/**
 * Roda a Alice de verdade (mesmo modelo, instruções e ferramentas da empresa) numa conversa de
 * ensaio. Nada é enviado nem gravado: cada ferramenta devolve o texto de `respostaDeEnsaio`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { COM_FALLBACK, SEM_SISTEMA_NO_MEIO } from "./motor.server";
import { montarTurnos, type MensagemHistorico } from "./prompt";

export type FalaEnsaio = { de: "cliente" | "alice"; texto: string };

export type RespostaEnsaio = {
  resposta: string[];
  ferramentas: Array<{ nome: string; entrada: unknown }>;
};

export async function rodarAliceEnsaio(opcoes: {
  cliente: Anthropic;
  modelo: string;
  esforco: string;
  ferramentas: Anthropic.Beta.BetaToolUnion[];
  fixas: string;
  momento: string;
  historico: FalaEnsaio[];
  respostaDeEnsaio: (ferramenta: string) => string;
}): Promise<RespostaEnsaio> {
  const hist: MensagemHistorico[] = opcoes.historico.map((m) => ({
    direcao: m.de === "cliente" ? "Recebida" : "Enviada",
    texto: m.texto,
    tipo: "Texto",
    remetente: m.de === "cliente" ? null : "agent_bot",
    imagens: [],
  }));
  const turnos = montarTurnos(hist) ?? [];
  const noMeio = !SEM_SISTEMA_NO_MEIO.includes(opcoes.modelo);
  const mensagens: Anthropic.Beta.BetaMessageParam[] = noMeio
    ? [...turnos, { role: "system", content: opcoes.momento } as never]
    : [...turnos];
  const sistema: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: opcoes.fixas },
    ...(noMeio ? [] : [{ type: "text" as const, text: opcoes.momento }]),
  ];
  const resposta: string[] = [];
  const usadas: Array<{ nome: string; entrada: unknown }> = [];
  for (let rodada = 0; rodada < 5; rodada++) {
    const r = await opcoes.cliente.beta.messages.create({
      model: opcoes.modelo,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: opcoes.esforco as "low" | "medium" | "high" },
      ...(COM_FALLBACK.includes(opcoes.modelo)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      system: sistema,
      tools: opcoes.ferramentas,
      messages: mensagens,
    });
    for (const b of r.content) if (b.type === "text" && b.text.trim()) resposta.push(b.text.trim());
    const chamadas = r.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (r.stop_reason !== "tool_use" || !chamadas.length) break;
    mensagens.push({ role: "assistant", content: r.content });
    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const ch of chamadas) {
      usadas.push({ nome: ch.name, entrada: ch.input });
      if (ch.name === "enviar_mensagem") {
        const t = (ch.input as { texto?: string }).texto;
        if (t) resposta.push(t.trim());
      }
      resultados.push({
        type: "tool_result",
        tool_use_id: ch.id,
        content: opcoes.respostaDeEnsaio(ch.name),
      });
    }
    mensagens.push({ role: "user", content: resultados });
  }
  return { resposta, ferramentas: usadas };
}
