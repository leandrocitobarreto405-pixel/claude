/**
 * Agenda do dia seguinte no WhatsApp de cada técnico da equipe (só servidor). Sempre pelo número
 * (caixa do Chatwoot e conta da Meta) da própria empresa: a agenda de uma empresa nunca sai pelo
 * número de outra. Não usa IA. O envio automático nasce DESLIGADO (Configurações › Agenda) e só
 * liga com o modelo agenda_tecnico_dia aprovado como Utilidade no número da empresa.
 *
 * Dentro da janela de 24 h vai o texto da "Mensagem de amanhã"; fora dela, o modelo curto com o
 * botão "Ver agenda", e o texto sai quando o técnico toca no botão ou responde qualquer coisa.
 * Sem resposta até as 7h do dia do serviço: aviso no app ("técnico X não abriu a agenda").
 */
import {
  IDIOMA_MODELO_AGENDA,
  NOME_MODELO_AGENDA,
  agoraSP,
  diaSeguinte,
  formularioModeloAgenda,
  horaDeEnviar,
  precisaAvisoNaoAbriu,
  primeiroNome,
  situacaoModeloAgenda,
  textoDaAgenda,
  textoDoModeloAgenda,
  variaveisModeloAgenda,
  type SituacaoModeloAgenda,
} from "@/lib/agenda-tecnicos";
import { budgetVisitMessageContext, visitMessageContext } from "@/lib/mensagem-confirmacao";
import type { CollectionVisit } from "@/lib/collection";
import type { VisitRow } from "@/lib/os";
import type { BudgetVisitRow } from "@/lib/budget-visits";
import { chaveTelefone } from "@/lib/mkt/chatwoot.server";
import { log, type ContextoEmpresa, type Db } from "@/lib/mkt/contexto.server";
import type { Database } from "@/integrations/supabase/types";

// Os mesmos campos que a tela "Confirmar amanhã" usa para montar a mensagem.
const SELECT_VISITA = `
  id, scheduled_date, scheduled_time, status, visit_value, final_value, upholstery_description,
  visit_notes, work_order_id, technician_id,
  service_type:service_type_id ( id, name ),
  upholstery_type:upholstery_type_id ( id, name ),
  technician:technician_id ( id, name, base_address ),
  work_order:work_order_id (
    id, os_number, total_gross_value, status, eh_teste,
    negotiated_payment_method, negotiated_installments,
    collection_rule, collection_visit_id, payment_instruction,
    customer:customer_id ( id, full_name, phone, full_address )
  )
`;
const SELECT_ORCAMENTO = `
  id, scheduled_date, scheduled_time, status, upholstery_description, notes, visit_fee,
  technician_id, technician:technician_id ( id, name ),
  customer:customer_id ( id, full_name, phone, full_address )
`;

export type TecnicoAgenda = {
  id: string;
  name: string;
  telefone: string | null;
  recebe_agenda: boolean;
  parceiro: boolean;
  active: boolean;
};

type Item = { hora: string; mensagem: string };

