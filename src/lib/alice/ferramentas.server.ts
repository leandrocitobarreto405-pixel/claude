/**
 * Ferramentas da Alice. Toda leitura/gravação é filtrada pela empresa da tarefa (o processador
 * usa a chave de serviço, então o filtro por empresa é obrigatório em cada consulta).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  dataHoraTexto,
  dentroDaJanela,
  lerDataHoraLocal,
  MOTIVOS_PERDA,
  normalizarNome,
  proximoHorarioPermitido,
  reais,
  SINONIMOS_PERDA,
  validade,
  type MotivoPerda,
} from "./regras";

import { rotulosAcrescimo } from "@/lib/orcamento-regras";
import { precificar, totalizar, type ItemTabela, type LinhaOrcamento } from "./orcamento-alice";
import {
  descontoPermitido,
  lerMarketing,
  registrarIndicacao,
  registrarProblemaPosVenda,
  textoMarketing,
} from "./marketing.server";

type Admin = SupabaseClient<Database>;
export type ConfigIa = Database["public"]["Tables"]["ia_configuracoes"]["Row"];
type Servico = "higienizacao" | "impermeabilizacao";

/** O que vai ao cliente, na ordem: mensagens e mídias pedidas pelas ferramentas. */
export type Saida =
  /** bloco: vai numa mensagem só, com as linhas em branco dentro (enviar_mensagem). */
  | { tipo: "texto"; texto: string; bloco?: boolean }
  | {
      tipo: "anexo";
      caminho: string;
      nome: string;
      /** Pasta do arquivo (padrão: "alice-midias"). */
      pasta?: string;
      /** Não segura o resto da resposta (a espera depois da mídia é para vídeo/áudio). */
      semEspera?: boolean;
      /** caminho é o id de um documento do Google, mandado em PDF (a OS). */
      googleDoc?: boolean;
    };

export type ContextoFerramenta = {
  admin: Admin;
  empresaId: string;
  cfg: ConfigIa;
  conversaId: string;
  leadId: string | null;
  contatoId: string | null;
  agora: Date;
  /** Última mensagem do cliente (janela de 24 h do WhatsApp). */
  ultimaDoCliente: Date | null;
  /** Etapas do CRM que a Alice pode usar (status abertos da empresa). */
  etapas: string[];
  /** Preenchido por transferir_para_humano: o processador conclui a passagem depois da resposta. */
  passagem: { motivo: string; resumo: string } | null;
  /** Mensagens e mídias pedidas pelas ferramentas (o processador envia na ordem das chamadas). */
  saida: Saida[];
  /** Algum follow-up foi agendado (o processador entrega à fila no fim). */
  agendouFollowup: boolean;
  /** OS reservada nesta resposta (reservar_horario → gerar_ordem_servico). */
  osReservada?: { id: string; os_number: string };
};

// ---------------------------------------------------------------- entradas
const SERVICO = z.enum(["higienizacao", "impermeabilizacao"]);

