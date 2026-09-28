/**
 * Ferramentas da Alice. Toda leitura/gravação é filtrada pela empresa da tarefa (o processador
 * usa a chave de serviço, então o filtro por empresa é obrigatório em cada consulta).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ContextoFerramenta = {
  admin: SupabaseClient<Database>;
  empresaId: string;
  leadId: string | null;
  /** Preenchido por passar_para_atendente: o processador conclui a passagem depois da resposta. */
  passagem: { motivo: string; resumo: string } | null;
};

const AtualizarLead = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  servico_interesse: z.string().trim().min(1).max(80).optional(),
  descricao_estofados: z.string().trim().min(1).max(1000).optional(),
  endereco: z.string().trim().min(1).max(300).optional(),
  resumo: z.string().trim().min(1).max(1500).optional(),
  temperatura: z.enum(["QUENTE", "FRIO"]).optional(),
});

const ConsultarAgenda = z.object({
  data_inicial: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dias: z.number().int().min(1).max(14),
});

const PassarParaAtendente = z.object({
  motivo: z.string().trim().min(1).max(300),
  resumo: z.string().trim().min(1).max(1500),
});

export const FERRAMENTAS: Anthropic.Beta.BetaTool[] = [
  {
    name: "atualizar_lead",
    description:
      "Guarda no sistema os dados que o cliente informou. Use sempre que aprender algo novo: nome, peças/estofados (quantidade, tipo, tamanho, tecido, manchas), serviço de interesse, endereço/bairro/CEP, e um resumo curto do atendimento até agora. Envie só os campos novos.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome do cliente, se ele informar." },
        servico_interesse: {
          type: "string",
          description: "Higienização, Impermeabilização ou Higienização e impermeabilização.",
        },
        descricao_estofados: {
          type: "string",
          description:
            "Peças e detalhes, ex.: 'Sofá retrátil 3 lugares, tecido suede, mancha de café'.",
        },
        endereco: { type: "string", description: "Endereço, bairro, cidade ou CEP informados." },
        resumo: {
          type: "string",
          description: "Resumo do atendimento até agora, em 1 a 3 frases.",
        },
        temperatura: {
          type: "string",
          enum: ["QUENTE", "FRIO"],
          description: "QUENTE se o cliente demonstra intenção clara de fechar.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "consultar_agenda",
    description:
      "Mostra os serviços já agendados por dia, para sugerir datas com vaga. Use antes de propor dias ao cliente.",
    input_schema: {
      type: "object",
      properties: {
        data_inicial: { type: "string", description: "Primeiro dia, no formato AAAA-MM-DD." },
        dias: { type: "integer", minimum: 1, maximum: 14, description: "Quantos dias consultar." },
      },
      required: ["data_inicial", "dias"],
      additionalProperties: false,
    },
  },
  {
    name: "passar_para_atendente",
    description:
      "Passa a conversa para uma atendente humana. Depois de chamar, escreva ao cliente uma frase curta avisando que uma especialista vai continuar o atendimento.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description: "Por que está passando (ex.: cliente quer agendar).",
        },
        resumo: {
          type: "string",
          description:
            "Resumo para a atendente: o que o cliente quer, peças, valores passados e próximos passos.",
        },
      },
      required: ["motivo", "resumo"],
      additionalProperties: false,
    },
  },
];

const STATUS_OCUPADO = ["Agendado", "Confirmado", "Em deslocamento", "Em execução"];