/** Mensagens de amanhã por técnico (mesmo texto da tela), sem OS de teste nem cancelada. */
export async function mensagensPorTecnico(
  db: Db,
  empresaId: string,
  dia: string,
): Promise<Map<string, string[]>> {
  const [visitas, orcamentos, modelo] = await Promise.all([
    db
      .from("visits")
      .select(SELECT_VISITA)
      .eq("empresa_id", empresaId)
      .eq("scheduled_date", dia)
      .not("status", "in", '("Cancelado","Reagendado com deslocamento")')
      .not("technician_id", "is", null)
      .order("scheduled_time"),
    db
      .from("budget_visits")
      .select(SELECT_ORCAMENTO)
      .eq("empresa_id", empresaId)
      .eq("scheduled_date", dia)
      .neq("status", "Cancelado")
      .not("technician_id", "is", null)
      .order("scheduled_time"),
    db
      .from("app_settings")
      .select("value")
      .eq("empresa_id", empresaId)
      .eq("key", "message_template")
      .maybeSingle(),
  ]);
  if (visitas.error) throw visitas.error;
  if (orcamentos.error) throw orcamentos.error;
  const template = modelo.data?.value ?? null;
  const linhas = ((visitas.data ?? []) as unknown as VisitRow[]).filter(
    (v) => v.work_order?.eh_teste !== true && v.work_order?.status !== "Cancelada",
  );
  const irmas = await visitasDaCobranca(
    db,
    empresaId,
    linhas.map((v) => v.work_order?.id ?? v.work_order_id ?? ""),
  );
  const porTecnico = new Map<string, Item[]>();
  const pôr = (tecnico: string | null | undefined, item: Item) => {
    if (!tecnico) return;
    porTecnico.set(tecnico, [...(porTecnico.get(tecnico) ?? []), item]);
  };
  for (const v of linhas)
    pôr(v.technician_id, {
      hora: v.scheduled_time,
      mensagem: visitMessageContext(
        v,
        template,
        irmas.get(v.work_order?.id ?? v.work_order_id ?? ""),
      ),
    });
  for (const b of (orcamentos.data ?? []) as unknown as BudgetVisitRow[])
    pôr(b.technician_id, {
      hora: b.scheduled_time,
      mensagem: budgetVisitMessageContext(b, template),
    });
  const saida = new Map<string, string[]>();
  for (const [tecnico, itens] of porTecnico)
    saida.set(
      tecnico,
      itens.sort((a, b) => a.hora.localeCompare(b.hora)).map((i) => i.mensagem),
    );
  return saida;
}

/** Todas as visitas das OS (para saber onde a cobrança acontece), como na tela. */
async function visitasDaCobranca(db: Db, empresaId: string, ids: string[]) {
  const unicos = [...new Set(ids.filter(Boolean))];
  const mapa = new Map<string, CollectionVisit[]>();
  if (!unicos.length) return mapa;
  const { data } = await db
    .from("visits")
    .select(
      "id, work_order_id, scheduled_date, scheduled_time, status, visit_value, final_value, service_type:service_type_id ( name )",
    )
    .eq("empresa_id", empresaId)
    .in("work_order_id", unicos);
  type Linha = {
    id: string;
    work_order_id: string;
    scheduled_date: string;
    scheduled_time: string;
    status: string;
    visit_value: number;
    final_value: number | null;
    service_type: { name: string } | null;
  };
  for (const r of (data ?? []) as unknown as Linha[]) {
    mapa.set(r.work_order_id, [
      ...(mapa.get(r.work_order_id) ?? []),
      {
        id: r.id,
        scheduled_date: r.scheduled_date,
        scheduled_time: r.scheduled_time,
        status: r.status,
        service_name: r.service_type?.name ?? null,
        amount: Number(r.final_value ?? r.visit_value ?? 0),
      },
    ]);
  }
  return mapa;
}

export async function tecnicosDaEmpresa(db: Db, empresaId: string): Promise<TecnicoAgenda[]> {
  const { data, error } = await db
    .from("technicians")
    .select("id, name, telefone, recebe_agenda, parceiro, active")
    .eq("empresa_id", empresaId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []) as TecnicoAgenda[];
}

// ---------------------------------------------------------------- modelo no número da empresa
export type EstadoModelo = { situacao: SituacaoModeloAgenda; motivo: string | null };

/** Situação do agenda_tecnico_dia na conta da Meta da própria empresa. */
export async function estadoDoModelo(db: Db, empresaId: string): Promise<EstadoModelo> {
  const { conexaoDaEmpresa } = await import("@/lib/meta/modelos.server");
  const cx = await conexaoDaEmpresa(db, empresaId);
  if (!cx || !(await temCaixa(db, empresaId))) return { situacao: "sem_conexao", motivo: null };
  const { listarModelos, mensagemDoErro, semToken } = await import("@/lib/meta/graph.server");
  try {
    const modelos = await listarModelos(cx);
    const m =
      modelos.find((x) => x.name === NOME_MODELO_AGENDA && x.language === IDIOMA_MODELO_AGENDA) ??
      null;
    const motivo = (m as { rejected_reason?: string } | null)?.rejected_reason;
    return {
      situacao: situacaoModeloAgenda(m),
      motivo: motivo && motivo !== "NONE" ? motivo : null,
    };
  } catch (e) {
    throw new Error(semToken(mensagemDoErro(e), cx.token));
  }
}