const AtualizarLead = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  servico_interesse: z.string().trim().min(1).max(80).optional(),
  descricao_estofados: z.string().trim().min(1).max(1000).optional(),
  endereco: z.string().trim().min(1).max(300).optional(),
  resumo: z.string().trim().min(1).max(1500).optional(),
  temperatura: z.enum(["QUENTE", "FRIO"]).optional(),
});
const ConsultarCep = z.object({ cep: z.string().trim().min(8).max(10) });
const CLASSE = z.enum(["A", "B", "C"]);
const ConsultarTabela = z.object({
  servico: SERVICO.optional(),
  classe: CLASSE.optional(),
  almofadas_soltas: z.boolean().optional(),
  muito_encardido: z.boolean().optional(),
});
const CriarOrcamento = z.object({
  servico: SERVICO,
  itens: z
    .array(
      z.object({
        item: z.string().trim().min(1).max(120),
        quantidade: z.number().int().min(1).max(50).default(1),
        classe: CLASSE.optional(),
        almofadas_soltas: z.boolean().optional(),
        muito_encardido: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(15),
  cep: z.string().trim().max(10).optional(),
  rotulo: z.string().trim().max(40).optional(),
  desconto: z.enum(["campanha", "indicacao"]).optional(),
});
const RegistrarIndicacao = z.object({
  nome: z.string().trim().min(1).max(120),
  telefone: z.string().trim().min(8).max(30),
});
const EnviarMidia = z.object({ servico: SERVICO });
const EnviarMensagem = z.object({ texto: z.string().trim().min(1).max(4000) });
const DadosTecnico = z.object({ tecnico: z.string().trim().max(80).optional() });
const ConsultarAgenda = z.object({
  data_inicial: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dias: z.number().int().min(1).max(14),
  periodo: z.enum(["manha", "tarde", "qualquer"]).optional(),
  cep: z.string().max(12).optional(),
});
const AgendarFollowup = z
  .object({
    em_minutos: z
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 60)
      .optional(),
    data_hora: z.string().trim().max(20).optional(),
    trilha: z.enum(["A", "B", "C"]),
    motivo: z.string().trim().min(1).max(300),
    mensagem_sugerida: z.string().trim().min(1).max(1000),
  })
  .refine((v) => (v.em_minutos === undefined) !== (v.data_hora === undefined), {
    message: "informe em_minutos OU data_hora",
  });
const RegistrarPerda = z.object({
  motivo: z.enum(MOTIVOS_PERDA),
  detalhe: z.string().trim().max(500).optional(),
  data_retorno: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const AtualizarEtapa = z.object({
  etapa: z.string().trim().min(1).max(80),
  observacao: z.string().trim().max(300).optional(),
});
const Transferir = z.object({
  motivo: z.string().trim().min(1).max(300),
  resumo: z.string().trim().min(1).max(1500),
  problema_pos_venda: z.boolean().optional(),
});

// ---------------------------------------------------------------- definições
const S_SERVICO = {
  type: "string",
  enum: ["higienizacao", "impermeabilizacao"],
  description: "Serviço: higienizacao ou impermeabilizacao.",
} as const;
const S_CLASSE = {
  type: "string",
  enum: ["A", "B", "C"],
  description:
    "Classe do estofado (padrão B). Só vale se a empresa usa classe; siga as instruções da empresa antes de usar A.",
} as const;
const S_ALMOFADAS = {
  type: "boolean",
  description: "true se as almofadas são soltas (acréscimo da empresa). Fixas: false.",
} as const;
const S_ENCARDIDO = {
  type: "boolean",
  description: "true só se a foto mostrar o estofado muito encardido (acréscimo da empresa).",
} as const;

/** Ferramentas liberadas para a empresa (a ordem é fixa, para aproveitar o cache). */
export function ferramentasDisponiveis(cfg: ConfigIa, etapas: string[]): Anthropic.Beta.BetaTool[] {
  const lista: Anthropic.Beta.BetaTool[] = [
    {
      name: "atualizar_lead",
      description:
        "Guarda no CRM o que o cliente informou: nome, estofados (tipo, tamanho, tecido, manchas), serviço de interesse, CEP/endereço e um resumo curto do atendimento. Envie só os campos novos.",
      input_schema: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome que o cliente disse." },
          servico_interesse: {
            type: "string",
            description: "Higienização, Impermeabilização ou Higienização e impermeabilização.",
          },
          descricao_estofados: {
            type: "string",
            description: "Ex.: 'Sofá retrátil 2 módulos, ~2,40 m, suede, mancha de café'.",
          },
          endereco: { type: "string", description: "CEP, bairro, cidade ou endereço informado." },
          resumo: {
            type: "string",
            description: "Resumo do atendimento até agora (1 a 3 frases).",
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
      name: "consultar_cliente",
      description:
        "Histórico do cliente no sistema: se já é cliente, serviços anteriores, orçamentos deste atendimento, retornos pendentes, as marcações 'IA desligada' e 'sem pós-venda' e, se veio de disparo de marketing, a campanha, o grupo, a mensagem recebida e a condição; indicação (quem indicou, crédito) e o link da avaliação no Google.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "consultar_cep",
      description:
        "Endereço do CEP, distância até a base e se o endereço está dentro da área atendida.",
      input_schema: {
        type: "object",
        properties: { cep: { type: "string", description: "CEP com 8 dígitos." } },
        required: ["cep"],
        additionalProperties: false,
      },
    },
    {
      name: "consultar_tabela_precos",
      description:
        "Tabela de preços oficial, por item e serviço (nomes exatos para o orçamento). Com classe/almofadas_soltas/muito_encardido, devolve os preços já com os acréscimos da empresa.",
      input_schema: {
        type: "object",
        properties: {
          servico: S_SERVICO,
          classe: S_CLASSE,
          almofadas_soltas: S_ALMOFADAS,
          muito_encardido: S_ENCARDIDO,
        },
        additionalProperties: false,
      },
    },
    {
      name: "criar_orcamento",
      description:
        "Cria o orçamento no sistema (vinculado a este cliente) e devolve itens, total, parcela no cartão, valor no Pix e validade. Use os nomes exatos da tabela. Para duas opções (ex.: só o sofá / sofá com cadeiras), chame uma vez para cada opção, com rotulo.",
      input_schema: {
        type: "object",
        properties: {
          servico: S_SERVICO,
          itens: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item: { type: "string", description: "Nome exato do item na tabela." },
                quantidade: { type: "integer", minimum: 1 },
                classe: S_CLASSE,
                almofadas_soltas: S_ALMOFADAS,
                muito_encardido: S_ENCARDIDO,
              },
              required: ["item"],
              additionalProperties: false,
            },
          },
          cep: { type: "string", description: "CEP do cliente, se já souber." },
          rotulo: { type: "string", description: "Ex.: 'Opção 1'." },
          desconto: {
            type: "string",
            enum: ["campanha", "indicacao"],
            description:
              "Só se consultar_cliente mostrar a condição da campanha válida (campanha) ou indicação/crédito (indicacao). O sistema calcula o percentual. Nunca os dois juntos.",
          },
        },
        required: ["servico", "itens"],
        additionalProperties: false,
      },
    },
    {
      name: "registrar_indicacao",
      description:
        "Registra a indicação que o cliente fez (nome e telefone de quem ele indicou): o indicado ganha o desconto de indicação no primeiro serviço e o cliente ganha crédito no próximo quando o indicado fechar.",
      input_schema: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome da pessoa indicada." },
          telefone: {
            type: "string",
            description: "Telefone (WhatsApp) da pessoa indicada, com DDD.",
          },
        },
        required: ["nome", "telefone"],
        additionalProperties: false,
      },
    },
  ];
  lista.push({
    name: "enviar_mensagem",
    description:
      'Manda ao cliente UMA mensagem de WhatsApp AGORA, antes das próximas ferramentas, exatamente como você escreveu: linhas em branco ficam dentro da mesma mensagem. Use para o aviso antes do vídeo (ex.: "Enquanto eu preparo seu orçamento, vou te mandar um vídeo curtinho, tá bom?" antes de enviar_video) e para textos em blocos que precisam chegar juntos, como o orçamento inteiro ou a explicação do serviço. A mensagem final da resposta você escreve normalmente, sem esta ferramenta.',
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "O texto exato para o cliente." },
      },
      required: ["texto"],
      additionalProperties: false,
    },
  });
  const temVideo = cfg.video_higienizacao || cfg.video_impermeabilizacao;
  const temAudio = cfg.audio_higienizacao || cfg.audio_impermeabilizacao;
  const servicosCom = (h: string | null, i: string | null) =>
    [h ? "higienizacao" : null, i ? "impermeabilizacao" : null].filter(Boolean).join(" e ");
  if (temVideo) {
    lista.push({
      name: "enviar_video",
      description: `Envia ao cliente o vídeo padrão do serviço (cadastrado para: ${servicosCom(cfg.video_higienizacao, cfg.video_impermeabilizacao)}). Sai na ordem em que você chamar as ferramentas (depois de um enviar_mensagem chamado antes).`,
      input_schema: {
        type: "object",
        properties: { servico: S_SERVICO },
        required: ["servico"],
        additionalProperties: false,
      },
    });
  }
  if (temAudio) {
    lista.push({
      name: "enviar_audio_padrao",
      description: `Envia ao cliente o áudio padrão gravado pela equipe explicando o serviço (cadastrado para: ${servicosCom(cfg.audio_higienizacao, cfg.audio_impermeabilizacao)}). Sai na ordem em que você chamar as ferramentas (depois de um enviar_mensagem chamado antes).`,
      input_schema: {
        type: "object",
        properties: { servico: S_SERVICO },
        required: ["servico"],
        additionalProperties: false,
      },
    });
  }
  if (cfg.agenda_automatica) {
    lista.push({
      name: "enviar_dados_tecnico",
      description:
        "Manda ao cliente a foto do técnico responsável (junto da sua mensagem) e devolve o nome dele. Use depois que o cliente aprovar o orçamento e na confirmação do agendamento. Informe o técnico do horário oferecido (o nome que veio em consultar_agenda); se a empresa tiver um técnico só, pode omitir.",
      input_schema: {
        type: "object",
        properties: {
          tecnico: { type: "string", description: "Nome do técnico (como em consultar_agenda)." },
        },
        additionalProperties: false,
      },
    });
    lista.push({
      name: "consultar_agenda",
      description:
        "Horários livres dos técnicos (horários-base da agenda da empresa menos o que já está marcado), os dias da semana atendidos e quais dias o técnico já tem serviço perto do cliente (prioridade). Use antes de oferecer horário: ofereça um só, desta lista.",
      input_schema: {
        type: "object",
        properties: {
          data_inicial: { type: "string", description: "Primeiro dia, no formato AAAA-MM-DD." },
          dias: {
            type: "integer",
            minimum: 1,
            maximum: 14,
            description: "Quantos dias consultar.",
          },
          periodo: {
            type: "string",
            enum: ["manha", "tarde", "qualquer"],
            description: "Preferência do cliente: manhã, tarde ou qualquer.",
          },
          cep: {
            type: "string",
            description: "CEP do cliente (para priorizar dias com serviço perto).",
          },
        },
        required: ["data_inicial", "dias"],
        additionalProperties: false,
      },
    });
    lista.push({
      name: "reservar_horario",
      description:
        "Reserva o horário que o cliente aceitou e cria a ordem de serviço (OS) no sistema com o orçamento aprovado, já com o próximo número. Confere de novo se o horário está livre. Use só com o horário aceito e os dados do cliente (nome completo, CEP, número e forma de pagamento). Se o cliente ainda não disse se paga no Pix ou no cartão (e em quantas vezes), pergunte antes; não suponha. Se der erro de horário, consulte a agenda de novo e ofereça outro.",
      input_schema: {
        type: "object",
        properties: {
          data: { type: "string", description: "Dia, no formato AAAA-MM-DD." },
          hora: {
            type: "string",
            description: "Horário de chegada, HH:MM (como em consultar_agenda).",
          },
          tecnico: {
            type: "string",
            description: "Técnico do horário (como em consultar_agenda).",
          },
          orcamentos: {
            type: "array",
            items: { type: "string" },
            description:
              "Nº dos orçamentos aprovados (o nº que criar_orcamento devolveu). Se o cliente fechou higienização e impermeabilização, informe os dois. Sem isso, vale o orçamento mais recente.",
          },
          pagamento: {
            type: "string",
            enum: ["pix", "cartao"],
            description: "Forma de pagamento combinada.",
          },
          parcelas: {
            type: "integer",
            minimum: 1,
            maximum: 24,
            description: "Parcelas no cartão.",
          },
          nome_completo: { type: "string" },
          cpf_cnpj: { type: "string" },
          email: { type: "string" },
          cep: { type: "string" },
          rua: { type: "string", description: "Só se o cliente informou (o CEP completa)." },
          numero: { type: "string" },
          complemento: { type: "string" },
          bairro: { type: "string" },
          cidade: { type: "string" },
          uf: { type: "string" },
          ponto_referencia: { type: "string" },
          observacoes: {
            type: "string",
            description: "Algo que o técnico precise saber (pet, mancha, acesso, portaria).",
          },
        },
        required: ["data", "hora", "pagamento", "nome_completo", "cep", "numero"],
        additionalProperties: false,
      },
    });
    lista.push({
      name: "gerar_ordem_servico",
      description:
        "Gera o documento da OS reservada nesta conversa e manda ao cliente em PDF, junto da sua próxima mensagem. Use logo depois de reservar_horario, antes da confirmação final.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    });
  }
  lista.push(
    {
      name: "agendar_followup",
      description: `Agenda o próximo toque para quando o cliente parar de responder (substitui o follow-up pendente desta conversa). Informe em_minutos OU data_hora (AAAA-MM-DDTHH:MM, horário de Brasília). Toques fora das ${cfg.hora_inicio}h–${cfg.hora_fim}h vão para o início do próximo horário permitido. Depois de 24 h da última mensagem do cliente, o WhatsApp não permite texto livre: o toque vira tarefa para a equipe.`,
      input_schema: {
        type: "object",
        properties: {
          em_minutos: { type: "integer", minimum: 5, description: "Daqui a quantos minutos." },
          data_hora: { type: "string", description: "Data e hora exatas (AAAA-MM-DDTHH:MM)." },
          trilha: {
            type: "string",
            enum: ["A", "B", "C"],
            description:
              "A: sumiu depois do orçamento; B: sumiu antes do orçamento; C: esperando um evento.",
          },
          motivo: {
            type: "string",
            description: "Por que o toque (ex.: 'sem resposta ao orçamento').",
          },
          mensagem_sugerida: {
            type: "string",
            description: "O que dizer no toque (você reescreve na hora, com o contexto).",
          },
        },
        required: ["trilha", "motivo", "mensagem_sugerida"],
        additionalProperties: false,
      },
    },
    {
      name: "registrar_motivo_perda",
      description:
        "Marca o lead como perdido com um motivo da lista (quando o cliente disser que não quer). Se o cliente adiou com data, informe data_retorno: a equipe recebe uma repescagem nesse dia.",
      input_schema: {
        type: "object",
        properties: {
          motivo: { type: "string", enum: [...MOTIVOS_PERDA] },
          detalhe: { type: "string", description: "O que o cliente disse, em poucas palavras." },
          data_retorno: { type: "string", description: "AAAA-MM-DD (só para 'Adiou')." },
        },
        required: ["motivo"],
        additionalProperties: false,
      },
    },
    {
      name: "atualizar_etapa",
      description: "Move o lead de etapa no CRM.",
      input_schema: {
        type: "object",
        properties: {
          etapa: { type: "string", enum: etapas.length ? etapas : ["Em atendimento"] },
          observacao: { type: "string" },
        },
        required: ["etapa"],
        additionalProperties: false,
      },
    },
    {
      name: "transferir_para_humano",
      description:
        "Passa a conversa para a equipe (motivo obrigatório) e pausa você nesta conversa. Escreva ao cliente a frase de aviso (se as instruções pedirem) no texto da resposta.",
      input_schema: {
        type: "object",
        properties: {
          motivo: {
            type: "string",
            description:
              "Ex.: 'pediu desconto', 'combo', 'item fora da tabela', 'upsell', 'áudio validade'.",
          },
          resumo: {
            type: "string",
            description:
              "Para a equipe: o que o cliente quer, estofados, valores passados, dores e próximo passo.",
          },
          problema_pos_venda: {
            type: "boolean",
            description:
              "true quando o cliente reclamou de um serviço já feito (resposta ao pós-venda ou qualquer queixa do serviço): passa com prioridade e marca o cliente como sem pós-venda.",
          },
        },
        required: ["motivo", "resumo"],
        additionalProperties: false,
      },
    },
  );
  return lista;
}

// ---------------------------------------------------------------- implementações

async function lerLead(ctx: ContextoFerramenta) {
  if (!ctx.leadId) return null;
  const { data } = await ctx.admin
    .from("crm_leads")
    .select("id, lead_name, phone, notes, status_id, customer_id, loss_reason_id")
    .eq("id", ctx.leadId)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  return data;
}

async function atualizarLead(ctx: ContextoFerramenta, input: z.infer<typeof AtualizarLead>) {
  const lead = await lerLead(ctx);
  if (!lead) return "Sem lead vinculado a esta conversa; nada foi gravado.";
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
    .eq("id", lead.id)
    .eq("empresa_id", ctx.empresaId);
  return error ? `Não foi possível gravar: ${error.message}` : "Dados gravados.";
}

async function consultarCliente(ctx: ContextoFerramenta) {
  const lead = await lerLead(ctx);
  const { data: contato } = ctx.contatoId
    ? await ctx.admin
        .from("whatsapp_contacts")
        .select("profile_name, ia_desligada, sem_pos_venda, current_customer_id")
        .eq("id", ctx.contatoId)
        .eq("empresa_id", ctx.empresaId)
        .maybeSingle()
    : { data: null };
  const clienteId = lead?.customer_id ?? contato?.current_customer_id ?? null;
  const linhas: string[] = [
    `IA desligada: ${contato?.ia_desligada ? "SIM" : "não"}; sem pós-venda: ${contato?.sem_pos_venda ? "SIM" : "não"}.`,
  ];
  if (contato?.profile_name) linhas.push(`Nome no perfil do WhatsApp: ${contato.profile_name}.`);
  if (lead) linhas.push(`Nome no CRM: ${lead.lead_name}.`);

  if (clienteId) {
    const [{ data: cli }, { data: oss }] = await Promise.all([
      ctx.admin
        .from("customers")
        .select("full_name, neighborhood, city, postal_code")
        .eq("id", clienteId)
        .eq("empresa_id", ctx.empresaId)
        .maybeSingle(),
      ctx.admin
        .from("work_orders")
        .select("os_number, sale_date, status, total_gross_value")
        .eq("customer_id", clienteId)
        .eq("empresa_id", ctx.empresaId)
        .is("deleted_at", null)
        .order("sale_date", { ascending: false })
        .limit(5),
    ]);
    if (cli) {
      linhas.push(
        `Já é cliente: ${cli.full_name}${cli.neighborhood ? `, ${cli.neighborhood}` : ""}${cli.city ? ` (${cli.city})` : ""}${cli.postal_code ? `, CEP ${cli.postal_code}` : ""}.`,
      );
    }
    if (oss?.length) {
      linhas.push(
        "Serviços anteriores: " +
          oss
            .map(
              (o) =>
                `OS ${o.os_number} em ${o.sale_date} (${o.status}, ${reais(Number(o.total_gross_value))})`,
            )
            .join("; ") +
          ".",
      );
    }
  } else {
    linhas.push("Ainda não é cliente (nenhum serviço no sistema).");
  }

  if (lead) {
    const [{ data: orcs }, { data: rets }] = await Promise.all([
      ctx.admin
        .from("quotes")
        .select("total, valor_a_vista, status, created_at")
        .eq("crm_lead_id", lead.id)
        .eq("empresa_id", ctx.empresaId)
        .order("created_at", { ascending: false })
        .limit(3),
      ctx.admin
        .from("crm_followups")
        .select("scheduled_at, responsavel, notes")
        .eq("crm_lead_id", lead.id)
        .eq("empresa_id", ctx.empresaId)
        .eq("status", "Pendente")
        .order("scheduled_at")
        .limit(3),
    ]);
    if (orcs?.length) {
      linhas.push(
        "Orçamentos deste atendimento: " +
          orcs
            .map(
              (q) =>
                `${reais(Number(q.total))}${q.valor_a_vista ? ` (Pix ${reais(Number(q.valor_a_vista))})` : ""}, ${q.status}, criado ${dataHoraTexto(new Date(q.created_at))}`,
            )
            .join("; ") +
          ".",
      );
    }
    if (rets?.length) {
      linhas.push(
        "Retornos pendentes: " +
          rets
            .map(
              (r) =>
                `${dataHoraTexto(new Date(r.scheduled_at))} (${r.responsavel === "alice" ? "Alice" : "equipe"})`,
            )
            .join("; ") +
          ".",
      );
    }
  }
  linhas.push(...textoMarketing(await lerMarketing(ctx)));
  return linhas.join("\n");
}

async function consultarCep(ctx: ContextoFerramenta, input: z.infer<typeof ConsultarCep>) {
  const { estimateKmByCep } = await import("@/lib/quotes.server");
  const r = await estimateKmByCep(ctx.admin, input.cep, ctx.empresaId);
  if (!r.endereco && r.km === null) {
    return `CEP ${r.cep}: ${r.aviso ?? "não encontrado"}. Confirme o CEP com o cliente.`;
  }
  const linhas = [`CEP ${r.cep}: ${r.endereco ?? "endereço não encontrado"}.`];
  if (r.km === null) {
    linhas.push(`Distância: não calculada (${r.aviso ?? "sem base cadastrada"}).`);
    linhas.push("Área atendida: não foi possível verificar; siga o atendimento normalmente.");
    return linhas.join("\n");
  }
  const ida = Math.round((r.km / 2) * 10) / 10;
  linhas.push(
    `Distância até a base: ~${ida} km (${r.metodo === "ruas" ? "pelas ruas" : "aproximada, em linha reta"}).`,
  );
  const raio = ctx.cfg.raio_km === null ? null : Number(ctx.cfg.raio_km);
  linhas.push(
    raio === null
      ? "Área atendida: sem limite de distância configurado (dentro da área)."
      : ida <= raio
        ? `Área atendida: DENTRO (limite de ${raio} km).`
        : `Área atendida: FORA (limite de ${raio} km). Transfira para a equipe.`,
  );
  return linhas.join("\n");
}

async function tabela(ctx: ContextoFerramenta): Promise<ItemTabela[]> {
  const { data } = await ctx.admin
    .from("tabela_precos_itens")
    .select("id, nome, preco_higienizacao, preco_impermeabilizacao")
    .eq("empresa_id", ctx.empresaId)
    .eq("ativo", true)
    .order("ordem");
  return (data ?? []) as ItemTabela[];
}

async function consultarTabela(ctx: ContextoFerramenta, input: z.infer<typeof ConsultarTabela>) {
  const itens = await tabela(ctx);
  if (!itens.length) return "Tabela de preços não cadastrada. Não informe valores; transfira.";
  const servicos: Servico[] = input.servico
    ? [input.servico]
    : ["higienizacao", "impermeabilizacao"];
  const { regrasOrcamento } = await import("@/lib/quotes.server");
  const regras = await regrasOrcamento(ctx.admin, ctx.empresaId);
  const texto = servicos
    .map((s) => {
      const linhas = itens
        .map((i) =>
          precificar(
            {
              item: i,
              quantidade: 1,
              classe: input.classe,
              almofadas_soltas: input.almofadas_soltas,
              muito_encardido: input.muito_encardido,
            },
            s,
            regras,
          ),
        )
        .filter((l): l is NonNullable<typeof l> => l !== null)
        .map((l) => `- ${l.item.nome}: ${reais(l.preco)}`);
      return `${s === "higienizacao" ? "Higienização" : "Impermeabilização"}:\n${linhas.join("\n") || "(nenhum item)"}`;
    })
    .join("\n\n");
  const rotulos = rotulosAcrescimo(regras, {
    classe: input.classe ?? null,
    almofadasSoltas: Boolean(input.almofadas_soltas),
    muitoEncardido: Boolean(input.muito_encardido),
  });
  return rotulos.length
    ? `Preços já com ${rotulos.join(" + ")} (arredondados para o real de cima):\n\n${texto}`
    : texto;
}

async function criarOrcamento(ctx: ContextoFerramenta, input: z.infer<typeof CriarOrcamento>) {
  const itens = await tabela(ctx);
  const porNome = new Map(itens.map((i) => [normalizarNome(i.nome), i]));
  const { regrasOrcamento } = await import("@/lib/quotes.server");
  const regras = await regrasOrcamento(ctx.admin, ctx.empresaId);
  const escolhidos: LinhaOrcamento[] = [];
  for (const pedido of input.itens) {
    const item = porNome.get(normalizarNome(pedido.item));
    if (!item) {
      return {
        erro: true,
        texto: `Item "${pedido.item}" não está na tabela. Itens válidos: ${itens.map((i) => i.nome).join("; ")}. Se nenhum servir, transfira para a equipe.`,
      };
    }
    // Preço só pelas regras: tabela + classe/acréscimos da empresa (a Alice não informa valor).
    const linha = precificar(
      {
        item,
        quantidade: pedido.quantidade,
        classe: pedido.classe,
        almofadas_soltas: pedido.almofadas_soltas,
        muito_encardido: pedido.muito_encardido,
      },
      input.servico,
      regras,
    );
    if (linha === null) {
      return {
        erro: true,
        texto: `"${item.nome}" não tem preço de ${input.servico === "higienizacao" ? "higienização" : "impermeabilização"} na tabela (não oferecemos esse serviço para esse item).`,
      };
    }
    escolhidos.push(linha);
  }

  const lead = await lerLead(ctx);
  // Desconto de campanha ou de indicação: linha separada; o Pix vale sobre o total com desconto.
  let regraDesconto: { pct: number; rotulo: string } | null = null;
  if (input.desconto) {
    const d = descontoPermitido(await lerMarketing(ctx), input.desconto);
    if ("erro" in d) return { erro: true, texto: `${d.erro} Refaça sem desconto.` };
    regraDesconto = d;
  }
  const { bruto, desconto, cond } = totalizar(
    escolhidos,
    regraDesconto,
    ctx.cfg.parcelas_max,
    Number(ctx.cfg.desconto_pix_percentual),
  );
  const val = validade(ctx.agora, ctx.cfg.validade_orcamento_dias);

  let km = 0;
  let endereco: string | null = null;
  const cep = input.cep?.replace(/\D/g, "") || null;
  if (cep?.length === 8) {
    const { estimateKmByCep } = await import("@/lib/quotes.server");
    const r = await estimateKmByCep(ctx.admin, cep, ctx.empresaId).catch(() => null);
    km = r?.km ?? 0;
    endereco = r?.endereco ?? null;
  }

  const { saveQuote } = await import("@/lib/quotes.server");
  const salvo = await saveQuote(
    ctx.admin,
    {
      cliente_nome: lead?.lead_name?.trim() || "Cliente do WhatsApp",
      cliente_telefone: lead?.phone ?? null,
      cliente_cep: cep,
      cliente_endereco: endereco,
      customer_id: lead?.customer_id ?? null,
      data_servico: null,
      observacoes: `Criado pela ${ctx.cfg.nome} (IA)${input.rotulo ? ` — ${input.rotulo}` : ""}.${desconto ? ` ${desconto.rotulo}: ${desconto.pct}% (${reais(desconto.valor)}).` : ""} Válido até ${val.texto}. Cartão: ${cond.parcelas}x de ${reais(cond.parcela)}; Pix: ${reais(cond.pix)}.`,
      desconto: desconto?.valor ?? 0,
      desconto_tipo: desconto ? (input.desconto ?? null) : null,
      desconto_pct: desconto?.pct ?? null,
      valor_a_vista: cond.pix,
      km_ida_volta: km,
      custo_produtos: 0,
      custo_mao_obra: 0,
      forma_pagamento: null,
      parcelas: cond.parcelas,
      taxa_percentual: 0,
      crm_lead_id: lead?.id ?? null,
      status: "enviado",
      items: escolhidos.map((e) => ({
        tabela_preco_item_id: e.item.id,
        nome_snapshot: e.item.nome,
        tipo_servico: input.servico,
        preco_tabela: e.precoTabela,
        preco_sugerido: e.preco,
        preco_aplicado: e.preco,
        motivo_desconto: null,
        quantidade: e.quantidade,
        classe: e.classe,
        almofadas_soltas: e.almofadasSoltas,
        muito_encardido: e.muitoEncardido,
      })),
    },
    null,
    ctx.empresaId,
  );

  const linhas = escolhidos.map(
    (e) =>
      `• ${e.quantidade > 1 ? `${e.quantidade}x ` : ""}${e.item.nome} — ${reais(e.preco * e.quantidade)}${e.rotulos.length ? ` (${e.rotulos.join(" + ")})` : ""}`,
  );
  return {
    erro: false,
    texto: [
      `Orçamento criado no sistema${input.rotulo ? ` (${input.rotulo})` : ""} — nº ${String(salvo.id).slice(0, 8)}. Use exatamente estes valores:`,
      `Serviço: ${input.servico === "higienizacao" ? "Higienização" : "Impermeabilização"}`,
      ...linhas,
      ...(desconto
        ? [
            `Subtotal: ${reais(bruto)}`,
            `${desconto.rotulo} (${desconto.pct}%): -${reais(desconto.valor)}`,
          ]
        : []),
      `Total${desconto ? " com desconto" : ""}: ${reais(cond.total)}`,
      `Cartão: ${cond.parcelas}x de ${reais(cond.parcela)} sem juros`,
      `Pix (${cond.descontoPixPercentual}% off): ${reais(cond.pix)}`,
      `Válido até ${val.texto}`,
    ].join("\n"),
  };
}

function enviarMidia(ctx: ContextoFerramenta, tipo: "video" | "audio", servico: Servico) {
  const caminho =
    tipo === "video"
      ? servico === "higienizacao"
        ? ctx.cfg.video_higienizacao
        : ctx.cfg.video_impermeabilizacao
      : servico === "higienizacao"
        ? ctx.cfg.audio_higienizacao
        : ctx.cfg.audio_impermeabilizacao;
  if (!caminho) {
    return {
      erro: true,
      texto: `Não há ${tipo === "video" ? "vídeo" : "áudio"} cadastrado para esse serviço. Siga sem ele (por texto).`,
    };
  }
  ctx.saida.push({ tipo: "anexo", caminho, nome: caminho.split("/").pop() || `${tipo}` });
  return {
    erro: false,
    texto: `${tipo === "video" ? "Vídeo" : "Áudio"} será enviado neste ponto da conversa. Não diga que "segue abaixo"; continue normalmente.`,
  };
}

/** Foto (anexo) e nome do técnico; nunca diz ao cliente quantos técnicos a empresa tem. */
async function enviarDadosTecnico(ctx: ContextoFerramenta, input: z.infer<typeof DadosTecnico>) {
  const { data } = await ctx.admin
    .from("technicians")
    .select("id, name, foto_path")
    .eq("empresa_id", ctx.empresaId)
    .eq("active", true)
    .order("display_order");
  const tecnicos = data ?? [];
  const norm = (t: string) =>
    t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  const pedido = input.tecnico ? norm(input.tecnico) : "";
  const achado = pedido
    ? (tecnicos.find((t) => norm(t.name) === pedido) ??
      tecnicos.find((t) => norm(t.name).includes(pedido) || pedido.includes(norm(t.name))))
    : tecnicos.length === 1
      ? tecnicos[0]
      : undefined;
  if (!achado) {
    return {
      erro: true,
      texto: tecnicos.length
        ? `Informe o técnico do horário oferecido. Técnicos: ${tecnicos.map((t) => t.name).join(", ")}.`
        : "Não há técnico ativo cadastrado. Siga sem a foto.",
    };
  }
  if (!achado.foto_path) {
    return {
      erro: false,
      texto: `Técnico: ${achado.name}. Ainda não há foto cadastrada: diga só o nome, sem prometer foto.`,
    };
  }
  ctx.saida.push({
    tipo: "anexo",
    caminho: achado.foto_path,
    nome: `${achado.name}.${achado.foto_path.split(".").pop() || "jpg"}`,
    pasta: "equipe-fotos",
    semEspera: true,
  });
  return {
    erro: false,
    texto: `Técnico: ${achado.name}. A foto dele vai junto, neste ponto da conversa. Escreva a mensagem com o nome dele (não diga "segue abaixo").`,
  };
}

async function consultarAgenda(ctx: ContextoFerramenta, input: z.infer<typeof ConsultarAgenda>) {
  const { agendaLivre, textoAgenda } = await import("./agenda");
  const { agoraSP, carregarAgenda } = await import("./agendamento.server");
  const periodo = input.periodo ?? "qualquer";
  const ate = new Date(
    new Date(`${input.data_inicial}T12:00:00Z`).getTime() + (input.dias - 1) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const agenda = await carregarAgenda(ctx, input.data_inicial, ate);
  if ("erro" in agenda) return `Não foi possível consultar a agenda: ${agenda.erro}`;
  let cliente: { lat: number; lon: number } | null = null;
  if (input.cep) {
    const { coordenadasDoCep } = await import("@/lib/quotes.server");
    cliente = await coordenadasDoCep(input.cep).catch(() => null);
  }
  const dias = agendaLivre({
    inicio: input.data_inicial,
    dias: input.dias,
    base: agenda.horarios,
    ocupacoes: agenda.ocupacoes,
    periodo,
    agora: agoraSP(),
    cliente,
  });
  const texto = textoAgenda(agenda.horarios, dias, periodo);
  return input.cep && !cliente
    ? `${texto}\n(Não consegui localizar o CEP ${input.cep}; a prioridade por proximidade não foi calculada.)`
    : texto;
}

/** Cancela o follow-up pendente da conversa (o novo substitui). */
export async function cancelarFollowupPendente(
  admin: Admin,
  empresaId: string,
  conversaId: string,
  motivo: string,
) {
  const { data: pend } = await admin
    .from("ia_tarefas")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("tipo", "followup")
    .eq("situacao", "pendente");
  const ids = (pend ?? []).map((p) => p.id);
  if (!ids.length) return;
  const agora = new Date().toISOString();
  await admin
    .from("ia_tarefas")
    .update({ situacao: "ignorada", motivo, concluida_em: agora })
    .in("id", ids)
    .eq("situacao", "pendente");
  await admin
    .from("crm_followups")
    .update({ status: "Cancelada", completed_at: agora, result: motivo })
    .eq("empresa_id", empresaId)
    .in("ia_tarefa_id", ids)
    .eq("status", "Pendente");
}

async function agendarFollowup(ctx: ContextoFerramenta, input: z.infer<typeof AgendarFollowup>) {
  if (!ctx.leadId) return { erro: true, texto: "Sem lead nesta conversa; não dá para agendar." };
  let quando: Date | null =
    input.em_minutos !== undefined
      ? new Date(ctx.agora.getTime() + input.em_minutos * 60_000)
      : lerDataHoraLocal(input.data_hora ?? "");
  if (!quando) return { erro: true, texto: "data_hora inválida; use AAAA-MM-DDTHH:MM." };
  if (quando.getTime() < ctx.agora.getTime() + 4 * 60_000) {
    return { erro: true, texto: "O follow-up precisa ser pelo menos 5 minutos no futuro." };
  }
  quando = proximoHorarioPermitido(quando, ctx.cfg.hora_inicio, ctx.cfg.hora_fim);
  const daAlice = dentroDaJanela(ctx.ultimaDoCliente, quando);

  await cancelarFollowupPendente(
    ctx.admin,
    ctx.empresaId,
    ctx.conversaId,
    "substituído por um novo follow-up",
  );

  let tarefaId: string | null = null;
  if (daAlice) {
    const { data: t, error } = await ctx.admin
      .from("ia_tarefas")
      .insert({
        empresa_id: ctx.empresaId,
        conversa_id: ctx.conversaId,
        tipo: "followup",
        executar_apos: quando.toISOString(),
        motivo: input.motivo,
        dados: {
          trilha: input.trilha,
          motivo: input.motivo,
          mensagem_sugerida: input.mensagem_sugerida,
        },
      })
      .select("id")
      .single();
    if (error) return { erro: true, texto: `Não foi possível agendar: ${error.message}` };
    tarefaId = t.id;
    ctx.agendouFollowup = true;
  }
  const notas = daAlice
    ? `🤖 Follow-up da ${ctx.cfg.nome} (trilha ${input.trilha}): ${input.motivo}. Sugestão: ${input.mensagem_sugerida}`
    : `🤖 ${ctx.cfg.nome}: toque fora da janela de 24 h do WhatsApp (precisa de modelo aprovado ou ligação). Trilha ${input.trilha}: ${input.motivo}. Sugestão: ${input.mensagem_sugerida}`;
  const { error: errFollow } = await ctx.admin.from("crm_followups").insert({
    empresa_id: ctx.empresaId,
    crm_lead_id: ctx.leadId,
    scheduled_at: quando.toISOString(),
    responsavel: daAlice ? "alice" : "equipe",
    ia_tarefa_id: tarefaId,
    notes: notas,
  });
  if (errFollow) return { erro: true, texto: `Não foi possível agendar: ${errFollow.message}` };
  await ctx.admin
    .from("crm_leads")
    .update({ next_follow_up_at: quando.toISOString() })
    .eq("id", ctx.leadId)
    .eq("empresa_id", ctx.empresaId);
  return {
    erro: false,
    texto: daAlice
      ? `Follow-up agendado para ${dataHoraTexto(quando)}. Se o cliente responder antes, ele é cancelado.`
      : `Fica fora da janela de 24 h do WhatsApp: o toque de ${dataHoraTexto(quando)} ficou como tarefa para a equipe.`,
  };
}

async function opcaoPorNome(
  ctx: ContextoFerramenta,
  kind: string,
  nomes: string[],
): Promise<{ id: string; name: string; metadata: unknown } | null> {
  const { data } = await ctx.admin
    .from("config_options")
    .select("id, name, metadata, display_order")
    .eq("empresa_id", ctx.empresaId)
    .eq("kind", kind)
    .eq("active", true)
    .order("display_order");
  const alvo = nomes.map(normalizarNome);
  for (const n of alvo) {
    const achou = (data ?? []).find((o) => normalizarNome(o.name) === n);
    if (achou) return achou;
  }
  return null;
}

async function mudarStatus(
  ctx: ContextoFerramenta,
  lead: NonNullable<Awaited<ReturnType<typeof lerLead>>>,
  novo: { id: string; name: string; metadata: unknown },
  patch: Database["public"]["Tables"]["crm_leads"]["Update"],
  notas: string | null,
) {
  const { data: anterior } = lead.status_id
    ? await ctx.admin
        .from("config_options")
        .select("name")
        .eq("id", lead.status_id)
        .eq("empresa_id", ctx.empresaId)
        .maybeSingle()
    : { data: null };
  const meta = (novo.metadata ?? {}) as { closed?: boolean };
  const agora = new Date().toISOString();
  const { error } = await ctx.admin
    .from("crm_leads")
    .update({
      status_id: novo.id,
      is_open: meta.closed !== true,
      closed_at: meta.closed === true ? agora : null,
      last_interaction_at: agora,
      ...patch,
    })
    .eq("id", lead.id)
    .eq("empresa_id", ctx.empresaId);
  if (error) throw error;
  await ctx.admin.from("crm_status_history").insert({
    empresa_id: ctx.empresaId,
    crm_lead_id: lead.id,
    previous_status_id: lead.status_id,
    new_status_id: novo.id,
    previous_status_name: anterior?.name ?? null,
    new_status_name: novo.name,
    change_source: ctx.cfg.nome,
    notes: notas,
  });
}

async function atualizarEtapa(ctx: ContextoFerramenta, input: z.infer<typeof AtualizarEtapa>) {
  const lead = await lerLead(ctx);
  if (!lead) return { erro: true, texto: "Sem lead nesta conversa." };
  if (!ctx.etapas.includes(input.etapa)) {
    return { erro: true, texto: `Etapa inválida. Use: ${ctx.etapas.join("; ")}.` };
  }
  const status = await opcaoPorNome(ctx, "crm_status", [input.etapa]);
  if (!status) return { erro: true, texto: "Etapa não encontrada no CRM." };
  if (status.id === lead.status_id) return { erro: false, texto: "O lead já está nessa etapa." };
  await mudarStatus(ctx, lead, status, {}, input.observacao ?? null);
  return { erro: false, texto: `Lead movido para "${status.name}".` };
}

async function registrarPerda(ctx: ContextoFerramenta, input: z.infer<typeof RegistrarPerda>) {
  const lead = await lerLead(ctx);
  if (!lead) return { erro: true, texto: "Sem lead nesta conversa." };
  const motivo = input.motivo as MotivoPerda;
  let razao = await opcaoPorNome(ctx, "crm_loss_reason", SINONIMOS_PERDA[motivo]);
  if (!razao) {
    const { data: criada, error } = await ctx.admin
      .from("config_options")
      .insert({
        empresa_id: ctx.empresaId,
        kind: "crm_loss_reason",
        name: motivo,
        display_order: 90,
      })
      .select("id, name, metadata")
      .single();
    if (error) return { erro: true, texto: `Não foi possível registrar: ${error.message}` };
    razao = criada;
  }
  const { data: statusList } = await ctx.admin
    .from("config_options")
    .select("id, name, metadata")
    .eq("empresa_id", ctx.empresaId)
    .eq("kind", "crm_status")
    .eq("active", true)
    .order("display_order");
  const perdido = (statusList ?? []).find(
    (s) => (s.metadata as { lost?: boolean } | null)?.lost === true,
  );
  const notas = [`Motivo: ${motivo}`, input.detalhe].filter(Boolean).join(" — ");
  if (perdido) {
    await mudarStatus(ctx, lead, perdido, { loss_reason_id: razao.id }, notas);
  } else {
    await ctx.admin
      .from("crm_leads")
      .update({ loss_reason_id: razao.id, is_open: false, closed_at: new Date().toISOString() })
      .eq("id", lead.id)
      .eq("empresa_id", ctx.empresaId);
  }
  await cancelarFollowupPendente(
    ctx.admin,
    ctx.empresaId,
    ctx.conversaId,
    `lead perdido: ${motivo}`,
  );

  if (input.data_retorno) {
    const quando = lerDataHoraLocal(input.data_retorno);
    if (quando) {
      await ctx.admin.from("crm_followups").insert({
        empresa_id: ctx.empresaId,
        crm_lead_id: lead.id,
        scheduled_at: quando.toISOString(),
        responsavel: "equipe",
        notes: `🤖 ${ctx.cfg.nome}: cliente adiou${input.detalhe ? ` (${input.detalhe})` : ""}. Retomar o contato.`,
      });
      await ctx.admin
        .from("crm_leads")
        .update({ next_follow_up_at: quando.toISOString() })
        .eq("id", lead.id)
        .eq("empresa_id", ctx.empresaId);
    }
  }
  return {
    erro: false,
    texto: `Lead marcado como perdido (${razao.name}).${input.data_retorno ? " Retorno agendado para a equipe." : ""} Agradeça ao cliente com gentileza.`,
  };
}

// ---------------------------------------------------------------- despacho
export async function executarFerramenta(
  ctx: ContextoFerramenta,
  nome: string,
  entrada: unknown,
): Promise<{ conteudo: string; erro: boolean }> {
  const invalida = (e: z.ZodError) => ({ conteudo: `Entrada inválida: ${e.message}`, erro: true });
  const r = (v: { erro: boolean; texto: string }) => ({ conteudo: v.texto, erro: v.erro });
  try {
    switch (nome) {
      case "atualizar_lead": {
        const p = AtualizarLead.safeParse(entrada);
        return p.success
          ? { conteudo: await atualizarLead(ctx, p.data), erro: false }
          : invalida(p.error);
      }
      case "consultar_cliente":
        return { conteudo: await consultarCliente(ctx), erro: false };
      case "consultar_cep": {
        const p = ConsultarCep.safeParse(entrada);
        return p.success
          ? { conteudo: await consultarCep(ctx, p.data), erro: false }
          : invalida(p.error);
      }
      case "consultar_tabela_precos": {
        const p = ConsultarTabela.safeParse(entrada ?? {});
        return p.success
          ? { conteudo: await consultarTabela(ctx, p.data), erro: false }
          : invalida(p.error);
      }
      case "criar_orcamento": {
        const p = CriarOrcamento.safeParse(entrada);
        return p.success ? r(await criarOrcamento(ctx, p.data)) : invalida(p.error);
      }
      case "registrar_indicacao": {
        const p = RegistrarIndicacao.safeParse(entrada);
        return p.success ? r(await registrarIndicacao(ctx, p.data)) : invalida(p.error);
      }
      case "enviar_mensagem": {
        const p = EnviarMensagem.safeParse(entrada);
        if (!p.success) return invalida(p.error);
        ctx.saida.push({ tipo: "texto", texto: p.data.texto, bloco: true });
        return { conteudo: "Mensagem será enviada neste ponto da conversa.", erro: false };
      }
      case "enviar_video":
      case "enviar_audio_padrao": {
        const p = EnviarMidia.safeParse(entrada);
        return p.success
          ? r(enviarMidia(ctx, nome === "enviar_video" ? "video" : "audio", p.data.servico))
          : invalida(p.error);
      }
      case "enviar_dados_tecnico": {
        if (!ctx.cfg.agenda_automatica) return { conteudo: "Agenda não liberada.", erro: true };
        const p = DadosTecnico.safeParse(entrada);
        return p.success ? r(await enviarDadosTecnico(ctx, p.data)) : invalida(p.error);
      }
      case "reservar_horario": {
        if (!ctx.cfg.agenda_automatica) return { conteudo: "Agenda não liberada.", erro: true };
        const { ReservarHorario, reservarHorario } = await import("./agendamento.server");
        const p = ReservarHorario.safeParse(entrada);
        return p.success ? r(await reservarHorario(ctx, p.data)) : invalida(p.error);
      }
      case "gerar_ordem_servico": {
        if (!ctx.cfg.agenda_automatica) return { conteudo: "Agenda não liberada.", erro: true };
        const { gerarOrdemServico } = await import("./agendamento.server");
        return r(await gerarOrdemServico(ctx));
      }
      case "consultar_agenda": {
        if (!ctx.cfg.agenda_automatica) return { conteudo: "Agenda não liberada.", erro: true };
        const p = ConsultarAgenda.safeParse(entrada);
        return p.success
          ? { conteudo: await consultarAgenda(ctx, p.data), erro: false }
          : invalida(p.error);
      }
      case "agendar_followup": {
        const p = AgendarFollowup.safeParse(entrada);
        return p.success ? r(await agendarFollowup(ctx, p.data)) : invalida(p.error);
      }
      case "registrar_motivo_perda": {
        const p = RegistrarPerda.safeParse(entrada);
        return p.success ? r(await registrarPerda(ctx, p.data)) : invalida(p.error);
      }
      case "atualizar_etapa": {
        const p = AtualizarEtapa.safeParse(entrada);
        return p.success ? r(await atualizarEtapa(ctx, p.data)) : invalida(p.error);
      }
      case "transferir_para_humano": {
        const p = Transferir.safeParse(entrada);
        if (!p.success) return invalida(p.error);
        if (p.data.problema_pos_venda) await registrarProblemaPosVenda(ctx, p.data.resumo);
        ctx.passagem = {
          motivo: p.data.problema_pos_venda
            ? `⚠️ PRIORIDADE (problema no pós-venda): ${p.data.motivo}`
            : p.data.motivo,
          resumo: p.data.resumo,
        };
        return {
          conteudo:
            "Transferência registrada: a equipe assume depois desta resposta. Se as instruções pedirem, avise o cliente numa frase curta; senão, não escreva nada.",
          erro: false,
        };
      }
      default:
        return { conteudo: `Ferramenta desconhecida: ${nome}`, erro: true };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Alice: erro na ferramenta", nome, msg);
    return {
      conteudo: `A ferramenta falhou (${msg.slice(0, 200)}). Siga sem ela ou transfira.`,
      erro: true,
    };
  }
}
