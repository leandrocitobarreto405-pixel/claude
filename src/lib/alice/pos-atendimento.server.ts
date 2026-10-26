/**
 * Rotina da Alice depois do agendamento (roda na varredura, a cada 5 min): confirmação na véspera
 * e pós-venda no dia seguinte ao serviço, para TODAS as OS da empresa (agendadas pela Alice ou pela
 * equipe). Cada envio fica em ia_pos_atendimento (um por OS, tipo e dia), então nada sai duas
 * vezes. Só roda com a chave da empresa ligada (todas começam desligadas).
 *
 * Cliente escreveu nas últimas 24 h: texto livre; senão, o modelo aprovado. Depois do envio a
 * conversa volta para a Alice (mesmo se a equipe tinha assumido), que trata a resposta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chaveTelefone } from "@/lib/mkt/chatwoot.server";
import {
  SEM_LINK,
  STATUS_CONFIRMACAO,
  TEXTO_PADRAO,
  osElegivel,
  problemaNoModelo,
  diaDoServico,
  datasConfirmacao,
  datasPosVenda,
  dentroDe24h,
  estofadoPossessivo,
  janelaModelo,
  preencherCorpo,
  primeiroNome,
  type TipoPos,
} from "./pos-atendimento";

type Db = SupabaseClient;

type ConfigPos = {
  empresa_id: string;
  nome: string;
  confirmacao_ligada: boolean;
  confirmacao_hora: string;
  confirmacao_modelo: string | null;
  pos_venda_ligado: boolean;
  pos_venda_hora: string;
  pos_venda_modelo: string | null;
};

type Candidato = {
  workOrderId: string;
  osNumero: string;
  dataServico: string;
  hora: string | null;
  tecnicoId: string | null;
  cliente: string | null;
  telefone: string | null;
};

type Resumo = { enviados: number; ignorados: number; erros: number };

function agoraSP() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
}

export async function rodarPosAtendimento(): Promise<Resumo> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  const total: Resumo = { enviados: 0, ignorados: 0, erros: 0 };
  const { data: cfgs } = await db
    .from("ia_configuracoes")
    .select(
      "empresa_id, nome, confirmacao_ligada, confirmacao_hora, confirmacao_modelo, pos_venda_ligado, pos_venda_hora, pos_venda_modelo",
    )
    .eq("ativo", true)
    .or("confirmacao_ligada.eq.true,pos_venda_ligado.eq.true");
  const agora = agoraSP();
  const { empresaTemRecurso } = await import("@/lib/recursos.server");
  for (const cfg of (cfgs ?? []) as ConfigPos[]) {
    // Pós-atendimento é da Alice: plano sem Alice não envia.
    if (!(await empresaTemRecurso(supabaseAdmin, cfg.empresa_id, "alice"))) continue;
    for (const tipo of ["confirmacao", "pos_venda"] as const) {
      const ligado = tipo === "confirmacao" ? cfg.confirmacao_ligada : cfg.pos_venda_ligado;
      const hora = String(tipo === "confirmacao" ? cfg.confirmacao_hora : cfg.pos_venda_hora);
      if (!ligado || agora.hora < hora.slice(0, 5)) continue;
      const r = await processar(db, cfg, tipo, agora.data).catch((e) => {
        console.error("Alice pós-atendimento: falha", cfg.empresa_id, tipo, e);
        return { enviados: 0, ignorados: 0, erros: 1 };
      });
      total.enviados += r.enviados;
      total.ignorados += r.ignorados;
      total.erros += r.erros;
    }
  }
  return total;
}

type Visita = {
  id: string;
  work_order_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  completion_date: string | null;
  status: string;
  technician_id: string | null;
  work_order: {
    id: string;
    os_number: string;
    status: string | null;
    deleted_at: string | null;
    eh_teste: boolean | null;
    customer: { full_name: string | null; phone: string | null } | null;
  } | null;
};

const SELECT_VISITA =
  "id, work_order_id, scheduled_date, scheduled_time, completion_date, status, technician_id, work_order:work_order_id ( id, os_number, status, deleted_at, eh_teste, customer:customer_id ( full_name, phone ) )";

// OS excluída, cancelada ou de teste não recebe confirmação nem pós-venda.
const osAtiva = (v: Visita) => osElegivel(v.work_order);

/** OS com serviço amanhã (confirmação) ou concluídas ontem (pós-venda), uma por OS e dia. */
async function candidatos(
  db: Db,
  empresaId: string,
  tipo: TipoPos,
  hoje: string,
): Promise<Candidato[]> {
  const datas = tipo === "confirmacao" ? datasConfirmacao(hoje) : datasPosVenda(hoje);
  if (!datas.length) return [];
  const porOs = new Map<string, Candidato>();
  if (tipo === "confirmacao") {
    const { data } = await db
      .from("visits")
      .select(SELECT_VISITA)
      .eq("empresa_id", empresaId)
      .in("scheduled_date", datas)
      // "Reagendado" também: a visita remarcada precisa da confirmação na véspera.
      .in("status", STATUS_CONFIRMACAO)
      .order("scheduled_time");
    for (const v of (data ?? []) as unknown as Visita[]) {
      if (!osAtiva(v)) continue;
      const chave = `${v.work_order_id}:${v.scheduled_date}`;
      if (porOs.has(chave)) continue;
      porOs.set(chave, {
        workOrderId: v.work_order_id,
        osNumero: v.work_order!.os_number,
        dataServico: v.scheduled_date,
        hora: v.scheduled_time ? String(v.scheduled_time).slice(0, 5) : null,
        tecnicoId: v.technician_id,
        cliente: v.work_order!.customer?.full_name ?? null,
        telefone: v.work_order!.customer?.phone ?? null,
      });
    }
    return [...porOs.values()];
  }
  // Pós-venda: todos os atendimentos (não cancelados) da OS concluídos, o último no dia.
  const { data: concluidas } = await db
    .from("visits")
    .select("work_order_id")
    .eq("empresa_id", empresaId)
    .eq("status", "Concluído")
    .in("completion_date", datas);
  const ids = [...new Set((concluidas ?? []).map((v) => v.work_order_id as string))];
  if (!ids.length) return [];
  const { data: todas } = await db
    .from("visits")
    .select(SELECT_VISITA)
    .eq("empresa_id", empresaId)
    .in("work_order_id", ids);
  const grupos = new Map<string, Visita[]>();
  for (const v of (todas ?? []) as unknown as Visita[]) {
    if (v.status === "Cancelado") continue;
    grupos.set(v.work_order_id, [...(grupos.get(v.work_order_id) ?? []), v]);
  }
  for (const [id, vs] of grupos) {
    if (!osAtiva(vs[0]!) || vs.some((v) => v.status !== "Concluído")) continue;
    const ultima = vs.reduce((a, b) =>
      (a.completion_date ?? "") >= (b.completion_date ?? "") ? a : b,
    );
    if (!ultima.completion_date || !datas.includes(ultima.completion_date)) continue;
    porOs.set(id, {
      workOrderId: id,
      osNumero: ultima.work_order!.os_number,
      dataServico: ultima.completion_date,
      hora: null,
      tecnicoId: ultima.technician_id,
      cliente: ultima.work_order!.customer?.full_name ?? null,
      telefone: ultima.work_order!.customer?.phone ?? null,
    });
  }
  return [...porOs.values()];
}

