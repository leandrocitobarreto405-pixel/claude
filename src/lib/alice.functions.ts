import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

export const MODELOS_ALICE = [
  { id: "claude-opus-5-5", nome: "Claude Opus 5.5 (recomendado)" },
  { id: "claude-opus-5", nome: "Claude Opus 5" },
  { id: "claude-sonnet-5-5", nome: "Claude Sonnet 5.5 (mais barato)" },
] as const;

export type ConfigAlice = {
  ativo: boolean;
  nome: string;
  instrucoes: string;
  perguntas_frequentes: string;
  modelo: string;
  esforco: "low" | "medium" | "high";
  espera_segundos: number;
  limite_respostas_conversa: number;
  desconto_pix_percentual: number;
  parcelas_max: number;
  validade_orcamento_dias: number;
  raio_km: number | null;
  hora_inicio: number;
  hora_fim: number;
  agenda_automatica: boolean;
  transcrever_audio: boolean;
};

export const CAMPOS_MIDIA = [
  "video_higienizacao",
  "video_impermeabilizacao",
  "audio_higienizacao",
  "audio_impermeabilizacao",
] as const;
export type CampoMidia = (typeof CAMPOS_MIDIA)[number];
export type MidiasAlice = Record<CampoMidia, string | null>;

export type SituacaoAlice = {
  config: ConfigAlice;
  midias: MidiasAlice;
  empresaId: string;
  iaNoServidor: boolean;
  roboNoChatwoot: boolean;
  caixas: number;
  ultimos7dias: { respostas: number; custoUsd: number; passagens: number; erros: number };
};

const PADRAO: ConfigAlice = {
  ativo: false,
  nome: "Alice",
  instrucoes: "",
  perguntas_frequentes: "",
  modelo: "claude-opus-5-5",
  esforco: "medium",
  espera_segundos: 8,
  limite_respostas_conversa: 40,
  desconto_pix_percentual: 5,
  parcelas_max: 5,
  validade_orcamento_dias: 2,
  raio_km: null,
  hora_inicio: 8,
  hora_fim: 21,
  agenda_automatica: false,
  transcrever_audio: true,
};

const SEM_MIDIAS: MidiasAlice = {
  video_higienizacao: null,
  video_impermeabilizacao: null,
  audio_higienizacao: null,
  audio_impermeabilizacao: null,
};

const inteiro = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : padrao;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Caixas de entrada da empresa com a conexão, o robô e os tokens (só no servidor). */
async function caixasDaEmpresa(empresaId: string) {
  const db = await admin();
  const { data: caixas } = await db
    .from("chatwoot_inboxes")
    .select("inbox_id, conexao_id")
    .eq("empresa_id", empresaId)
    .eq("ativo", true);
  const ids = [...new Set((caixas ?? []).map((c) => c.conexao_id))];
  const [{ data: conexoes }, { data: segredos }] = await Promise.all([
    ids.length
      ? db.from("chatwoot_conexoes").select("id, base_url, account_id, alice_bot_id").in("id", ids)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            base_url: string;
            account_id: number;
            alice_bot_id: number | null;
          }>,
        }),
    ids.length
      ? db
          .from("chatwoot_conexao_segredos")
          .select("conexao_id, api_token, alice_bot_token")
          .in("conexao_id", ids)
      : Promise.resolve({
          data: [] as Array<{
            conexao_id: string;
            api_token: string | null;
            alice_bot_token: string | null;
          }>,
        }),
  ]);
  return (caixas ?? []).map((c) => {
    const cx = (conexoes ?? []).find((x) => x.id === c.conexao_id);
    const sg = (segredos ?? []).find((x) => x.conexao_id === c.conexao_id);
    return {
      caixa: Number(c.inbox_id),
      conta: cx ? { baseUrl: cx.base_url, accountId: Number(cx.account_id) } : null,
      roboId: cx?.alice_bot_id ?? null,
      tokenAdmin: sg?.api_token ?? null,
      tokenRobo: sg?.alice_bot_token ?? null,
    };
  });
}

