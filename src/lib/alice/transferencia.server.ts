/**
 * Transferência da Alice com prazo e alarme (plano "Alice e vendas", item 7): registra a
 * transferência, manda o push de 5 em 5 minutos enquanto ninguém responde (no horário de
 * atendimento) e fecha quando a equipe responde. Só liga com ia_configuracoes.alarme_transferencia.
 * Nada aqui manda mensagem para cliente: os pushes vão só para a equipe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { horarioDaConfig, type HorarioUtil } from "@/lib/comercial/furos";
import { querReceber } from "@/lib/push/notificacoes";
import { avisadorReal, registrarEvento, type Avisador } from "./avisos.server";
import {
  categoriaDoMotivo,
  horaDoAlarme,
  minutosEsperando,
  prazoDaTransferencia,
  respostaDaEquipe,
  textoDoAlarme,
  type MensagemDaConversa,
  type PrazoDaTransferencia,
} from "./transferencia";

type Db = SupabaseClient;

const diaSP = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
/** Depois deste tempo sem resposta o alarme desiste (a transferência continua na lista). */
const DESISTE_MS = 3 * 86_400_000;

/** Horário de atendimento da empresa (Configurações), com os feriados bloqueados. */
export async function horarioDaEmpresa(
  db: Db,
  empresaId: string,
  agora: Date,
): Promise<HorarioUtil> {
  const [{ data: cfg }, bloqueados] = await Promise.all([
    db
      .from("comercial_configuracoes")
      .select("dias_uteis, hora_inicio, hora_fim")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    (async () => {
      const { diasBloqueadosLista } = await import("@/lib/feriados.server");
      return diasBloqueadosLista(db as never, empresaId, diaSP(agora), 15);
    })().catch(() => [] as string[]),
  ]);
  return horarioDaConfig(
    cfg as { dias_uteis?: number[] | null; hora_inicio?: string | null; hora_fim?: string | null },
    bloqueados,
  );
}

/** O prazo que a Alice vai dizer ao cliente nesta transferência. */
export async function prazoParaTransferir(
  db: Db,
  empresaId: string,
  prazoMin: number,
  agora = new Date(),
): Promise<PrazoDaTransferencia> {
  return prazoDaTransferencia(agora, await horarioDaEmpresa(db, empresaId, agora), prazoMin);
}

/**
 * Grava a transferência (uma em aberto por conversa: se já houver, só atualiza o motivo e o resumo)
 * e o evento da medição. Nunca derruba a passagem: erro vira aviso no log.
 */
export async function registrarTransferencia(
  db: Db,
  o: {
    empresaId: string;
    conversaId: string;
    leadId: string | null;
    motivo: string;
    resumo: string | null;
    valorSugerido?: number | null;
    prazo: PrazoDaTransferencia;
    tarefaId?: string | null;
  },
): Promise<void> {
  try {
    const campos = {
      motivo: o.motivo.slice(0, 200) || "atendimento humano",
      resumo: o.resumo?.slice(0, 2000) ?? null,
      valor_sugerido: o.valorSugerido ?? null,
      prazo_em: o.prazo.prazoEm,
      fora_do_horario: o.prazo.foraDoHorario,
      ...(o.tarefaId ? { tarefa_id: o.tarefaId } : {}),
    };
    const { data: aberta } = await db
      .from("alice_transferencias")
      .select("id")
      .eq("empresa_id", o.empresaId)
      .eq("conversa_id", o.conversaId)
      .is("respondida_em", null)
      .maybeSingle();
    const id = (aberta as { id?: string } | null)?.id;
    const { error } = id
      ? await db.from("alice_transferencias").update(campos).eq("id", id)
      : await db.from("alice_transferencias").insert({
          empresa_id: o.empresaId,
          conversa_id: o.conversaId,
          crm_lead_id: o.leadId,
          ...campos,
        });
    if (error) throw new Error(error.message);
    await registrarEvento(db, {
      empresa_id: o.empresaId,
      tipo: "transferencia",
      conversa_id: o.conversaId,
      crm_lead_id: o.leadId,
      dados: { categoria: categoriaDoMotivo(o.motivo), fora_do_horario: o.prazo.foraDoHorario },
    });
  } catch (e) {
    console.error("Alice: transferência não registrada", e instanceof Error ? e.message : e);
  }
}

type Aberta = {
  id: string;
  empresa_id: string;
  conversa_id: string;
  crm_lead_id: string | null;
  motivo: string;
  criada_em: string;
  prazo_em: string | null;
  fora_do_horario: boolean;
  ultimo_push_em: string | null;
  pushes: number;
};

