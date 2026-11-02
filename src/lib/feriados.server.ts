/**
 * Feriados por empresa (02/11/2026), lado do servidor: leitura dos dias bloqueados (para a Alice,
 * a Tatiana e a agenda), semeadura do calendário padrão, decisão do admin e a rotina da Tatiana
 * (pergunta "vamos trabalhar?", lembrete, padrão na véspera e tarefas "remarcar" para atendimentos
 * marcados em feriado bloqueado). Nada aqui manda mensagem para cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  caiEmDiaUtil,
  diasBloqueados,
  etapaDaPergunta,
  somarDias,
  textoPergunta,
  textoRemarcarFeriado,
  type EtapaPergunta,
  type Feriado,
  type OrigemFeriado,
} from "./feriados";

type Db = SupabaseClient;

type Linha = {
  id: string;
  data: string;
  nome: string;
  origem: OrigemFeriado;
  trabalhamos: boolean | null;
  decidido_em: string | null;
  decidido_origem: "admin" | "padrao" | null;
};

const paraFeriado = (l: Linha): Feriado => ({
  id: l.id,
  data: l.data,
  nome: l.nome,
  origem: l.origem,
  trabalhamos: l.trabalhamos,
  decididoEm: l.decidido_em,
  decididoOrigem: l.decidido_origem,
});

const SELECT = "id, data, nome, origem, trabalhamos, decidido_em, decidido_origem";

/** Feriados da empresa entre duas datas (inclusive), em ordem. */
export async function feriadosNoPeriodo(
  db: Db,
  empresaId: string,
  de: string,
  ate: string,
): Promise<Feriado[]> {
  const { data, error } = await db
    .from("feriados")
    .select(SELECT)
    .eq("empresa_id", empresaId)
    .gte("data", de)
    .lte("data", ate)
    .order("data")
    .limit(200);
  if (error) throw new Error(`ler feriados: ${error.message}`);
  return ((data ?? []) as Linha[]).map(paraFeriado);
}

/** Dias bloqueados (feriado sem "vamos trabalhar") no período: data → nome. Erro vira vazio. */
export async function bloqueadosNoPeriodo(
  db: Db,
  empresaId: string,
  de: string,
  ate: string,
): Promise<Map<string, string>> {
  try {
    return diasBloqueados(await feriadosNoPeriodo(db, empresaId, de, ate));
  } catch {
    return new Map();
  }
}

/** Lista de dias bloqueados a partir de `de` (padrão 45 dias), para o horário útil das tarefas. */
export async function diasBloqueadosLista(
  db: Db,
  empresaId: string,
  de: string,
  dias = 45,
): Promise<string[]> {
  return [...(await bloqueadosNoPeriodo(db, empresaId, de, somarDias(de, dias))).keys()];
}

/** Garante o calendário padrão do ano (e do seguinte) na empresa; só insere o que falta. */
export async function semearFeriados(db: Db, empresaId: string, ano: number): Promise<void> {
  for (const a of [ano, ano + 1])
    await db.rpc("feriados_semear", { _empresa: empresaId, _ano: a }).then(({ error }) => {
      if (error) throw new Error(`semear feriados: ${error.message}`);
    });
}

/** Feriados de um ano (semeia antes, para a tela nunca vir vazia). */
export async function feriadosDoAno(db: Db, empresaId: string, ano: number): Promise<Feriado[]> {
  await semearFeriados(db, empresaId, ano).catch(() => undefined);
  return feriadosNoPeriodo(db, empresaId, `${ano}-01-01`, `${ano}-12-31`);
}

// ---------------------------------------------------------------- decisão

/**
 * Admin decide: "vamos trabalhar" (dia normal) ou "não vamos" (bloqueado). Bloqueando, os
 * atendimentos já marcados no dia viram tarefa "remarcar" para a equipe; liberando, as tarefas
 * "remarcar" que este feriado criou e ainda estão pendentes são canceladas.
 */