export const situacaoAlice = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<SituacaoAlice> => {
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: cfg }, { data: execs }, caixas] = await Promise.all([
      context.supabase
        .from("ia_configuracoes")
        .select("*")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      context.supabase
        .from("ia_execucoes")
        .select("custo_usd, erro, ferramentas")
        .eq("empresa_id", context.empresaId)
        .gte("created_at", desde),
      caixasDaEmpresa(context.empresaId),
    ]);
    const lista = (execs ?? []) as Array<{
      custo_usd: number;
      erro: string | null;
      ferramentas: unknown;
    }>;
    return {
      config: cfg
        ? {
            ativo: cfg.ativo,
            nome: cfg.nome,
            instrucoes: cfg.instrucoes,
            perguntas_frequentes: cfg.perguntas_frequentes,
            modelo: cfg.modelo,
            esforco: cfg.esforco as ConfigAlice["esforco"],
            espera_segundos: cfg.espera_segundos,
            limite_respostas_conversa: cfg.limite_respostas_conversa,
            desconto_pix_percentual: Number(cfg.desconto_pix_percentual),
            parcelas_max: cfg.parcelas_max,
            validade_orcamento_dias: cfg.validade_orcamento_dias,
            raio_km: cfg.raio_km === null ? null : Number(cfg.raio_km),
            hora_inicio: cfg.hora_inicio,
            hora_fim: cfg.hora_fim,
            agenda_automatica: cfg.agenda_automatica,
            transcrever_audio: cfg.transcrever_audio,
          }
        : PADRAO,
      midias: cfg
        ? {
            video_higienizacao: cfg.video_higienizacao,
            video_impermeabilizacao: cfg.video_impermeabilizacao,
            audio_higienizacao: cfg.audio_higienizacao,
            audio_impermeabilizacao: cfg.audio_impermeabilizacao,
          }
        : SEM_MIDIAS,
      empresaId: context.empresaId,
      iaNoServidor: Boolean(process.env["ANTHROPIC_API_KEY"]),
      roboNoChatwoot: caixas.some((c) => c.roboId && c.tokenRobo),
      caixas: caixas.length,
      ultimos7dias: {
        respostas: lista.filter((e) => !e.erro).length,
        custoUsd: Math.round(lista.reduce((s, e) => s + Number(e.custo_usd ?? 0), 0) * 100) / 100,
        passagens: lista.filter(
          (e) =>
            Array.isArray(e.ferramentas) &&
            (e.ferramentas as Array<{ nome?: string }>).some(
              (f) => f.nome === "transferir_para_humano" || f.nome === "passar_para_atendente",
            ),
        ).length,
        erros: lista.filter((e) => e.erro).length,
      },
    };
  });

export const salvarAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: Omit<ConfigAlice, "ativo">) => {
    if (!MODELOS_ALICE.some((m) => m.id === input.modelo)) throw new Error("Modelo inválido.");
    if (!["low", "medium", "high"].includes(input.esforco)) throw new Error("Esforço inválido.");
    if (!input.nome?.trim() || input.nome.trim().length > 40)
      throw new Error("Informe o nome (até 40 letras).");
    if (input.instrucoes.length > 60000 || input.perguntas_frequentes.length > 20000)
      throw new Error(
        "Texto muito longo (instruções até 60 mil caracteres, perguntas até 20 mil).",
      );
    if (Number(input.hora_inicio) >= Number(input.hora_fim))
      throw new Error("O horário das mensagens ativas precisa começar antes de terminar.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ia_configuracoes").upsert(
      {
        empresa_id: context.empresaId,
        nome: data.nome.trim(),
        instrucoes: data.instrucoes,
        perguntas_frequentes: data.perguntas_frequentes,
        modelo: data.modelo,
        desconto_pix_percentual: Math.min(
          Math.max(Number(data.desconto_pix_percentual) || 0, 0),
          50,
        ),
        parcelas_max: inteiro(data.parcelas_max, 1, 12, 5),
        validade_orcamento_dias: inteiro(data.validade_orcamento_dias, 0, 30, 2),
        raio_km:
          data.raio_km === null || !(Number(data.raio_km) > 0)
            ? null
            : Math.round(Number(data.raio_km) * 10) / 10,
        hora_inicio: inteiro(data.hora_inicio, 0, 23, 8),
        hora_fim: inteiro(data.hora_fim, 1, 24, 21),
        agenda_automatica: Boolean(data.agenda_automatica),
        transcrever_audio: Boolean(data.transcrever_audio),
        esforco: data.esforco,
        espera_segundos: Math.min(Math.max(Math.round(Number(data.espera_segundos) || 0), 0), 120),
        limite_respostas_conversa: Math.min(
          Math.max(Math.round(Number(data.limite_respostas_conversa) || 40), 1),
          500,
        ),
      },
      { onConflict: "empresa_id" },
    );
    if (error) throw new Error("Não foi possível salvar a configuração da Alice.");
    return { ok: true };
  });