async function temCaixa(db: Db, empresaId: string): Promise<boolean> {
  const { contextoEmpresa } = await import("@/lib/mkt/contexto.server");
  try {
    const ctx = await contextoEmpresa(db, empresaId);
    return Boolean(ctx.tokenAdmin && ctx.tokenRobo);
  } catch {
    return false;
  }
}

/** Cadastra o modelo no número da empresa (mesmo caminho do "enviar para a Meta aprovar"). */
export async function cadastrarModeloAgenda(db: Db, empresaId: string, userId: string) {
  const atual = await estadoDoModelo(db, empresaId);
  if (atual.situacao === "sem_conexao")
    throw new Error("Conecte o WhatsApp da empresa para usar a agenda");
  if (atual.situacao !== "nao_cadastrado") return atual;
  const { enviarParaAprovacao } = await import("@/lib/meta/modelos.server");
  await enviarParaAprovacao(db, empresaId, userId, { id: null, form: formularioModeloAgenda() });
  return estadoDoModelo(db, empresaId);
}

// ---------------------------------------------------------------- envio
type Conversa = { chatwoot: number; id: string | null };

/** Conversa da caixa da empresa com o número (abre uma se não houver). */
async function conversaCom(
  ctx: ContextoEmpresa,
  numero: string,
  nome: string | null,
): Promise<number> {
  const { garantirContato, conversaExistente, criarConversa } =
    await import("@/lib/mkt/chatwoot.server");
  const contato = await garantirContato(ctx.conta, ctx.tokenAdmin!, ctx.caixa, numero, nome, null);
  return (
    (await conversaExistente(ctx.conta, ctx.tokenAdmin!, contato.id, ctx.caixa)) ??
    (await criarConversa(ctx.conta, ctx.tokenRobo!, ctx.caixa, contato, numero, "open"))
  );
}

/** Última mensagem recebida do número nesta conversa (janela de 24 h). */
async function ultimaRecebida(
  db: Db,
  empresaId: string,
  chatwootId: number,
): Promise<Conversa & { ultima: string | null }> {
  const { data: conv } = await db
    .from("conversas")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("chatwoot_conversation_id", chatwootId)
    .maybeSingle();
  if (!conv) return { chatwoot: chatwootId, id: null, ultima: null };
  const { data: msg } = await db
    .from("whatsapp_messages")
    .select("message_timestamp")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conv.id)
    .eq("direction", "Recebida")
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { chatwoot: chatwootId, id: conv.id, ultima: msg?.message_timestamp ?? null };
}

export function numeroCompleto(fone: string): string {
  const d = fone.replace(/\D/g, "");
  return d.length <= 11 ? `55${d}` : d;
}

export type ResultadoEnvio = {
  situacao: "enviado" | "aguardando" | "erro" | "sem_telefone" | "ja_enviado" | "sem_servicos";
  motivo: string | null;
};

/**
 * Manda a agenda de um técnico. Teste: vai para um contato interno da equipe e não conta como o
 * envio do dia. Um envio de verdade por técnico e dia (o banco garante).
 */