async function atualizarLead(ctx: ContextoFerramenta, input: z.infer<typeof AtualizarLead>) {
  if (!ctx.leadId) return "Sem lead vinculado a esta conversa; nada foi gravado.";
  const { data: lead } = await ctx.admin
    .from("crm_leads")
    .select("notes")
    .eq("id", ctx.leadId)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (!lead) return "Lead não encontrado.";
  const mudancas: Database["public"]["Tables"]["crm_leads"]["Update"] = {};
  if (input.nome) mudancas.lead_name = input.nome;
  if (input.servico_interesse) mudancas.service_interest = input.servico_interesse;
  if (input.descricao_estofados) mudancas.upholstery_description = input.descricao_estofados;
  if (input.resumo) {
    mudancas.summary = input.resumo;
    mudancas.summary_source = "Alice";
  }
  if (input.temperatura) mudancas.temperature = input.temperatura;
  if (input.endereco) {
    const linha = `Endereço informado ao atendimento: ${input.endereco}`;
    const atuais = lead.notes ?? "";
    if (!atuais.includes(linha)) mudancas.notes = atuais ? `${atuais}\n${linha}` : linha;
  }
  if (!Object.keys(mudancas).length) return "Nada novo para gravar.";
  const { error } = await ctx.admin
    .from("crm_leads")
    .update(mudancas)
    .eq("id", ctx.leadId)
    .eq("empresa_id", ctx.empresaId);
  return error ? `Não foi possível gravar: ${error.message}` : "Dados gravados.";
}

async function consultarAgenda(ctx: ContextoFerramenta, input: z.infer<typeof ConsultarAgenda>) {
  const inicio = new Date(`${input.data_inicial}T12:00:00Z`);
  const fim = new Date(inicio.getTime() + (input.dias - 1) * 86_400_000);
  const ate = fim.toISOString().slice(0, 10);
  const { data, error } = await ctx.admin
    .from("visits")
    .select("scheduled_date, scheduled_time")
    .eq("empresa_id", ctx.empresaId)
    .gte("scheduled_date", input.data_inicial)
    .lte("scheduled_date", ate)
    .in("status", STATUS_OCUPADO)
    .order("scheduled_date")
    .order("scheduled_time");
  if (error) return `Não foi possível consultar a agenda: ${error.message}`;
  const porDia = new Map<string, string[]>();
  for (const v of data ?? []) {
    const lista = porDia.get(v.scheduled_date) ?? [];
    lista.push((v.scheduled_time ?? "").slice(0, 5) || "sem horário");
    porDia.set(v.scheduled_date, lista);
  }
  const linhas: string[] = [];
  for (let i = 0; i < input.dias; i++) {
    const dia = new Date(inicio.getTime() + i * 86_400_000);
    const iso = dia.toISOString().slice(0, 10);
    const semana = dia.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
    const horarios = porDia.get(iso) ?? [];
    linhas.push(
      `${iso} (${semana}): ${horarios.length ? `${horarios.length} serviço(s) às ${horarios.join(", ")}` : "livre"}`,
    );
  }
  return linhas.join("\n");
}

export async function executarFerramenta(
  ctx: ContextoFerramenta,
  nome: string,
  entrada: unknown,
): Promise<{ conteudo: string; erro: boolean }> {
  if (nome === "atualizar_lead") {
    const p = AtualizarLead.safeParse(entrada);
    if (!p.success) return { conteudo: `Entrada inválida: ${p.error.message}`, erro: true };
    return { conteudo: await atualizarLead(ctx, p.data), erro: false };
  }
  if (nome === "consultar_agenda") {
    const p = ConsultarAgenda.safeParse(entrada);
    if (!p.success) return { conteudo: `Entrada inválida: ${p.error.message}`, erro: true };
    return { conteudo: await consultarAgenda(ctx, p.data), erro: false };
  }
  if (nome === "passar_para_atendente") {
    const p = PassarParaAtendente.safeParse(entrada);
    if (!p.success) return { conteudo: `Entrada inválida: ${p.error.message}`, erro: true };
    ctx.passagem = p.data;
    return {
      conteudo:
        "Combinado. Agora escreva ao cliente uma frase curta avisando que uma especialista vai continuar.",
      erro: false,
    };
  }
  return { conteudo: `Ferramenta desconhecida: ${nome}`, erro: true };
}