/** Liga/desliga a Alice: coloca (ou tira) o robô nas caixas de entrada da empresa no Chatwoot. */
export const ligarAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { ativo: boolean }) => ({ ativo: Boolean(input.ativo) }))
  .handler(async ({ data, context }) => {
    const { ligarRoboNaCaixa, mudarSituacao } = await import("@/lib/alice/chatwoot-api.server");
    const db = await admin();
    const caixas = await caixasDaEmpresa(context.empresaId);
    if (data.ativo) {
      if (!process.env["ANTHROPIC_API_KEY"])
        throw new Error("A chave da IA ainda não foi configurada no servidor.");
      if (!caixas.length) throw new Error("A empresa não tem caixa de entrada do Chatwoot ligada.");
      if (caixas.some((c) => !c.conta || !c.roboId || !c.tokenAdmin || !c.tokenRobo))
        throw new Error("A Nexa ainda não criou o robô da Alice no Chatwoot (Nexa → Chatwoot).");
    }
    for (const c of caixas) {
      if (c.conta && c.tokenAdmin && (c.roboId || !data.ativo)) {
        await ligarRoboNaCaixa(c.conta, c.tokenAdmin, c.caixa, data.ativo ? c.roboId : null);
      }
    }
    if (data.ativo) {
      const { data: cfg } = await context.supabase
        .from("ia_configuracoes")
        .select("nome")
        .eq("empresa_id", context.empresaId)
        .maybeSingle();
      const { data: existe } = await db
        .from("salespeople")
        .select("id")
        .eq("empresa_id", context.empresaId)
        .eq("eh_ia", true)
        .maybeSingle();
      if (!existe) {
        await db.from("salespeople").insert({
          empresa_id: context.empresaId,
          name: `${cfg?.nome ?? "Alice"} (IA)`,
          commission_percentage: 0,
          active: true,
          atendente_nexa: true,
          eh_ia: true,
        } as never);
      }
    } else {
      // Conversas que estavam com o robô voltam para a fila da equipe.
      const { data: pendentes } = await db
        .from("conversas")
        .select("id, chatwoot_conversation_id, conexao_id")
        .eq("empresa_id", context.empresaId)
        .eq("status", "pending");
      for (const p of pendentes ?? []) {
        const c = caixas.find((x) => x.conta && x.tokenAdmin);
        if (!c?.conta || !c.tokenAdmin) break;
        await mudarSituacao(
          c.conta,
          c.tokenAdmin,
          Number(p.chatwoot_conversation_id),
          "open",
        ).catch(() => undefined);
        await db.from("conversas").update({ status: "open" }).eq("id", p.id);
      }
    }
    const { error } = await context.supabase
      .from("ia_configuracoes")
      .upsert({ empresa_id: context.empresaId, ativo: data.ativo }, { onConflict: "empresa_id" });
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

/** Nexa: cria o robô "Alice" na conta do Chatwoot (uma vez por conexão). */
export const criarRoboAlice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conexaoId: string; origem: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(input.conexaoId)) throw new Error("Conexão inválida.");
    if (!/^https?:\/\/[^/]+$/.test(input.origem)) throw new Error("Endereço do app inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: souNexa } = await context.supabase.rpc("sou_admin_nexa");
    if (souNexa !== true) throw new Error("Apenas administradores da Nexa.");
    const { criarRobo } = await import("@/lib/alice/chatwoot-api.server");
    const db = await admin();
    const [{ data: conexao }, { data: segredo }] = await Promise.all([
      db
        .from("chatwoot_conexoes")
        .select("base_url, account_id, webhook_token, alice_bot_id")
        .eq("id", data.conexaoId)
        .single(),
      db
        .from("chatwoot_conexao_segredos")
        .select("api_token, alice_bot_token")
        .eq("conexao_id", data.conexaoId)
        .maybeSingle(),
    ]);
    if (!conexao) throw new Error("Conexão não encontrada.");
    if (conexao.alice_bot_id && segredo?.alice_bot_token)
      return { ok: true, roboId: conexao.alice_bot_id };
    if (!segredo?.api_token)
      throw new Error("Cadastre antes o token de API do Chatwoot nesta conexão.");
    const robo = await criarRobo(
      { baseUrl: conexao.base_url, accountId: Number(conexao.account_id) },
      segredo.api_token,
      "Alice",
      `${data.origem}/api/public/hooks/alice-robo/${conexao.webhook_token}`,
    );
    if (!robo.id || !robo.access_token) throw new Error("O Chatwoot não devolveu o token do robô.");
    await db.from("chatwoot_conexoes").update({ alice_bot_id: robo.id }).eq("id", data.conexaoId);
    await db
      .from("chatwoot_conexao_segredos")
      .update({ alice_bot_token: robo.access_token })
      .eq("conexao_id", data.conexaoId);
    return { ok: true, roboId: robo.id };
  });

