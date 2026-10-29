/**
 * Gerente comercial: analisa um lead (só leitura da conversa). Junta os dados do banco (conversa,
 * orçamentos, OS, pagamentos e follow-ups), transcreve os áudios da equipe que ainda não têm texto
 * (gravado em whatsapp_messages.transcricao, como os do cliente), calcula os fatos sem IA e pede a
 * ficha ao Sonnet. Grava a ficha, os tokens e o custo em comercial_analises. Nada é enviado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcularFatos,
  conversaEmTexto,
  type EntradaFatos,
  type FollowupLead,
  type MensagemLead,
  type OrcamentoLead,
} from "./fatos";
import {
  ESQUEMA_FICHA,
  MODELO_FICHA,
  custoUsd,
  idDoMotivo,
  instrucoesFicha,
  lerFicha,
  mascararNome,
  mensagemProibida,
  pedidoDaFicha,
  type Uso,
} from "./ficha";

type Db = SupabaseClient;

type Contexto = {
  empresaNome: string;
  pixPct: number | null;
  motivos: Array<{ id: string; nome: string }>;
};

/** Nome da empresa, Pix e motivos de perda (os mesmos para todos os leads do lote). */
export async function contextoDaEmpresa(db: Db, empresaId: string): Promise<Contexto> {
  const [{ data: emp }, { data: orc }, { data: motivos }] = await Promise.all([
    db.from("empresas").select("nome").eq("id", empresaId).maybeSingle(),
    db.from("orcamento_configuracoes").select("pix_pct").eq("empresa_id", empresaId).maybeSingle(),
    db
      .from("config_options")
      .select("id, name, display_order, metadata")
      .eq("empresa_id", empresaId)
      .eq("kind", "crm_loss_reason")
      .eq("active", true)
      .order("display_order"),
  ]);
  // Só os motivos do Sem desfecho (os antigos, como "Sem retorno", ficam de fora); empresa sem
  // eles usa todos.
  const todos = (motivos ?? []) as Array<{
    id: string;
    name: string;
    metadata: Record<string, unknown> | null;
  }>;
  const doSemDesfecho = todos.filter((m) => m.metadata?.["sem_desfecho"] === true);
  const vistos = new Set<string>();
  const lista: Contexto["motivos"] = [];
  for (const m of doSemDesfecho.length ? doSemDesfecho : todos) {
    const k = m.name.trim().toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    lista.push({ id: m.id, nome: m.name });
  }
  return {
    empresaNome: (emp as { nome?: string } | null)?.nome ?? "empresa",
    pixPct: (orc as { pix_pct?: number | null } | null)?.pix_pct ?? null,
    motivos: lista,
  };
}

type LinhaMensagem = {
  id: string;
  direction: string;
  remetente_tipo: string | null;
  message_type: string | null;
  text_content: string | null;
  transcricao: string | null;
  transcricao_erro: string | null;
  raw_event_reference: string | null;
  message_timestamp: string;
};

async function mensagensDoLead(
  db: Db,
  empresaId: string,
  leadId: string,
): Promise<LinhaMensagem[]> {
  const { data: convs } = await db
    .from("conversas")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("crm_lead_id", leadId);
  const ids = ((convs ?? []) as Array<{ id: string }>).map((c) => c.id);
  let q = db
    .from("whatsapp_messages")
    .select(
      "id, direction, remetente_tipo, message_type, text_content, transcricao, transcricao_erro, raw_event_reference, message_timestamp",
    )
    .eq("empresa_id", empresaId)
    .eq("privada", false)
    .order("message_timestamp")
    .limit(1500);
  q = ids.length
    ? q.or(`conversa_id.in.(${ids.join(",")}),crm_lead_id.eq.${leadId}`)
    : q.eq("crm_lead_id", leadId);
  const { data } = await q;
  return (data ?? []) as LinhaMensagem[];
}