/** Contato do WhatsApp pelo telefone (com ou sem o 9º dígito). */
async function contatoDoTelefone(db: Db, empresaId: string, fone: string) {
  const chave = chaveTelefone(fone);
  const { data } = await db
    .from("whatsapp_contacts")
    .select("id, ia_desligada, normalized_phone, nome_confirmado")
    .eq("empresa_id", empresaId)
    .like("normalized_phone", `%${fone.slice(-8)}`)
    .limit(10);
  return (
    (
      (data ?? []) as Array<{
        id: string;
        ia_desligada: boolean;
        normalized_phone: string;
        nome_confirmado: string | null;
      }>
    ).find((c) => chaveTelefone(c.normalized_phone) === chave) ?? null
  );
}

/** Transferência por garantia ou reclamação ainda em aberto (repescagem pendente da equipe). */
async function garantiaEmAberto(db: Db, empresaId: string, contatoId: string): Promise<boolean> {
  const { data: leads } = await db
    .from("crm_leads")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("whatsapp_contact_id", contatoId);
  const ids = (leads ?? []).map((l) => l.id as string);
  if (!ids.length) return false;
  const { count } = await db
    .from("crm_followups")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .in("crm_lead_id", ids)
    .eq("status", "Pendente")
    .or("notes.ilike.%garantia%,notes.ilike.%reclama%");
  return (count ?? 0) > 0;
}