export async function decidirFeriado(
  db: Db,
  o: { empresaId: string; id: string; trabalhamos: boolean; userId: string | null; hoje: string },
): Promise<{ remarcar: number }> {
  const { data, error } = await db
    .from("feriados")
    .update({
      trabalhamos: o.trabalhamos,
      decidido_em: new Date().toISOString(),
      decidido_por: o.userId,
      decidido_origem: "admin",
    })
    .eq("id", o.id)
    .eq("empresa_id", o.empresaId)
    .select(SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Feriado não encontrado.");
  const f = paraFeriado(data as Linha);
  if (o.trabalhamos) {
    await db
      .from("crm_followups")
      .update({
        status: "Cancelada",
        result: "Feriado liberado",
        completed_at: new Date().toISOString(),
      })
      .eq("empresa_id", o.empresaId)
      .eq("origem", "gerente")
      .eq("status", "Pendente")
      .like("notes", `%[feriado:${f.id}:%`);
    return { remarcar: 0 };
  }
  return { remarcar: await remarcarDoFeriado(db, o.empresaId, f, o.hoje) };
}

/** Adiciona um feriado da empresa (origem "manual"); a data já existente só ganha o nome. */
export async function adicionarFeriado(
  db: Db,
  o: { empresaId: string; data: string; nome: string; userId: string | null },
): Promise<Feriado> {
  const { data, error } = await db
    .from("feriados")
    .upsert(
      {
        empresa_id: o.empresaId,
        data: o.data,
        nome: o.nome,
        origem: "manual",
        trabalhamos: false,
        decidido_em: new Date().toISOString(),
        decidido_por: o.userId,
        decidido_origem: "admin",
      },
      { onConflict: "empresa_id,data" },
    )
    .select(SELECT)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Não foi possível gravar o feriado.");
  return paraFeriado(data as Linha);
}

/** Remove um feriado adicionado pela empresa (os do calendário padrão só mudam de decisão). */
export async function removerFeriado(db: Db, empresaId: string, id: string): Promise<void> {
  const { error } = await db
    .from("feriados")
    .delete()
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .eq("origem", "manual");
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- tarefas "remarcar"

/**
 * Atendimentos ativos marcados no feriado bloqueado viram tarefa "remarcar" da equipe (uma por
 * visita, sem repetir: a marca [feriado:<id>:<visita>] fica nas notas). Sem lead ligado à OS, o
 * admin recebe um aviso com o número da OS.
 */
async function remarcarDoFeriado(
  db: Db,
  empresaId: string,
  f: Feriado,
  hoje: string,
): Promise<number> {
  if (f.data < hoje) return 0;
  const { data: vis } = await db
    .from("visits")
    .select("id, work_order_id, scheduled_time, status, work_order:work_order_id ( os_number )")
    .eq("empresa_id", empresaId)
    .eq("scheduled_date", f.data)
    .not("status", "in", "(Cancelado,Reagendado,Reagendado com deslocamento,Concluído)")
    .limit(50);
  const visitas = (vis ?? []) as unknown as Array<{
    id: string;
    work_order_id: string;
    scheduled_time: string | null;
    status: string;
    work_order: { os_number: string | number | null } | null;
  }>;
  if (!visitas.length) return 0;
  const { data: jaFeitas } = await db
    .from("crm_followups")
    .select("notes")
    .eq("empresa_id", empresaId)
    .eq("origem", "gerente")
    .like("notes", `%[feriado:${f.id}:%`)
    .limit(200);
  const marcas = new Set(
    ((jaFeitas ?? []) as Array<{ notes: string | null }>)
      .map((x) => /\[feriado:[^\]]+\]/.exec(x.notes ?? "")?.[0] ?? "")
      .filter(Boolean),
  );
  const { proximoHorarioUtil } = await import("@/lib/comercial/furos");
  const quando = proximoHorarioUtil(new Date().toISOString(), {
    dias: [1, 2, 3, 4, 5, 6],
    inicio: "08:00",
    fim: "19:00",
    bloqueados: [f.data],
  });
  let criadas = 0;
  const semLead: string[] = [];
  for (const v of visitas) {
    const marca = `[feriado:${f.id}:${v.id}]`;
    if (marcas.has(marca)) continue;
    const osNumero =
      v.work_order?.os_number === null ? null : String(v.work_order?.os_number ?? "");
    const { data: lead } = await db
      .from("crm_leads")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("linked_work_order_id", v.work_order_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const leadId = (lead as { id: string } | null)?.id ?? null;
    if (!leadId) {
      semLead.push(osNumero || "?");
      continue;
    }
    const { data: conversa } = await db
      .from("conversas")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("crm_lead_id", leadId)
      .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const t = textoRemarcarFeriado(f, osNumero || null);
    const { error } = await db.from("crm_followups").insert({
      empresa_id: empresaId,
      crm_lead_id: leadId,
      conversa_id: (conversa as { id: string } | null)?.id ?? null,
      scheduled_at: quando,
      status: "Pendente",
      origem: "gerente",
      responsavel: "equipe",
      trilha: "G",
      etapa: "G1",
      prioridade: 1,
      tarefa_tipo: "remarcar",
      motivo: t.motivo.slice(0, 300),
      mensagem: t.mensagem.slice(0, 1000),
      notes: `Tatiana: atendimento em feriado bloqueado ${marca}`.slice(0, 500),
    });
    if (!error) criadas++;
  }
  if (semLead.length)
    await avisarUmaVez(
      db,
      empresaId,
      "gerente_feriado",
      `Remarcar: atendimento em ${f.data.slice(8, 10)}/${f.data.slice(5, 7)} (${f.nome})`,
      `${semLead.length === 1 ? "A OS" : "As OS"} ${semLead.join(", ")} ${semLead.length === 1 ? "está marcada" : "estão marcadas"} no feriado bloqueado e não ${semLead.length === 1 ? "tem" : "têm"} lead no CRM para virar tarefa. Remarque pela agenda.`,
      `feriado:${f.id}:remarcar_sem_lead`,
    );
  return criadas;
}

// ---------------------------------------------------------------- avisos

async function avisarUmaVez(
  db: Db,
  empresaId: string,
  tipo: string,
  titulo: string,
  mensagem: string,
  referencia: string,
): Promise<boolean> {
  const { data: ja } = await db
    .from("mkt_avisos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("referencia", referencia)
    .limit(1);
  if (ja?.length) return false;
  const { error } = await db
    .from("mkt_avisos")
    .insert({ empresa_id: empresaId, tipo, titulo, mensagem, so_no_app: true, referencia });
  return !error;
}

/** Push só para os admins com celular que querem alertas de gerente, uma vez por referência. */
async function pushAdmins(
  db: Db,
  empresaId: string,
  ref: string,
  texto: { titulo: string; corpo: string },
): Promise<number> {
  const { pessoasComCelular, enviarParaPessoa, registrarUmaVez } =
    await import("@/lib/push/notificacoes.server");
  const { querReceber } = await import("@/lib/push/notificacoes");
  const pessoas = ((await pessoasComCelular(db as never, empresaId)).get(empresaId) ?? []).filter(
    (p) => p.papel === "admin" && querReceber("alerta_gerente", p.papel, p.pref),
  );
  let enviados = 0;
  for (const p of pessoas) {
    const id = await registrarUmaVez(
      db as never,
      empresaId,
      p.userId,
      "alerta_gerente",
      ref,
      texto.titulo,
    );
    if (!id) continue;
    const r = await enviarParaPessoa(db as never, p.celulares, {
      ...texto,
      url: "/gerente-comercial?aba=hoje",
      tag: `tatiana-${ref}`,
    });
    enviados += r.enviados;
  }
  return enviados;
}

// ---------------------------------------------------------------- rotina da Tatiana

/**
 * Das 8h às 20h (São Paulo), para cada empresa com a Tatiana ligada: semeia o calendário, faz a
 * pergunta/lembrete/padrão de cada feriado sem decisão e cria as tarefas "remarcar" dos feriados
 * bloqueados com atendimento marcado. Idempotente: avisos e pushes saem uma vez por referência.
 */
export async function rodarFeriadosDaTatiana(
  db: Db,
  empresas: Array<{ empresa_id: string; dias_uteis: number[] | null }>,
  hoje: string,
  horaSP: string,
): Promise<Record<string, unknown>> {
  if (horaSP < "08:00" || horaSP >= "20:00") return {};
  const saida: Record<string, unknown> = {};
  for (const { empresa_id: emp, dias_uteis: diasUteis } of empresas) {
    try {
      await semearFeriados(db, emp, Number(hoje.slice(0, 4))).catch(() => undefined);
      const lista = await feriadosNoPeriodo(db, emp, hoje, somarDias(hoje, 45));
      const feito: Record<string, EtapaPergunta | "remarcar"> = {};
      let pushes = 0;
      for (const f of lista) {
        // Feriado num dia em que a empresa não atende (ex.: domingo): nada a perguntar.
        const etapa = caiEmDiaUtil(f.data, diasUteis) ? etapaDaPergunta(f, hoje) : null;
        if (etapa) {
          if (etapa === "padrao")
            await db
              .from("feriados")
              .update({
                trabalhamos: false,
                decidido_em: new Date().toISOString(),
                decidido_origem: "padrao",
              })
              .eq("id", f.id)
              .is("trabalhamos", null);
          const t = textoPergunta(f, etapa);
          const ref = `feriado:${f.id}:${etapa}`;
          const novo = await avisarUmaVez(
            db,
            emp,
            "gerente_feriado",
            t.titulo,
            etapa === "padrao"
              ? t.corpo
              : `${t.corpo} Responda em Tatiana › Hoje ou em Configurações › Agenda › Feriados.`,
            ref,
          );
          if (novo) {
            pushes += await pushAdmins(db, emp, ref, t).catch(() => 0);
            feito[f.data] = etapa;
          }
        }
        if (f.trabalhamos === false || etapa === "padrao") {
          const n = await remarcarDoFeriado(db, emp, { ...f, trabalhamos: false }, hoje).catch(
            () => 0,
          );
          if (n) feito[`${f.data}:remarcar`] = "remarcar";
        }
      }
      if (Object.keys(feito).length || pushes)
        saida[`feriados_${emp.slice(0, 8)}`] = { ...feito, pushes };
    } catch (e) {
      saida[`feriados_${emp.slice(0, 8)}`] = { erro: e instanceof Error ? e.message : String(e) };
    }
  }
  return saida;
}