/** Áudios da equipe sem transcrição: transcreve agora (mesmo caminho dos áudios do cliente). */
async function transcreverEquipe(
  db: Db,
  empresaId: string,
  msgs: LinhaMensagem[],
): Promise<number> {
  const pendentes = msgs.filter(
    (m) =>
      /udio/i.test(m.message_type ?? "") &&
      m.remetente_tipo === "user" &&
      !m.transcricao &&
      !m.transcricao_erro &&
      m.raw_event_reference,
  );
  if (!pendentes.length) return 0;
  const { transcreverMensagens } = await import("@/lib/alice/audios.server");
  const textos = await transcreverMensagens(
    db as never,
    empresaId,
    pendentes.map((m) => ({ id: m.id, raw_event_reference: m.raw_event_reference })),
  );
  for (const m of msgs) {
    const t = textos.get(m.id);
    if (t) m.transcricao = t;
  }
  return textos.size;
}

/** Junta tudo o que o cálculo dos fatos precisa. */
export async function entradaDoLead(
  db: Db,
  empresaId: string,
  leadId: string,
): Promise<{ entrada: EntradaFatos; transcritos: number; nomeCliente: string | null }> {
  const { data: l, error } = await db
    .from("crm_leads")
    .select(
      "id, lead_name, created_at, gclid, gbraid, lp_origem, service_interest, sales_origin_id, orcamento_enviado_em, perdido_em, loss_reason_id, desfecho_obs, realizado_em, os_criada_em, linked_work_order_id",
    )
    .eq("id", leadId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error || !l) throw new Error("lead não encontrado");
  const lead0 = l as Record<string, string | null>;
  const lead = (k: string): string | null => lead0[k] ?? null;

  const [msgs, { data: quotes }, { data: fus }, { data: nomes }] = await Promise.all([
    mensagensDoLead(db, empresaId, leadId),
    db
      .from("quotes")
      .select("id, numero, total, valor_pix, valor_cartao, created_at, generated_work_order_id")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", leadId)
      .order("created_at"),
    db
      .from("crm_followups")
      .select(
        "scheduled_at, status, completed_at, respondido_em, trilha, etapa, canal, responsavel",
      )
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", leadId)
      .order("scheduled_at"),
    db
      .from("config_options")
      .select("id, name")
      .in("id", [lead("sales_origin_id"), lead("loss_reason_id")].filter(Boolean) as string[]),
  ]);
  const transcritos = await transcreverEquipe(db, empresaId, msgs);

  type LinhaQuote = {
    id: string;
    numero: number | null;
    total: number | null;
    valor_pix: number | null;
    valor_cartao: number | null;
    created_at: string;
    generated_work_order_id: string | null;
  };
  const qs = (quotes ?? []) as LinhaQuote[];
  const { data: itens } = qs.length
    ? await db
        .from("quote_items")
        .select("quote_id, tipo_servico, nome_snapshot")
        .in(
          "quote_id",
          qs.map((q) => q.id),
        )
    : { data: [] };
  const servicosDe = (id: string) => [
    ...new Set(
      (
        (itens ?? []) as Array<{
          quote_id: string;
          tipo_servico: string | null;
          nome_snapshot: string | null;
        }>
      )
        .filter((i) => i.quote_id === id)
        .map((i) => [i.tipo_servico, i.nome_snapshot].filter(Boolean).join(": "))
        .filter(Boolean),
    ),
  ];

  const osIds = [
    ...new Set(
      [lead("linked_work_order_id"), ...qs.map((q) => q.generated_work_order_id)].filter(Boolean),
    ),
  ] as string[];
  const { data: oss } = osIds.length
    ? await db
        .from("work_orders")
        .select("id, total_gross_value, cancelled_at, deleted_at, eh_teste")
        .in("id", osIds)
    : { data: [] };
  const validas = (
    (oss ?? []) as Array<{
      id: string;
      total_gross_value: number | null;
      cancelled_at: string | null;
      deleted_at: string | null;
      eh_teste: boolean | null;
    }>
  ).filter((o) => !o.cancelled_at && !o.deleted_at && !o.eh_teste);
  const { data: pags } = validas.length
    ? await db
        .from("payments")
        .select("gross_amount")
        .in(
          "work_order_id",
          validas.map((o) => o.id),
        )
        .eq("is_active", true)
        .eq("payment_status", "Pago")
    : { data: [] };

  const nome = (id: string | null) =>
    ((nomes ?? []) as Array<{ id: string; name: string }>).find((n) => n.id === id)?.name ?? null;
  const vendeu = validas.length > 0 || Boolean(lead("realizado_em"));

  const entrada: EntradaFatos = {
    criadoEm: lead("created_at") as string,
    google: Boolean(lead("gclid") || lead("gbraid") || lead("lp_origem")),
    origem: nome(lead("sales_origin_id")) ?? (lead("lp_origem") ? "Site (LP)" : null),
    servicoInteresse: lead("service_interest"),
    orcamentoEnviadoEm: lead("orcamento_enviado_em"),
    perdidoEm: lead("perdido_em"),
    motivoPerda: nome(lead("loss_reason_id")),
    desfechoObs: lead("desfecho_obs"),
    vendeu: vendeu || (Boolean(lead("os_criada_em")) && osIds.length === 0),
    valorOs: validas.length
      ? validas.reduce((s, o) => s + Number(o.total_gross_value ?? 0), 0)
      : null,
    valorPago: ((pags ?? []) as Array<{ gross_amount: number | null }>).reduce(
      (s, p) => s + Number(p.gross_amount ?? 0),
      0,
    ),
    osCanceladaOuTeste: osIds.length > 0 && validas.length === 0 && !lead("realizado_em"),
    mensagens: msgs.map((m): MensagemLead => ({
      direcao: m.direction === "Recebida" || m.remetente_tipo === "contact" ? "entrada" : "saida",
      remetente: m.remetente_tipo,
      tipo: m.message_type,
      texto: m.text_content,
      transcricao: m.transcricao,
      em: m.message_timestamp,
    })),
    orcamentos: qs.map((q): OrcamentoLead => ({
      numero: q.numero,
      total: q.total,
      valorPix: q.valor_pix,
      valorCartao: q.valor_cartao,
      criadoEm: q.created_at,
      servicos: servicosDe(q.id),
    })),
    followups: (
      (fus ?? []) as Array<{
        scheduled_at: string;
        status: string | null;
        completed_at: string | null;
        respondido_em: string | null;
        trilha: string | null;
        etapa: string | null;
        canal: string | null;
        responsavel: string | null;
      }>
    ).map((f): FollowupLead => ({
      agendadoPara: f.scheduled_at,
      situacao: f.status,
      concluidoEm: f.completed_at,
      respondidoEm: f.respondido_em,
      trilha: f.trilha,
      etapa: f.etapa,
      canal: f.canal,
      responsavel: f.responsavel,
    })),
  };
  return { entrada, transcritos, nomeCliente: lead("lead_name") };
}

