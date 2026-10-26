/**
 * Configurações da Alice → "Depois do agendamento": confirmação na véspera, pós-venda e pedido de
 * avaliação. Tudo começa desligado; só sai mensagem depois de "Ativar".
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import { MODELOS_ANTIGOS } from "@/lib/alice/pos-atendimento";
import { requireRecurso } from "@/lib/recurso.middleware";

/** alice: recurso do plano (Essencial não tem). */
const comRecurso = requireRecurso("alice");

export type ChavePos = "confirmacao" | "pos_venda" | "avaliacao";

export type SituacaoModeloPos =
  "aprovado" | "pendente" | "rejeitado" | "nao_existe" | "sem_nome" | "?";

export type ConfigPosAtendimento = {
  aliceAtiva: boolean;
  confirmacao: {
    ligada: boolean;
    hora: string;
    modelo: string | null;
    situacao: SituacaoModeloPos;
  };
  pos_venda: { ligada: boolean; hora: string; modelo: string | null; situacao: SituacaoModeloPos };
  avaliacao: { ligada: boolean; link: string | null; texto: string };
  recentes: Array<{
    os: string;
    tipo: string;
    situacao: string;
    motivo: string | null;
    via: string | null;
    resposta: string | null;
    quando: string;
  }>;
  erroModelos: string | null;
};

function situacao(
  modelos: Array<{ name: string; status: string }>,
  nome: string | null,
): SituacaoModeloPos {
  if (!nome) return "sem_nome";
  const m = modelos.find((x) => x.name === nome);
  if (!m) return "nao_existe";
  const s = String(m.status).toUpperCase();
  if (s === "APPROVED") return "aprovado";
  if (s === "REJECTED") return "rejeitado";
  return "pendente";
}