const SELECT_ABERTA =
  "id, empresa_id, conversa_id, crm_lead_id, motivo, criada_em, prazo_em, fora_do_horario, ultimo_push_em, pushes";

async function fechar(db: Db, t: Aberta, quando: string, motivo: "respondida" | "saiu_da_fila") {
  await db
    .from("alice_transferencias")
    .update({ respondida_em: quando })
    .eq("id", t.id)
    .is("respondida_em", null);
  await registrarEvento(db, {
    empresa_id: t.empresa_id,
    tipo: motivo === "respondida" ? "transferencia_respondida" : "transferencia_encerrada",
    conversa_id: t.conversa_id,
    crm_lead_id: t.crm_lead_id,
    dados: {
      categoria: categoriaDoMotivo(t.motivo),
      fora_do_horario: t.fora_do_horario,
      segundos: Math.max(0, Math.round((Date.parse(quando) - Date.parse(t.criada_em)) / 1000)),
      pushes: t.pushes,
    },
  });
}

/** Chamada pela varredura do servidor (a cada 5 minutos). */
export async function rodarAlarmeDeTransferencias(
  agora = new Date(),
): Promise<{ abertas: number; respondidas: number; pushes: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  return alarmeDeTransferencias(db, agora, await avisadorReal(db));
}

/** O alarme em si, com o banco e o envio de push recebidos de fora (testável). */
export async function alarmeDeTransferencias(
  db: Db,
  agora: Date,
  avisador: Avisador,
  horarioDe: (empresaId: string) => Promise<HorarioUtil> = (emp) =>
    horarioDaEmpresa(db, emp, agora),
): Promise<{ abertas: number; respondidas: number; pushes: number }> {
  const saida = { abertas: 0, respondidas: 0, pushes: 0 };
  const { data } = await db
    .from("alice_transferencias")
    .select(SELECT_ABERTA)
    .is("respondida_em", null)
    .order("criada_em")
    .limit(200);
  const abertas = (data ?? []) as Aberta[];
  if (!abertas.length) return saida;
  saida.abertas = abertas.length;
  const empresas = [...new Set(abertas.map((t) => t.empresa_id))];
  const { data: cfgs } = await db
    .from("ia_configuracoes")
    .select("empresa_id, alarme_transferencia")
    .in("empresa_id", empresas);
  const ligado = new Set(
    ((cfgs ?? []) as Array<{ empresa_id: string; alarme_transferencia: boolean }>)
      .filter((c) => c.alarme_transferencia)
      .map((c) => c.empresa_id),
  );
  for (const emp of empresas) {
    const horario = await horarioDe(emp);
    const pessoas = ligado.has(emp)
      ? (await avisador.pessoas(emp)).filter((p) =>
          // Segue a chave "Cliente esperando a equipe" de cada pessoa (admin e atendente).
          querReceber("cliente_esperando", p.papel, p.pref),
        )
      : [];
    for (const t of abertas.filter((x) => x.empresa_id === emp)) {
      const [{ data: msgs }, { data: conv }] = await Promise.all([
        db
          .from("whatsapp_messages")
          .select("direction, remetente_tipo, privada, message_timestamp")
          .eq("empresa_id", emp)
          .eq("conversa_id", t.conversa_id)
          .gt("message_timestamp", t.criada_em)
          .order("message_timestamp")
          .limit(200),
        db
          .from("conversas")
          .select(
            "status, encerrada_em, contato:whatsapp_contact_id ( profile_name, nome_confirmado, display_phone )",
          )
          .eq("id", t.conversa_id)
          .maybeSingle(),
      ]);
      const resposta = respostaDaEquipe((msgs ?? []) as MensagemDaConversa[], t.criada_em);
      if (resposta) {
        await fechar(db, t, resposta, "respondida");
        saida.respondidas++;
        continue;
      }
      const c = conv as unknown as {
        status: string | null;
        encerrada_em: string | null;
        contato: {
          profile_name: string | null;
          nome_confirmado: string | null;
          display_phone: string | null;
        } | null;
      } | null;
      // A conversa voltou para a Alice, foi encerrada ou não existe mais: o alarme não faz sentido.
      if (!c || c.encerrada_em || (c.status !== "open" && c.status !== null)) {
        await fechar(db, t, agora.toISOString(), "saiu_da_fila");
        continue;
      }
      if (!pessoas.length || agora.getTime() - Date.parse(t.criada_em) > DESISTE_MS) continue;
      const aberta = {
        criadaEm: t.criada_em,
        prazoEm: t.prazo_em,
        foraDoHorario: t.fora_do_horario,
        ultimoPushEm: t.ultimo_push_em,
      };
      if (!horaDoAlarme(aberta, agora, horario)) continue;
      const texto = textoDoAlarme({
        nome: (c.contato?.nome_confirmado || c.contato?.profile_name || "").split(/\s+/)[0] ?? "",
        final: (c.contato?.display_phone ?? "").replace(/\D/g, "").slice(-4),
        motivo: t.motivo,
        minutos: minutosEsperando(aberta, agora),
        foraDoHorario: t.fora_do_horario && !t.ultimo_push_em,
      });
      let enviados = 0;
      for (const p of pessoas)
        enviados += await avisador.enviar({
          empresaId: emp,
          userId: p.userId,
          tipo: "transferencia_alice",
          ref: `${t.id}:${t.pushes + 1}`,
          titulo: texto.titulo,
          corpo: texto.corpo,
          url: `/conversas/${t.conversa_id}`,
          tag: `transferencia-${t.id}`,
        });
      await db
        .from("alice_transferencias")
        .update({ ultimo_push_em: agora.toISOString(), pushes: t.pushes + 1 })
        .eq("id", t.id);
      saida.pushes += enviados;
    }
  }
  return saida;
}