async function processar(db: Db, cfg: ConfigPos, tipo: TipoPos, hoje: string): Promise<Resumo> {
  const r: Resumo = { enviados: 0, ignorados: 0, erros: 0 };
  const lista = await candidatos(db, cfg.empresa_id, tipo, hoje);
  if (!lista.length) return r;
  const { data: feitos } = await db
    .from("ia_pos_atendimento")
    .select("work_order_id, data_servico")
    .eq("empresa_id", cfg.empresa_id)
    .eq("tipo", tipo)
    .in(
      "work_order_id",
      lista.map((c) => c.workOrderId),
    );
  const ja = new Set((feitos ?? []).map((f) => `${f.work_order_id}:${f.data_servico}`));
  for (const c of lista.slice(0, 30)) {
    if (ja.has(`${c.workOrderId}:${c.dataServico}`)) continue;
    const res = await enviarUm(db, cfg, tipo, hoje, c).catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .from("ia_pos_atendimento")
        .update({ situacao: "erro", motivo: msg.slice(0, 300) })
        .eq("work_order_id", c.workOrderId)
        .eq("tipo", tipo)
        .eq("data_servico", c.dataServico);
      await avisarEquipe(db, cfg.empresa_id, tipo, c, msg);
      return "erro" as const;
    });
    if (res === "enviado") r.enviados++;
    else if (res === "ignorado") r.ignorados++;
    else if (res === "erro") r.erros++;
  }
  return r;
}

const ROTULO: Record<TipoPos, string> = { confirmacao: "Confirmação", pos_venda: "Pós-venda" };

async function avisarEquipe(
  db: Db,
  empresaId: string,
  tipo: TipoPos,
  c: Candidato,
  motivo: string,
) {
  await db.from("mkt_avisos").insert({
    empresa_id: empresaId,
    tipo: "pos_atendimento_alice",
    titulo: `${ROTULO[tipo]} da OS ${c.osNumero} não enviada`,
    mensagem: `${motivo.slice(0, 300)}. Fale com o cliente pelo Chatwoot, se precisar.`,
  } as never);
}

/** Reserva o envio (a linha única impede que duas varreduras mandem a mesma mensagem). */
async function reservar(
  db: Db,
  empresaId: string,
  tipo: TipoPos,
  c: Candidato,
  situacao: "enviado" | "ignorado",
  motivo: string | null,
): Promise<boolean> {
  const { data } = await db
    .from("ia_pos_atendimento")
    .upsert(
      {
        empresa_id: empresaId,
        work_order_id: c.workOrderId,
        tipo,
        data_servico: c.dataServico,
        situacao,
        motivo,
      },
      { onConflict: "work_order_id,tipo,data_servico", ignoreDuplicates: true },
    )
    .select("id");
  return Boolean(data?.length);
}