/**
 * Guarda (ou tira) a mídia padrão da Alice. O arquivo já foi enviado ao Storage pela tela, na
 * pasta da empresa; o arquivo anterior do mesmo campo é apagado.
 */
export const salvarMidiaAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((input: { campo: CampoMidia; caminho: string | null }) => {
    if (!CAMPOS_MIDIA.includes(input.campo)) throw new Error("Campo inválido.");
    if (input.caminho !== null && !/^[0-9a-f-]{36}\/[\w.-]{1,120}$/i.test(input.caminho))
      throw new Error("Arquivo inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    if (data.caminho && !data.caminho.startsWith(`${context.empresaId}/`))
      throw new Error("Arquivo de outra empresa.");
    const { data: atual } = await context.supabase
      .from("ia_configuracoes")
      .select(data.campo)
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    const anterior = (atual as Record<string, string | null> | null)?.[data.campo] ?? null;
    const { error } = await context.supabase.from("ia_configuracoes").upsert(
      { empresa_id: context.empresaId, [data.campo]: data.caminho } as MidiasAlice & {
        empresa_id: string;
      },
      { onConflict: "empresa_id" },
    );
    if (error) throw new Error("Não foi possível salvar o arquivo da Alice.");
    if (anterior && anterior !== data.caminho) {
      await context.supabase.storage.from("alice-midias").remove([anterior]);
    }
    return { ok: true };
  });

export type AliceNoCliente = {
  aliceLigada: boolean;
  contato: { id: string; ia_desligada: boolean; sem_pos_venda: boolean } | null;
  conversa: { id: string; comAlice: boolean; url: string | null } | null;
};

/** Situação da Alice para o cliente de um lead (tela do lead). */
export const aliceNoCliente = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { leadId: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(input.leadId)) throw new Error("Lead inválido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<AliceNoCliente> => {
    const db = context.supabase;
    const [{ data: cfg }, { data: lead }] = await Promise.all([
      db.from("ia_configuracoes").select("ativo").eq("empresa_id", context.empresaId).maybeSingle(),
      db
        .from("crm_leads")
        .select("id, whatsapp_contact_id")
        .eq("id", data.leadId)
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
    ]);
    if (!lead) throw new Error("Lead não encontrado.");
    const [{ data: contato }, { data: conversa }] = await Promise.all([
      lead.whatsapp_contact_id
        ? db
            .from("whatsapp_contacts")
            .select("id, ia_desligada, sem_pos_venda")
            .eq("id", lead.whatsapp_contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from("conversas")
        .select("id, status, url_chatwoot, ultima_atividade_em")
        .or(
          lead.whatsapp_contact_id
            ? `crm_lead_id.eq.${lead.id},whatsapp_contact_id.eq.${lead.whatsapp_contact_id}`
            : `crm_lead_id.eq.${lead.id}`,
        )
        .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      aliceLigada: Boolean(cfg?.ativo),
      contato: contato ?? null,
      conversa: conversa
        ? { id: conversa.id, comAlice: conversa.status === "pending", url: conversa.url_chatwoot }
        : null,
    };
  });

async function mudarConversaNoChatwoot(
  empresaId: string,
  conversaId: string,
  situacao: "open" | "pending",
  nota: string | null,
) {
  const { enviarMensagem, mudarSituacao } = await import("@/lib/alice/chatwoot-api.server");
  const db = await admin();
  const { data: conv } = await db
    .from("conversas")
    .select("id, chatwoot_conversation_id, conexao_id")
    .eq("id", conversaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!conv) throw new Error("Conversa não encontrada.");
  const [{ data: cx }, { data: sg }] = await Promise.all([
    db.from("chatwoot_conexoes").select("base_url, account_id").eq("id", conv.conexao_id).single(),
    db
      .from("chatwoot_conexao_segredos")
      .select("api_token")
      .eq("conexao_id", conv.conexao_id)
      .maybeSingle(),
  ]);
  if (!cx || !sg?.api_token) throw new Error("A conexão do Chatwoot está sem token de API.");
  const conta = { baseUrl: cx.base_url, accountId: Number(cx.account_id) };
  if (nota) {
    await enviarMensagem(conta, sg.api_token, Number(conv.chatwoot_conversation_id), nota, true);
  }
  await mudarSituacao(conta, sg.api_token, Number(conv.chatwoot_conversation_id), situacao);
  await db.from("conversas").update({ status: situacao }).eq("id", conv.id);
}

/** "IA desligada" / "Sem pós-venda" no cliente. Desligar a IA tira a conversa do robô. */
export const marcarAliceNoCliente = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator(
    (input: { contatoId: string; ia_desligada?: boolean; sem_pos_venda?: boolean }) => {
      if (!/^[0-9a-f-]{36}$/i.test(input.contatoId)) throw new Error("Cliente inválido.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const patch: { ia_desligada?: boolean; sem_pos_venda?: boolean } = {};
    if (data.ia_desligada !== undefined) patch.ia_desligada = Boolean(data.ia_desligada);
    if (data.sem_pos_venda !== undefined) patch.sem_pos_venda = Boolean(data.sem_pos_venda);
    const { data: atualizado, error } = await context.supabase
      .from("whatsapp_contacts")
      .update(patch)
      .eq("id", data.contatoId)
      .eq("empresa_id", context.empresaId)
      .select("id")
      .maybeSingle();
    if (error || !atualizado) throw new Error("Não foi possível salvar.");
    if (patch.ia_desligada) {
      const { data: comRobo } = await context.supabase
        .from("conversas")
        .select("id")
        .eq("empresa_id", context.empresaId)
        .eq("whatsapp_contact_id", data.contatoId)
        .eq("status", "pending");
      for (const c of comRobo ?? []) {
        await mudarConversaNoChatwoot(
          context.empresaId,
          c.id,
          "open",
          "🤖 IA desligada para este cliente no Nexa OS: a conversa ficou com a equipe.",
        );
      }
    }
    return { ok: true };
  });

/** Devolve a conversa para a Alice (depois que a equipe assumiu). */
export const devolverParaAlice = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { conversaId: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(input.conversaId)) throw new Error("Conversa inválida.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const [{ data: cfg }, { data: conv }] = await Promise.all([
      context.supabase
        .from("ia_configuracoes")
        .select("ativo, nome")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      context.supabase
        .from("conversas")
        .select("id, whatsapp_contact_id")
        .eq("id", data.conversaId)
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
    ]);
    if (!cfg?.ativo) throw new Error("A Alice está desligada nesta empresa.");
    if (!conv) throw new Error("Conversa não encontrada.");
    if (conv.whatsapp_contact_id) {
      const { data: contato } = await context.supabase
        .from("whatsapp_contacts")
        .select("ia_desligada")
        .eq("id", conv.whatsapp_contact_id)
        .maybeSingle();
      if (contato?.ia_desligada)
        throw new Error("A IA está desligada para este cliente. Religue antes de devolver.");
    }
    await mudarConversaNoChatwoot(
      context.empresaId,
      conv.id,
      "pending",
      `🤖 Conversa devolvida para a ${cfg.nome} pelo Nexa OS. Ela responde a próxima mensagem do cliente.`,
    );
    return { ok: true };
  });