export type ResultadoAnalise = {
  ok: boolean;
  custoUsd: number;
  transcritos: number;
  erro?: string;
};

/** Analisa um lead e grava a ficha (uma por lead; analisar de novo substitui). */
export async function analisarLead(
  db: Db,
  o: { empresaId: string; leadId: string; loteId: string | null; contexto: Contexto },
): Promise<ResultadoAnalise> {
  let transcritos = 0;
  let custo = 0;
  try {
    const r = await entradaDoLead(db, o.empresaId, o.leadId);
    transcritos = r.transcritos;
    const fatos = calcularFatos(r.entrada);
    const pedido = pedidoDaFicha({
      fatos,
      motivos: o.contexto.motivos.map((m) => m.nome),
      conversa: conversaEmTexto(r.entrada.mensagens),
    });
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { chamarIa } = await import("@/lib/alice/parada-ia.server");
    const sistema = [
      {
        type: "text" as const,
        text: instrucoesFicha({ empresa: o.contexto.empresaNome, pixPct: o.contexto.pixPct }),
        cache_control: { type: "ephemeral" as const },
      },
    ];
    const uso: Uso = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    const somar = (u: Uso) => {
      uso.input_tokens += u.input_tokens;
      uso.output_tokens += u.output_tokens;
      uso.cache_creation_input_tokens! += u.cache_creation_input_tokens ?? 0;
      uso.cache_read_input_tokens! += u.cache_read_input_tokens ?? 0;
      custo = custoUsd(uso);
    };
    const pedir = (
      messages: import("@anthropic-ai/sdk").default.MessageParam[],
      schema: Record<string, unknown>,
    ) =>
      chamarIa(() =>
        new Anthropic({ timeout: 170_000, maxRetries: 1 }).messages.create({
          model: MODELO_FICHA,
          max_tokens: 16_000,
          output_config: { effort: "medium", format: { type: "json_schema", schema } },
          system: sistema,
          messages,
        }),
      );
    const resp = await pedir(
      [{ role: "user", content: pedido }],
      ESQUEMA_FICHA as unknown as Record<string, unknown>,
    );
    somar(resp.usage);
    if (resp.stop_reason === "refusal") throw new Error("a IA recusou este atendimento");
    if (resp.stop_reason === "max_tokens") throw new Error("resposta cortada (limite de tokens)");
    const json = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const ficha = mascararNome(lerFicha(json), r.nomeCliente, ["mensagem_sugerida"]);
    // Mensagem sugerida com expressão proibida: pede de novo só a mensagem (uma vez).
    const proibida = ficha.mensagem_sugerida ? mensagemProibida(ficha.mensagem_sugerida) : null;
    if (proibida) {
      const r2 = await pedir(
        [
          { role: "user", content: pedido },
          { role: "assistant", content: json },
          {
            role: "user",
            content: `A mensagem_sugerida usa "${proibida}", que é proibido. Reescreva só a mensagem, seguindo as mesmas regras (algo específico da conversa, empatia primeiro se houve problema, algo novo e útil, uma pergunta só).`,
          },
        ],
        {
          type: "object",
          additionalProperties: false,
          required: ["mensagem_sugerida"],
          properties: { mensagem_sugerida: { type: "string" } },
        },
      );
      somar(r2.usage);
      try {
        const nova = (
          JSON.parse(r2.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as {
            mensagem_sugerida?: string;
          }
        ).mensagem_sugerida;
        ficha.mensagem_sugerida = nova && !mensagemProibida(nova) ? nova : "";
      } catch {
        ficha.mensagem_sugerida = "";
      }
    }
    const motivoId =
      fatos.resultado === "vendeu"
        ? null
        : idDoMotivo(ficha.motivo_perda_sugerido, o.contexto.motivos);
    const { error } = await db.from("comercial_analises").upsert(
      {
        empresa_id: o.empresaId,
        crm_lead_id: o.leadId,
        lote_id: o.loteId,
        grupo: fatos.grupo,
        status: "ok",
        erro: null,
        fatos,
        ficha,
        servico: ficha.servico || fatos.servico,
        origem: fatos.origem,
        quem_atendeu: fatos.quemAtendeu,
        resultado: fatos.resultado,
        valor_orcado: fatos.valorOrcado,
        valor_vendido: fatos.valorVendido,
        nota: ficha.nota,
        motivo_sugerido_id: motivoId,
        frase_cliente: ficha.frase_cliente || null,
        ainda_vale: fatos.resultado === "vendeu" ? false : ficha.ainda_vale_chamar,
        mensagem_sugerida: ficha.mensagem_sugerida || null,
        pediu_encaixe: ficha.pediu_encaixe,
        modelo: MODELO_FICHA,
        tokens_entrada: uso.input_tokens,
        tokens_cache: (uso.cache_read_input_tokens ?? 0) + (uso.cache_creation_input_tokens ?? 0),
        tokens_saida: uso.output_tokens,
        custo_usd: custo,
        analisado_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,crm_lead_id" },
    );
    if (error) throw new Error(`gravar a ficha: ${error.message}`);
    return { ok: true, custoUsd: custo, transcritos };
  } catch (e) {
    const erro = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error("Gerente comercial: análise falhou", erro);
    await db.from("comercial_analises").upsert(
      {
        empresa_id: o.empresaId,
        crm_lead_id: o.leadId,
        lote_id: o.loteId,
        grupo: "outras",
        status: "erro",
        erro,
        custo_usd: custo,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,crm_lead_id", ignoreDuplicates: false },
    );
    return { ok: false, custoUsd: custo, transcritos, erro };
  }
}