async function enviarUm(
  db: Db,
  cfg: ConfigPos,
  tipo: TipoPos,
  hoje: string,
  c: Candidato,
): Promise<"enviado" | "ignorado" | "pulado"> {
  const digitos = (c.telefone ?? "").replace(/\D/g, "");
  const fone = digitos.length <= 11 ? `55${digitos}` : digitos;
  const ignorar = async (motivo: string) =>
    (await reservar(db, cfg.empresa_id, tipo, c, "ignorado", motivo)) ? "ignorado" : "pulado";
  if (digitos.length < 10) return ignorar("cliente sem telefone válido");
  const contato = await contatoDoTelefone(db, cfg.empresa_id, fone);
  if (contato?.ia_desligada) return ignorar("Alice tirada desta cliente");
  if (contato && (await garantiaEmAberto(db, cfg.empresa_id, contato.id)))
    return ignorar("transferência por garantia/reclamação em aberto");
  if (!(await reservar(db, cfg.empresa_id, tipo, c, "enviado", null))) return "pulado";

  // Variáveis: nome e janela (confirmação); nome, link, técnico e estofado (pós-venda).
  // Nome confirmado do contato (o cliente disse / perfil aceito); senão, o da OS.
  const nome = primeiroNome(contato?.nome_confirmado || c.cliente) || "tudo bem";
  let vars: string[];
  let semLink = false;
  if (tipo === "confirmacao") {
    if (!c.hora) throw new Error("atendimento sem horário");
    vars = [nome, diaDoServico(hoje, c.dataServico), janelaModelo(c.hora)];
  } else {
    const [link, tecnico, estofado] = await Promise.all([
      linkDaPasta(db, cfg.empresa_id, c.workOrderId),
      nomeDoTecnico(db, c.tecnicoId),
      estofadoDaOs(db, c.workOrderId),
    ]);
    semLink = !link;
    vars = [nome, link ?? SEM_LINK, tecnico || "técnico", estofado];
  }

  const ultima = contato ? await ultimaDoCliente(db, cfg.empresa_id, contato.id) : null;
  const livre = dentroDe24h(ultima, new Date());
  const { contextoEmpresa } = await import("@/lib/mkt/contexto.server");
  const ctx = await contextoEmpresa(db, cfg.empresa_id);
  if (!ctx.tokenAdmin || !ctx.tokenRobo) throw new Error("tokens do Chatwoot não configurados");

  let texto: string;
  let params: Record<string, unknown> | null = null;
  if (livre) {
    texto = preencherCorpo(TEXTO_PADRAO[tipo], vars);
  } else {
    const nomeModelo = tipo === "confirmacao" ? cfg.confirmacao_modelo : cfg.pos_venda_modelo;
    if (!nomeModelo) throw new Error("modelo não configurado nas Configurações da Alice");
    const { modelosAtualizados } = await import("@/lib/mkt/modelos-situacao.server");
    const { situacaoModelo, templateParams } = await import("@/lib/mkt/modelos");
    const { modelos } = await modelosAtualizados(db, cfg.empresa_id, {
      ctx,
      precisa: [nomeModelo],
      idioma: ctx.cfg.template_idioma,
    });
    const sit = situacaoModelo(modelos, nomeModelo, ctx.cfg.template_idioma);
    if (!sit.ok) throw new Error(sit.erro);
    const corpo = sit.modelo.components?.find((x) => x.type?.toUpperCase() === "BODY")?.text ?? "";
    // Modelo antigo (com "amanhã"/"ontem" fixos ou outras variáveis) nunca é usado.
    const problema = problemaNoModelo(tipo, nomeModelo, corpo);
    if (problema) throw new Error(problema);
    const preenchido = preencherCorpo(corpo, vars);
    texto = preenchido;
    params = templateParams(
      sit.modelo,
      Object.fromEntries(vars.map((v, i) => [String(i + 1), v])),
    ) as Record<string, unknown>;
  }

  const { garantirContato, conversaExistente, criarConversa, enviarModelo } =
    await import("@/lib/mkt/chatwoot.server");
  const { enviarMensagem, mudarSituacao } = await import("./chatwoot-api.server");
  const cw = await garantirContato(ctx.conta, ctx.tokenAdmin, ctx.caixa, fone, nome, null);
  const conversa =
    (await conversaExistente(ctx.conta, ctx.tokenAdmin, cw.id, ctx.caixa)) ??
    (await criarConversa(ctx.conta, ctx.tokenRobo, ctx.caixa, cw, fone, "pending"));
  if (params) await enviarModelo(ctx.conta, ctx.tokenRobo, conversa, texto, params);
  else await enviarMensagem(ctx.conta, ctx.tokenRobo, conversa, texto);
  if (semLink)
    await enviarMensagem(
      ctx.conta,
      ctx.tokenRobo,
      conversa,
      `🤖 Pós-venda da OS ${c.osNumero} enviado sem o link da pasta (sem pasta ou sem fotos/vídeos). Mande o link quando estiver pronto.`,
      true,
    );
  // A conversa volta para a Alice, que trata a resposta (mesmo se a equipe tinha assumido).
  await mudarSituacao(ctx.conta, ctx.tokenRobo, conversa, "pending").catch(() => undefined);
  const { data: conv } = await db
    .from("conversas")
    .update({ status: "pending", devolvida_para_alice_em: new Date().toISOString() })
    .eq("empresa_id", cfg.empresa_id)
    .eq("chatwoot_conversation_id", conversa)
    .select("id")
    .maybeSingle();
  await db
    .from("ia_pos_atendimento")
    .update({
      via: params ? "modelo" : "texto",
      chatwoot_conversation_id: conversa,
      conversa_id: conv?.id ?? null,
      mensagem: texto.slice(0, 2000),
      enviado_em: new Date().toISOString(),
    })
    .eq("work_order_id", c.workOrderId)
    .eq("tipo", tipo)
    .eq("data_servico", c.dataServico);
  await db.from("work_order_history").insert({
    empresa_id: cfg.empresa_id,
    work_order_id: c.workOrderId,
    event_type: "Edição",
    description: `${cfg.nome} (IA) enviou a ${tipo === "confirmacao" ? "confirmação do serviço" : "mensagem de pós-venda"} pelo WhatsApp${params ? " (modelo)" : ""}.`,
    details: { pos_atendimento: tipo, chatwoot_conversation_id: conversa } as never,
  });
  return "enviado";
}