export type TransferenciaNaTela = {
  id: string;
  conversaId: string;
  nome: string;
  telefoneFinal: string;
  motivo: string;
  criadaEm: string;
  foraDoHorario: boolean;
  /** Minutos sem resposta (no horário, desde a transferência; fora dele, desde a abertura). */
  minutos: number;
};

/** Transferências da Alice ainda sem resposta da equipe (bloco vermelho de Follow-ups). */
export async function transferenciasAbertas(
  db: Db,
  empresaId: string,
  agora = new Date(),
): Promise<TransferenciaNaTela[]> {
  const { data } = await db
    .from("alice_transferencias")
    .select(
      `${SELECT_ABERTA}, conversa:conversa_id ( contato:whatsapp_contact_id ( profile_name, nome_confirmado, display_phone ) )`,
    )
    .eq("empresa_id", empresaId)
    .is("respondida_em", null)
    .order("criada_em")
    .limit(50);
  return (
    (data ?? []) as unknown as Array<
      Aberta & {
        conversa: {
          contato: {
            profile_name: string | null;
            nome_confirmado: string | null;
            display_phone: string | null;
          } | null;
        } | null;
      }
    >
  ).map((t) => ({
    id: t.id,
    conversaId: t.conversa_id,
    nome: t.conversa?.contato?.nome_confirmado || t.conversa?.contato?.profile_name || "Cliente",
    telefoneFinal: (t.conversa?.contato?.display_phone ?? "").replace(/\D/g, "").slice(-4),
    motivo: t.motivo,
    criadaEm: t.criada_em,
    foraDoHorario: t.fora_do_horario,
    minutos: minutosEsperando(
      {
        criadaEm: t.criada_em,
        prazoEm: t.prazo_em,
        foraDoHorario: t.fora_do_horario,
        ultimoPushEm: t.ultimo_push_em,
      },
      agora,
    ),
  }));
}

export type ResumoDaAlice = {
  motivo: string;
  resumo: string | null;
  criadaEm: string;
  prazoEm: string | null;
  foraDoHorario: boolean;
  respondidaEm: string | null;
};

/** A última transferência da conversa (até 3 dias), para o resumo no topo da conversa. */
export async function resumoDaAlice(
  db: Db,
  empresaId: string,
  conversaId: string,
): Promise<ResumoDaAlice | null> {
  const { data } = await db
    .from("alice_transferencias")
    .select("motivo, resumo, criada_em, prazo_em, fora_do_horario, respondida_em")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .gte("criada_em", new Date(Date.now() - DESISTE_MS).toISOString())
    .order("criada_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const t = data as {
    motivo: string;
    resumo: string | null;
    criada_em: string;
    prazo_em: string | null;
    fora_do_horario: boolean;
    respondida_em: string | null;
  } | null;
  return t
    ? {
        motivo: t.motivo,
        resumo: t.resumo,
        criadaEm: t.criada_em,
        prazoEm: t.prazo_em,
        foraDoHorario: t.fora_do_horario,
        respondidaEm: t.respondida_em,
      }
    : null;
}