export async function enviarAgenda(
  db: Db,
  empresaId: string,
  o: {
    tecnico: TecnicoAgenda;
    dia: string;
    mensagens: string[];
    teste: boolean;
    destino: string | null;
    criadoPor: string | null;
  },
): Promise<ResultadoEnvio> {
  const telefone = o.teste ? o.destino : o.tecnico.telefone;
  const { data: envio, error } = await db
    .from("agenda_tecnicos_envios")
    .insert({
      empresa_id: empresaId,
      tecnico_id: o.tecnico.id,
      dia_agenda: o.dia,
      servicos: o.mensagens.length,
      situacao: telefone ? "enviando" : "sem_telefone",
      motivo: telefone ? null : "técnico sem telefone cadastrado",
      teste: o.teste,
      destino_interno: o.teste ? telefone : null,
      criado_por: o.criadoPor,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { situacao: "ja_enviado", motivo: null };
    throw error;
  }
  if (!telefone) return { situacao: "sem_telefone", motivo: "técnico sem telefone cadastrado" };
  const marcar = (dados: Database["public"]["Tables"]["agenda_tecnicos_envios"]["Update"]) =>
    db.from("agenda_tecnicos_envios").update(dados).eq("id", envio.id);
  try {
    const { contextoEmpresa } = await import("@/lib/mkt/contexto.server");
    const ctx = await contextoEmpresa(db, empresaId);
    if (!ctx.tokenAdmin || !ctx.tokenRobo)
      throw new Error("Conecte o WhatsApp da empresa para usar a agenda");
    const numero = numeroCompleto(telefone);
    const chatwoot = await conversaCom(ctx, numero, o.teste ? null : primeiroNome(o.tecnico.name));
    const conversa = await ultimaRecebida(db, empresaId, chatwoot);
    const { dentroDaJanela } = await import("@/lib/alice/regras");
    const { enviarMensagem } = await import("@/lib/alice/chatwoot-api.server");
    if (conversa.ultima && dentroDaJanela(new Date(conversa.ultima), new Date())) {
      const r = await enviarMensagem(
        ctx.conta,
        ctx.tokenRobo,
        chatwoot,
        textoDaAgenda(o.mensagens),
      );
      const agora = new Date().toISOString();
      await marcar({
        situacao: "enviado",
        via: "texto",
        tentativas: 1,
        conversa_id: chatwoot,
        mensagem_id: r.id,
        enviado_em: agora,
        texto_enviado_em: agora,
      });
      return { situacao: "enviado", motivo: null };
    }
    // Fora da janela: o modelo aprovado no número da própria empresa.
    const { modelosAtualizados } = await import("@/lib/mkt/modelos-situacao.server");
    const { situacaoModelo, templateParams } = await import("@/lib/mkt/modelos");
    const { modelos } = await modelosAtualizados(db, empresaId, {
      ctx,
      precisa: [NOME_MODELO_AGENDA],
      idioma: IDIOMA_MODELO_AGENDA,
    });
    const sit = situacaoModelo(modelos, NOME_MODELO_AGENDA, IDIOMA_MODELO_AGENDA);
    if (!sit.ok) throw new Error(sit.erro);
    if (String(sit.modelo.category ?? "").toUpperCase() !== "UTILITY")
      throw new Error("o modelo agenda_tecnico_dia não é de Utilidade na Meta");
    const nome = o.teste ? "Equipe" : o.tecnico.name;
    const { enviarModelo } = await import("@/lib/mkt/chatwoot.server");
    const r = await enviarModelo(
      ctx.conta,
      ctx.tokenRobo,
      chatwoot,
      textoDoModeloAgenda(nome, o.dia, o.mensagens.length),
      templateParams(sit.modelo, variaveisModeloAgenda(nome, o.dia, o.mensagens.length)),
    );
    await marcar({
      situacao: "aguardando",
      via: "modelo",
      tentativas: 1,
      conversa_id: chatwoot,
      mensagem_id: r.id,
      enviado_em: new Date().toISOString(),
    });
    return { situacao: "aguardando", motivo: null };
  } catch (e) {
    const motivo = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await marcar({ situacao: "erro", motivo, tentativas: 1 });
    log("WARNING", "agenda_tecnicos.erro", { empresa: empresaId, tecnico: o.tecnico.id, motivo });
    return { situacao: "erro", motivo };
  }
}

/**
 * O técnico tocou em "Ver agenda" ou respondeu: manda o texto (já dentro da janela). Monta de novo
 * na hora, então mudanças da tarde entram. Chamado pelo webhook do Chatwoot e pela rotina.
 */
export async function responderPedidoDaAgenda(
  db: Db,
  empresaId: string,
  conversaId: string,
): Promise<boolean> {
  const { data: conv } = await db
    .from("conversas")
    .select("chatwoot_conversation_id")
    .eq("empresa_id", empresaId)
    .eq("id", conversaId)
    .maybeSingle();
  if (!conv?.chatwoot_conversation_id) return false;
  const desde = new Date(Date.now() - 36 * 3600_000).toISOString();
  const { data: aguardando } = await db
    .from("agenda_tecnicos_envios")
    .select("id, tecnico_id, dia_agenda, enviado_em")
    .eq("empresa_id", empresaId)
    .eq("situacao", "aguardando")
    .eq("conversa_id", conv.chatwoot_conversation_id)
    .gte("enviado_em", desde)
    .order("enviado_em", { ascending: false })
    .limit(1);
  const envio = aguardando?.[0];
  if (!envio) return false;
  // Resposta tem que ser depois do modelo.
  const { data: resposta } = await db
    .from("whatsapp_messages")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("direction", "Recebida")
    .gt("message_timestamp", envio.enviado_em ?? desde)
    .limit(1);
  if (!resposta?.length) return false;
  // Trava: só um envio do texto, mesmo com webhook e rotina ao mesmo tempo.
  const { data: reservado } = await db
    .from("agenda_tecnicos_envios")
    .update({ situacao: "enviando" })
    .eq("id", envio.id)
    .eq("situacao", "aguardando")
    .select("id");
  if (!reservado?.length) return false;
  try {
    const mensagens =
      (await mensagensPorTecnico(db, empresaId, envio.dia_agenda)).get(envio.tecnico_id) ?? [];
    const texto = mensagens.length
      ? textoDaAgenda(mensagens)
      : "Sua agenda de amanhã ficou sem atendimentos.";
    const { contextoEmpresa } = await import("@/lib/mkt/contexto.server");
    const ctx = await contextoEmpresa(db, empresaId);
    if (!ctx.tokenRobo) throw new Error("robô do Chatwoot não configurado");
    const { enviarMensagem } = await import("@/lib/alice/chatwoot-api.server");
    await enviarMensagem(ctx.conta, ctx.tokenRobo, conv.chatwoot_conversation_id, texto);
    await db
      .from("agenda_tecnicos_envios")
      .update({
        situacao: "enviado",
        texto_enviado_em: new Date().toISOString(),
        servicos: mensagens.length,
      })
      .eq("id", envio.id);
    return true;
  } catch (e) {
    const motivo = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    // Volta para aguardando: a rotina tenta de novo no próximo minuto.
    await db
      .from("agenda_tecnicos_envios")
      .update({ situacao: "aguardando", motivo })
      .eq("id", envio.id);
    log("WARNING", "agenda_tecnicos.texto_erro", { empresa: empresaId, envio: envio.id, motivo });
    return false;
  }
}

/** A conversa recebeu a agenda nas últimas 36 h? (a resposta "Ver agenda" não vai para a Alice) */
export async function conversaDaAgenda(
  db: Db,
  empresaId: string,
  chatwootConversaId: number | null | undefined,
): Promise<boolean> {
  if (!chatwootConversaId) return false;
  const { data } = await db
    .from("agenda_tecnicos_envios")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", chatwootConversaId)
    .gte("created_at", new Date(Date.now() - 36 * 3600_000).toISOString())
    .limit(1);
  return Boolean(data?.length);
}

/** O número é de um técnico da empresa? (a Alice não responde ao técnico) */
export async function numeroEhDeTecnico(
  db: Db,
  empresaId: string,
  numero: string | null | undefined,
): Promise<boolean> {
  const chave = chaveTelefone(numero ?? "");
  if (chave.length < 10) return false;
  const { data } = await db
    .from("technicians")
    .select("telefone")
    .eq("empresa_id", empresaId)
    .not("telefone", "is", null);
  return (data ?? []).some((t) => t.telefone && chaveTelefone(t.telefone) === chave);
}

// ---------------------------------------------------------------- rotina (de 1 em 1 minuto)
export async function rotinaAgendaTecnicos(agora = new Date()) {
  const { dbServico } = await import("@/lib/mkt/contexto.server");
  const db = await dbServico();
  let enviados = 0;
  let textos = 0;
  let avisos = 0;
  let erros = 0;

  // 1) Envio do dia (só empresas com a agenda ligada, depois do horário configurado).
  const { data: cfgs } = await db
    .from("agenda_configuracoes")
    .select("empresa_id, agenda_tecnicos_hora")
    .eq("agenda_tecnicos_ativo", true);
  const dia = diaSeguinte(agoraSP(agora).dia);
  for (const cfg of cfgs ?? []) {
    if (!horaDeEnviar(cfg.agenda_tecnicos_hora, agora)) continue;
    try {
      const { data: operante } = await db.rpc("empresa_operante", { _emp: cfg.empresa_id });
      if (operante !== true) continue;
      const [tecnicos, porTecnico, { data: feitos }] = await Promise.all([
        tecnicosDaEmpresa(db, cfg.empresa_id),
        mensagensPorTecnico(db, cfg.empresa_id, dia),
        db
          .from("agenda_tecnicos_envios")
          .select("tecnico_id")
          .eq("empresa_id", cfg.empresa_id)
          .eq("dia_agenda", dia)
          .eq("teste", false),
      ]);
      const jaFeitos = new Set((feitos ?? []).map((f) => f.tecnico_id));
      const fila = tecnicos.filter(
        (t) =>
          t.active &&
          !t.parceiro &&
          t.recebe_agenda &&
          !jaFeitos.has(t.id) &&
          (porTecnico.get(t.id)?.length ?? 0) > 0,
      );
      for (const t of fila) {
        const r = await enviarAgenda(db, cfg.empresa_id, {
          tecnico: t,
          dia,
          mensagens: porTecnico.get(t.id) ?? [],
          teste: false,
          destino: null,
          criadoPor: null,
        });
        if (r.situacao === "erro") erros++;
        else if (r.situacao !== "ja_enviado") enviados++;
      }
    } catch (e) {
      erros++;
      log("WARNING", "agenda_tecnicos.rotina_erro", {
        empresa: cfg.empresa_id,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2) Resposta que o webhook não pegou e aviso das 7h (também para envios de teste: só o texto).
  const desde = new Date(agora.getTime() - 36 * 3600_000).toISOString();
  const { data: abertos } = await db
    .from("agenda_tecnicos_envios")
    .select(
      "id, empresa_id, tecnico_id, dia_agenda, conversa_id, situacao, aviso_nao_abriu_em, teste",
    )
    .eq("situacao", "aguardando")
    .gte("enviado_em", desde)
    .limit(200);
  for (const e of abertos ?? []) {
    try {
      const { data: conv } = await db
        .from("conversas")
        .select("id")
        .eq("empresa_id", e.empresa_id)
        .eq("chatwoot_conversation_id", e.conversa_id ?? -1)
        .maybeSingle();
      if (conv && (await responderPedidoDaAgenda(db, e.empresa_id, conv.id))) {
        textos++;
        continue;
      }
      if (precisaAvisoNaoAbriu(e, agora)) {
        const { data: t } = await db
          .from("technicians")
          .select("name")
          .eq("id", e.tecnico_id)
          .eq("empresa_id", e.empresa_id)
          .maybeSingle();
        await db.from("mkt_avisos").insert({
          empresa_id: e.empresa_id,
          tipo: "agenda_nao_abriu",
          titulo: "Agenda dos técnicos",
          mensagem: `Técnico ${t?.name ?? ""} não abriu a agenda de hoje.`.replace("  ", " "),
          so_no_app: true,
        });
        await db
          .from("agenda_tecnicos_envios")
          .update({ aviso_nao_abriu_em: agora.toISOString() })
          .eq("id", e.id);
        avisos++;
      }
    } catch (err) {
      erros++;
      log("WARNING", "agenda_tecnicos.pendente_erro", {
        envio: e.id,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { dia, enviados, textos, avisos, erros };
}