async function ultimaDoCliente(db: Db, empresaId: string, contatoId: string): Promise<Date | null> {
  const { data } = await db
    .from("whatsapp_messages")
    .select("message_timestamp")
    .eq("empresa_id", empresaId)
    .eq("whatsapp_contact_id", contatoId)
    .eq("direction", "Recebida")
    .eq("privada", false)
    .order("message_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? new Date(data.message_timestamp as string) : null;
}

async function nomeDoTecnico(db: Db, tecnicoId: string | null): Promise<string> {
  if (!tecnicoId) return "";
  const { data } = await db.from("technicians").select("name").eq("id", tecnicoId).maybeSingle();
  return primeiroNome(data?.name as string | undefined);
}

async function estofadoDaOs(db: Db, workOrderId: string): Promise<string> {
  const { data: visitas } = await db
    .from("visits")
    .select("id")
    .eq("work_order_id", workOrderId)
    .neq("status", "Cancelado");
  const ids = (visitas ?? []).map((v) => v.id as string);
  if (!ids.length) return "os seus estofados";
  const { data: itens } = await db
    .from("service_items")
    .select("description, quantity, item_group_id, upholstery_type:upholstery_type_id ( name )")
    .in("visit_id", ids)
    .eq("active", true);
  // O mesmo item nos dois serviços (mesmo grupo) conta uma vez só.
  const porGrupo = new Map<string, { descricao: string; quantidade: number }>();
  for (const i of (itens ?? []) as unknown as Array<{
    description: string | null;
    quantity: number;
    item_group_id: string | null;
    upholstery_type: { name: string } | null;
  }>) {
    const chave = i.item_group_id ?? crypto.randomUUID();
    if (porGrupo.has(chave)) continue;
    porGrupo.set(chave, {
      descricao: `${i.description ?? ""} ${i.upholstery_type?.name ?? ""}`,
      quantidade: Number(i.quantity) || 1,
    });
  }
  return estofadoPossessivo([...porGrupo.values()]);
}

/** Link da pasta do cliente (qualquer pessoa com o link: leitor), só se tiver fotos ou vídeos. */
async function linkDaPasta(db: Db, empresaId: string, workOrderId: string): Promise<string | null> {
  const { data: pasta } = await db
    .from("os_drive_folders")
    .select("materials_folder_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (!pasta?.materials_folder_id) return null;
  const { count } = await db
    .from("os_drive_files")
    .select("id", { count: "exact", head: true })
    .eq("work_order_id", workOrderId)
    .in("destination", ["Antes", "Depois", "Vídeos"]);
  if (!count) return null;
  try {
    const { executarNaEmpresa } = await import("@/lib/request-db.server");
    const { getCustomerFolderLink } = await import("@/lib/os-media.server");
    const r = await executarNaEmpresa({ db: db as never, empresaId, userId: "" }, () =>
      getCustomerFolderLink(workOrderId),
    );
    return r.url;
  } catch (e) {
    console.error("Alice pós-venda: link da pasta não saiu", e);
    return null;
  }
}
