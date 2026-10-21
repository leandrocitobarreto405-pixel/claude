/**
 * Encerramento automático de conversas paradas: roda na varredura do agendador, mas cada empresa
 * só é tratada de hora em hora (última rodada guardada em app_settings "caixa_entrada"). Padrão
 * ligado (24 h, equipe e Alice); quem desligou em Configurações fica de fora. Encerra no Chatwoot
 * ("resolved") e marca no app quem estava com a conversa; se o cliente escrever de novo, o
 * gatilho do banco devolve a conversa para a Alice ou deixa com a equipe. Nada vai ao cliente.
 */
import {
  CHAVE_CONFIG_CAIXA,
  MAX_POR_RODADA,
  aplicarRegra1,
  configEncerramento,
  horaDeRodar,
  limiteParada,
  situacoesAlcancadas,
  type Candidata,
  type ConfigEncerramento,
  type Selecao,
} from "@/lib/caixa-encerramento";

export type ResumoEncerramento = {
  empresas: number;
  encerradas: number;
  falhas: number;
  protegidas: number;
  puladas: number;
};

type Db = {
  from: (tabela: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type CandidataCompleta = Candidata & { conexao_id: string };

/**
 * Conversas paradas da empresa que a regra alcança, já separadas pela regra 1 (follow-up,
 * lembrete, pós-venda, campanha ou tarefa da Alice pendentes ficam de fora).
 */
export async function selecionarParaEncerrar(
  db: Db,
  empresaId: string,
  cfg: ConfigEncerramento,
  limite = MAX_POR_RODADA,
): Promise<Selecao<CandidataCompleta>> {
  const { data: linhas, error } = await db
    .from("conversas")
    .select(
      "id, status, crm_lead_id, chatwoot_conversation_id, conexao_id, contato:whatsapp_contact_id ( normalized_phone )",
    )
    .eq("empresa_id", empresaId)
    .in("status", situacoesAlcancadas(cfg))
    .lt("ultima_atividade_em", limiteParada(cfg))
    .order("ultima_atividade_em")
    .limit(limite);
  if (error) throw new Error(`conversas: ${error.message}`);
  const candidatas: CandidataCompleta[] = (
    (linhas ?? []) as Array<{
      id: string;
      status: string | null;
      crm_lead_id: string | null;
      chatwoot_conversation_id: number | string;
      conexao_id: string;
      contato: { normalized_phone: string | null } | null;
    }>
  ).map((c) => ({
    id: c.id,
    status: c.status,
    crm_lead_id: c.crm_lead_id,
    chatwoot_conversation_id: c.chatwoot_conversation_id,
    conexao_id: c.conexao_id,
    normalized_phone: c.contato?.normalized_phone ?? null,
  }));
  if (!candidatas.length)
    return {
      encerrar: [],
      protegidas: { total: 0, followup: 0, envio: 0, tarefa: 0 },
      lotada: false,
    };

  const [followups, envios, tarefas] = await Promise.all([
    db
      .from("crm_followups")
      .select("conversa_id, crm_lead_id, lead:crm_lead_id!inner ( empresa_id )")
      .eq("status", "Pendente")
      .eq("lead.empresa_id", empresaId),
    db
      .from("mkt_envios")
      .select("normalized_phone, chatwoot_conversation_id")
      .eq("empresa_id", empresaId)
      .in("status", ["pendente", "manual"]),
    db
      .from("ia_tarefas")
      .select("conversa_id")
      .eq("empresa_id", empresaId)
      .eq("situacao", "pendente"),
  ]);
  for (const r of [followups, envios, tarefas])
    if (r.error) throw new Error(`pendências: ${r.error.message}`);
  return aplicarRegra1(
    candidatas,
    {
      followups: followups.data ?? [],
      envios: envios.data ?? [],
      tarefas: tarefas.data ?? [],
    },
    limite,
  );
}

export async function rodarEncerramentoAutomatico(agora = new Date()): Promise<ResumoEncerramento> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { encerrarNoChatwoot } = await import("@/lib/conversas-limpeza.functions");
  const db = supabaseAdmin as unknown as Db;
  const total: ResumoEncerramento = {
    empresas: 0,
    encerradas: 0,
    falhas: 0,
    protegidas: 0,
    puladas: 0,
  };
  const [{ data: empresas }, { data: cfgs }] = await Promise.all([
    db.from("empresas").select("id"),
    db.from("app_settings").select("empresa_id, value").eq("key", CHAVE_CONFIG_CAIXA),
  ]);
  const salvo = new Map<string, Record<string, unknown>>();
  for (const l of (cfgs ?? []) as Array<{ empresa_id: string | null; value: unknown }>)
    if (l.empresa_id && l.value && typeof l.value === "object")
      salvo.set(l.empresa_id, l.value as Record<string, unknown>);

  for (const { id: empresaId } of (empresas ?? []) as Array<{ id: string }>) {
    const valor = salvo.get(empresaId) ?? {};
    const cfg = configEncerramento(valor);
    if (!cfg.ligado) continue;
    if (
      !horaDeRodar(
        valor["encerramento_ultima_rodada"],
        agora,
        valor["encerramento_ultimo_resultado"],
      )
    ) {
      total.puladas++;
      continue;
    }
    total.empresas++;
    let selecao: Selecao<CandidataCompleta>;
    try {
      selecao = await selecionarParaEncerrar(db, empresaId, cfg);
    } catch (e) {
      console.error("Encerramento automático: seleção falhou", empresaId, e);
      continue;
    }
    total.protegidas += selecao.protegidas.total;
    if (selecao.encerrar.length) {
      const r = await encerrarNoChatwoot(selecao.encerrar, empresaId, "automatico");
      total.encerradas += r.encerradas;
      total.falhas += r.falhas;
    }
    // Guarda a hora da rodada (e o resultado, para conferência) junto com a configuração.
    await db.from("app_settings").upsert(
      {
        empresa_id: empresaId,
        key: CHAVE_CONFIG_CAIXA,
        value: {
          ...valor,
          encerramento_ultima_rodada: agora.toISOString(),
          encerramento_ultimo_resultado: {
            encerradas: selecao.encerrar.length,
            protegidas: selecao.protegidas,
            // Lote cheio (mesmo que parte tenha ficado protegida): continua na próxima varredura.
            lotada: selecao.lotada,
          },
        },
        updated_at: agora.toISOString(),
      },
      { onConflict: "empresa_id,key" },
    );
  }
  return total;
}