export const configPosAtendimento = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ConfigPosAtendimento> => {
    const db = context.supabase;
    const [{ data: cfg }, { data: recentes }] = await Promise.all([
      db
        .from("ia_configuracoes")
        .select(
          "ativo, confirmacao_ligada, confirmacao_hora, confirmacao_modelo, pos_venda_ligado, pos_venda_hora, pos_venda_modelo, avaliacao_ligada, avaliacao_link, avaliacao_texto",
        )
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      db
        .from("ia_pos_atendimento")
        .select(
          "tipo, situacao, motivo, via, resposta, created_at, work_order:work_order_id ( os_number )",
        )
        .eq("empresa_id", context.empresaId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    let modelos: Array<{ name: string; status: string }> = [];
    let erroModelos: string | null = null;
    if (cfg?.confirmacao_modelo || cfg?.pos_venda_modelo) {
      try {
        const { dbServico } = await import("@/lib/mkt/contexto.server");
        const { modelosAtualizados } = await import("@/lib/mkt/modelos-situacao.server");
        const r = await modelosAtualizados(await dbServico(), context.empresaId, {
          precisa: [cfg.confirmacao_modelo, cfg.pos_venda_modelo].filter(Boolean) as string[],
        });
        modelos = r.modelos;
      } catch (e) {
        erroModelos = e instanceof Error ? e.message.slice(0, 200) : String(e);
      }
    }
    const lista = (recentes ?? []) as unknown as Array<{
      tipo: string;
      situacao: string;
      motivo: string | null;
      via: string | null;
      resposta: string | null;
      created_at: string;
      work_order: { os_number: string } | null;
    }>;
    return {
      aliceAtiva: Boolean(cfg?.ativo),
      confirmacao: {
        ligada: Boolean(cfg?.confirmacao_ligada),
        hora: String(cfg?.confirmacao_hora ?? "10:00").slice(0, 5),
        modelo: cfg?.confirmacao_modelo ?? null,
        situacao: erroModelos ? "?" : situacao(modelos, cfg?.confirmacao_modelo ?? null),
      },
      pos_venda: {
        ligada: Boolean(cfg?.pos_venda_ligado),
        hora: String(cfg?.pos_venda_hora ?? "10:00").slice(0, 5),
        modelo: cfg?.pos_venda_modelo ?? null,
        situacao: erroModelos ? "?" : situacao(modelos, cfg?.pos_venda_modelo ?? null),
      },
      avaliacao: {
        ligada: Boolean(cfg?.avaliacao_ligada),
        link: cfg?.avaliacao_link ?? null,
        texto: cfg?.avaliacao_texto ?? "",
      },
      recentes: lista.map((r) => ({
        os: r.work_order?.os_number ?? "—",
        tipo: r.tipo,
        situacao: r.situacao,
        motivo: r.motivo,
        via: r.via,
        resposta: r.resposta,
        quando: r.created_at,
      })),
      erroModelos,
    };
  });

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const NOME_MODELO = /^[a-z0-9_]{1,512}$/;

/** Horários, nomes dos modelos, link e texto da avaliação (não liga nada). */
export const salvarPosAtendimento = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comRecurso])
  .inputValidator(
    (input: {
      confirmacao_hora: string;
      confirmacao_modelo: string;
      pos_venda_hora: string;
      pos_venda_modelo: string;
      avaliacao_link: string;
      avaliacao_texto: string;
    }) => {
      if (!HORA.test(input.confirmacao_hora) || !HORA.test(input.pos_venda_hora))
        throw new Error("Horário inválido (use HH:MM).");
      for (const m of [input.confirmacao_modelo, input.pos_venda_modelo])
        if (m.trim() && !NOME_MODELO.test(m.trim()))
          throw new Error("Nome do modelo: só letras minúsculas, números e _.");
      for (const m of [input.confirmacao_modelo, input.pos_venda_modelo])
        if (MODELOS_ANTIGOS.includes(m.trim()))
          throw new Error(
            `${m.trim()} é o modelo antigo (com "amanhã"/"ontem" fixos) e não é usado. Use ${m.trim()}_v2.`,
          );
      const link = input.avaliacao_link.trim();
      if (link && !/^https:\/\/\S+$/.test(link))
        throw new Error("O link precisa começar com https://.");
      if (input.avaliacao_texto.length > 1500) throw new Error("Texto da avaliação muito longo.");
      if (input.avaliacao_texto.trim() && !input.avaliacao_texto.includes("{link}"))
        throw new Error("O texto da avaliação precisa ter {link}.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ia_configuracoes")
      .update({
        confirmacao_hora: data.confirmacao_hora,
        confirmacao_modelo: data.confirmacao_modelo.trim() || null,
        pos_venda_hora: data.pos_venda_hora,
        pos_venda_modelo: data.pos_venda_modelo.trim() || null,
        avaliacao_link: data.avaliacao_link.trim() || null,
        ...(data.avaliacao_texto.trim() ? { avaliacao_texto: data.avaliacao_texto } : {}),
      })
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

/** "Ativar" / "Desativar": só aqui uma chave liga. */
export const ativarPosAtendimento = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comRecurso])
  .inputValidator((input: { chave: ChavePos; ligada: boolean }) => {
    if (!["confirmacao", "pos_venda", "avaliacao"].includes(input.chave))
      throw new Error("Opção inválida.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: cfg } = await db
      .from("ia_configuracoes")
      .select("ativo, confirmacao_modelo, pos_venda_modelo, avaliacao_link")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!cfg) throw new Error("Configure a Alice primeiro.");
    if (data.ligada) {
      if (data.chave === "confirmacao" && !cfg.confirmacao_modelo)
        throw new Error("Informe o nome do modelo da confirmação antes de ativar.");
      if (data.chave === "pos_venda" && !cfg.pos_venda_modelo)
        throw new Error("Informe o nome do modelo do pós-venda antes de ativar.");
      if (data.chave === "avaliacao" && !cfg.avaliacao_link)
        throw new Error("Informe o link de avaliação do Google antes de ativar.");
    }
    const coluna =
      data.chave === "confirmacao"
        ? "confirmacao_ligada"
        : data.chave === "pos_venda"
          ? "pos_venda_ligado"
          : "avaliacao_ligada";
    const { error } = await db
      .from("ia_configuracoes")
      .update({ [coluna]: data.ligada } as never)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

/** Cliente da OS ou da conversa (para o botão "Tirar a Alice desta cliente"). */
export const clienteDaAlice = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { workOrderId?: string; conversaId?: string }) => {
    const id = input.workOrderId ?? input.conversaId ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Registro inválido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    if (data.conversaId) {
      const { data: conv } = await db
        .from("conversas")
        .select("whatsapp_contact_id")
        .eq("id", data.conversaId)
        .eq("empresa_id", context.empresaId)
        .maybeSingle();
      if (!conv?.whatsapp_contact_id) return null;
      const { data: c } = await db
        .from("whatsapp_contacts")
        .select("id, ia_desligada")
        .eq("id", conv.whatsapp_contact_id)
        .maybeSingle();
      return c ?? null;
    }
    const { data: wo } = await db
      .from("work_orders")
      .select("customer_id, customer:customer_id ( phone )")
      .eq("id", data.workOrderId!)
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!wo) return null;
    const { data: porCliente } = await db
      .from("whatsapp_contacts")
      .select("id, ia_desligada")
      .eq("empresa_id", context.empresaId)
      .eq("current_customer_id", wo.customer_id)
      .limit(1)
      .maybeSingle();
    if (porCliente) return porCliente;
    const fone = String(
      (wo as unknown as { customer: { phone: string | null } | null }).customer?.phone ?? "",
    ).replace(/\D/g, "");
    if (fone.length < 10) return null;
    const { chaveTelefone } = await import("@/lib/mkt/chatwoot.server");
    const { data: lista } = await db
      .from("whatsapp_contacts")
      .select("id, ia_desligada, normalized_phone")
      .eq("empresa_id", context.empresaId)
      .like("normalized_phone", `%${fone.slice(-8)}`)
      .limit(10);
    const c = (lista ?? []).find((x) => chaveTelefone(x.normalized_phone) === chaveTelefone(fone));
    return c ? { id: c.id, ia_desligada: c.ia_desligada } : null;
  });
