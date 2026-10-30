/**
 * Rotina das notificações no celular (roda a cada minuto, junto com o disparo do marketing).
 * Para cada pessoa com celular ativado: vê o que aconteceu (cliente esperando, serviço concluído,
 * campanha esperando aprovação, agendamento da promoção, resumo das 9h), respeita o papel e as
 * preferências, e não repete a mesma notificação (push_envios). Não usa WhatsApp.
 */
import { linhaToquesD1, textoResumoDoDia } from "@/lib/avisos";
import { chaveTelefone } from "@/lib/avisos";
import { dbServico, log, type Db } from "@/lib/mkt/contexto.server";
import type { Papel } from "@/lib/tenant";
import {
  PREFERENCIAS_PADRAO,
  avisoAgrupadoDeEsperas,
  inscricaoMorta,
  horaDoResumo,
  notificacaoAgendamentoAlice,
  notificacaoCampanha,
  notificacaoConcluido,
  notificacaoPromocao,
  notificacaoResumo,
  notificacaoResumoTecnico,
  tecnicoDoUsuario,
  querReceber,
  urlSegura,
  type EsperaPush,
  type Notificacao,
  type PreferenciasPush,
  type TipoPush,
} from "./notificacoes";
import { enviarPush, endpointPermitido } from "./webpush.server";
import { esperaDeVerdade } from "@/lib/conversas-espera";

type Inscrito = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Uuid que o aparelho devolve ao receber (sw.js → /api/public/push/recibo). */
  recibo?: string | null;
};
type Pessoa = { userId: string; papel: Papel; pref: PreferenciasPush; celulares: Inscrito[] };

const MAX_POR_RODADA = 60;

/** Envia para todos os celulares da pessoa. Celular que cancelou sai da lista. */
export async function enviarParaPessoa(
  db: Db,
  celulares: Inscrito[],
  n: Notificacao,
): Promise<{ enviados: number; falhas: number }> {
  let enviados = 0;
  let falhas = 0;
  const nota = { ...n, url: urlSegura(n.url) };
  for (const c of celulares) {
    if (!endpointPermitido(c.endpoint)) continue;
    try {
      const r = await enviarPush(c, { ...nota, ...(c.recibo ? { recibo: c.recibo } : {}) });
      // Guarda o status devolvido (Apple/Google) e conta os envios até o aparelho confirmar.
      await db.rpc("push_registrar_envio" as never, { _id: c.id, _status: r.status } as never);
      if (r.ok) {
        enviados++;
      } else if (r.expirada) {
        falhas++;
        await db.from("push_inscricoes").delete().eq("id", c.id);
      } else {
        falhas++;
        log("WARNING", "push.falha", { inscricao: c.id, status: r.status });
      }
    } catch (e) {
      falhas++;
      log("WARNING", "push.erro", {
        inscricao: c.id,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { enviados, falhas };
}

/** Registra antes de enviar: se já existia (mesmo tipo e referência), não envia de novo. */
export async function registrarUmaVez(
  db: Db,
  empresaId: string,
  userId: string,
  tipo: TipoPush,
  ref: string,
  titulo: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("push_envios")
    .upsert(
      { empresa_id: empresaId, user_id: userId, tipo, ref, titulo },
      { onConflict: "empresa_id,user_id,tipo,ref", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

export type { Pessoa };

/** Pessoas com celular ativado, por empresa (ou só de uma empresa). */
export async function pessoasComCelular(
  db: Db,
  empresaId?: string,
): Promise<Map<string, Pessoa[]>> {
  let consulta = db
    .from("push_inscricoes")
    .select(
      "id, empresa_id, user_id, endpoint, p256dh, auth, recibo, created_at, confirmado_em, envios_sem_recibo",
    );
  if (empresaId) consulta = consulta.eq("empresa_id", empresaId);
  const { data: todas } = await consulta;
  const porEmpresa = new Map<string, Pessoa[]>();
  // Inscrição morta (muitos envios aceitos e nenhum recibo do aparelho): sai da lista.
  const mortas = (todas ?? []).filter((i) => inscricaoMorta(i));
  if (mortas.length) {
    await db
      .from("push_inscricoes")
      .delete()
      .in(
        "id",
        mortas.map((i) => i.id),
      );
    log("INFO", "push.inscricoes_mortas", { removidas: mortas.length });
  }
  const inscricoes = (todas ?? []).filter((i) => !mortas.includes(i));
  if (!inscricoes.length) return porEmpresa;
  const users = [...new Set(inscricoes.map((i) => i.user_id))];
  const [{ data: papeis }, { data: prefs }] = await Promise.all([
    db.from("usuarios_empresa").select("empresa_id, user_id, papel").in("user_id", users),
    db.from("push_preferencias").select("*").in("user_id", users),
  ]);
  for (const i of inscricoes) {
    const papel = papeis?.find((p) => p.user_id === i.user_id && p.empresa_id === i.empresa_id)
      ?.papel as Papel | undefined;
    if (!papel) continue; // saiu da empresa: não recebe nada
    const lista = porEmpresa.get(i.empresa_id) ?? [];
    let pessoa = lista.find((p) => p.userId === i.user_id);
    if (!pessoa) {
      const pr = prefs?.find((p) => p.user_id === i.user_id && p.empresa_id === i.empresa_id);
      pessoa = {
        userId: i.user_id,
        papel,
        pref: pr
          ? {
              cliente_esperando: pr.cliente_esperando,
              espera_minutos: pr.espera_minutos,
              servico_concluido: pr.servico_concluido,
              campanha_aprovacao: pr.campanha_aprovacao,
              agendamento_promocao: pr.agendamento_promocao,
              resumo_dia: pr.resumo_dia,
              tatiana_tarefas: pr.tatiana_tarefas ?? true,
              tatiana_cobrancas: pr.tatiana_cobrancas ?? true,
            }
          : PREFERENCIAS_PADRAO,
        celulares: [],
      };
      lista.push(pessoa);
      porEmpresa.set(i.empresa_id, lista);
    }
    pessoa.celulares.push({
      id: i.id,
      endpoint: i.endpoint,
      p256dh: i.p256dh,
      auth: i.auth,
      recibo: i.recibo,
    });
  }
  return porEmpresa;
}

type Evento = {
  tipo: TipoPush;
  ref: string;
  n: Notificacao;
  para?: (p: Pessoa) => boolean;
  /** Chaves gravadas depois do envio (estágios das esperas já avisadas). */
  marcar?: string[];
};

async function esperasDaEmpresa(db: Db, empresaId: string, agora: Date): Promise<EsperaPush[]> {
  const desde = new Date(agora.getTime() - 24 * 3600_000).toISOString();
  const { data: conversas } = await db
    .from("conversas")
    .select(
      "id, aguardando_desde, assumida_por, responsavel_id, contato:whatsapp_contact_id ( profile_name, display_phone )",
    )
    .eq("empresa_id", empresaId)
    .eq("status", "open")
    .gte("aguardando_desde", desde)
    .limit(100);
  const lista = (conversas ?? []) as unknown as Array<{
    id: string;
    aguardando_desde: string;
    assumida_por: string | null;
    responsavel_id: number | string | null;
    contato: { profile_name: string | null; display_phone: string | null } | null;
  }>;
  if (!lista.length) return [];
  // Dono da conversa: quem assumiu pelo app ou a pessoa atribuída no Chatwoot (a Alice não conta).
  const [{ data: vinculos }, { data: conexoes }] = await Promise.all([
    db
      .from("usuarios_empresa")
      .select("user_id, chatwoot_agent_id")
      .eq("empresa_id", empresaId)
      .not("chatwoot_agent_id", "is", null),
    db.from("chatwoot_conexoes").select("alice_bot_id"),
  ]);
  const usuarioDoAgente = new Map<number, string>();
  for (const v of vinculos ?? [])
    if (v.chatwoot_agent_id != null) usuarioDoAgente.set(Number(v.chatwoot_agent_id), v.user_id);
  const bots = new Set((conexoes ?? []).map((c) => Number(c.alice_bot_id)));
  const donoDe = (c: (typeof lista)[number]) => {
    if (c.assumida_por) return c.assumida_por;
    const r = c.responsavel_id == null ? null : Number(c.responsavel_id);
    return r == null || bots.has(r) ? null : (usuarioDoAgente.get(r) ?? null);
  };
  const { data: msgs } = await db
    .from("whatsapp_messages")
    .select("conversa_id, direction, text_content, message_type, message_timestamp, created_at")
    .in(
      "conversa_id",
      lista.map((c) => c.id),
    )
    .eq("privada", false)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(1000);
  return lista.map((c) => ({
    id: c.id,
    nome: c.contato?.profile_name || c.contato?.display_phone || "Cliente",
    desde: c.aguardando_desde,
    // Última do cliente e pedindo resposta ("ok, obrigado" depois da equipe não conta).
    ultimaDoCliente: esperaDeVerdade((msgs ?? []).filter((m) => m.conversa_id === c.id)),
    donoUserId: donoDe(c),
  }));
}

async function eventosDaEmpresa(
  db: Db,
  empresaId: string,
  pessoas: Pessoa[],
  agora: Date,
): Promise<Evento[]> {
  const quer = (t: TipoPush) => pessoas.some((p) => querReceber(t, p.papel, p.pref));
  const eventos: Evento[] = [];
  const recente = new Date(agora.getTime() - 30 * 60_000).toISOString();

  if (quer("cliente_esperando")) {
    // Um aviso agrupado por pessoa (27/10): conversas dela + sem dono, aos 5 min e lembrete aos
    // 10 min, no máximo a cada 15 min. Antes saía um por conversa (114 no dia 26/10).
    const esperas = await esperasDaEmpresa(db, empresaId, agora);
    const desde = new Date(agora.getTime() - 24 * 3600_000).toISOString();
    for (const p of pessoas) {
      if (!querReceber("cliente_esperando", p.papel, p.pref)) continue;
      const { data: ja } = await db
        .from("push_envios")
        .select("ref, created_at")
        .eq("empresa_id", empresaId)
        .eq("user_id", p.userId)
        .eq("tipo", "cliente_esperando")
        .gte("created_at", desde)
        .limit(2000);
      const grupos = (ja ?? []).filter((r) => r.ref.startsWith("grupo:"));
      const plano = avisoAgrupadoDeEsperas({
        esperas,
        userId: p.userId,
        papel: p.papel,
        jaAvisadas: new Set((ja ?? []).map((r) => r.ref)),
        ultimoAvisoEm: grupos.length
          ? grupos
              .map((r) => r.created_at)
              .sort()
              .at(-1)!
          : null,
        agora,
      });
      if (plano)
        eventos.push({
          tipo: "cliente_esperando",
          ref: `grupo:${agora.toISOString()}`,
          n: plano.n,
          para: (x) => x.userId === p.userId,
          marcar: plano.marcar,
        });
    }
  }

  if (quer("servico_concluido")) {
    const { data } = await db
      .from("visits")
      .select(
        "id, technician:technician_id ( name ), work_order:work_order_id ( os_number, customer:customer_id ( full_name ) )",
      )
      .eq("empresa_id", empresaId)
      .eq("status", "Concluído")
      .gte("updated_at", recente)
      .limit(30);
    for (const v of (data ?? []) as unknown as Array<{
      id: string;
      technician: { name: string } | null;
      work_order: { os_number: string; customer: { full_name: string } | null } | null;
    }>)
      eventos.push({
        tipo: "servico_concluido",
        ref: v.id,
        n: notificacaoConcluido({
          cliente: v.work_order?.customer?.full_name ?? "Cliente",
          tecnico: v.technician?.name ?? null,
          os: v.work_order?.os_number ?? null,
        }),
      });
  }

  if (quer("campanha_aprovacao")) {
    // Envio pausado sozinho (qualidade do número fora do verde, opt-out/bloqueio, modelo): só admin.
    const { data: pausas } = await db
      .from("mkt_avisos")
      .select("id, titulo, mensagem")
      .eq("empresa_id", empresaId)
      .in("tipo", ["qualidade_numero", "pausa_automatica"])
      .gte("created_at", recente)
      .limit(10);
    for (const a of pausas ?? [])
      eventos.push({
        tipo: "campanha_aprovacao",
        ref: `pausa:${a.id}`,
        n: { titulo: a.titulo, corpo: a.mensagem.slice(0, 180), url: "/marketing" },
      });

    const { data } = await db
      .from("mkt_campanhas")
      .select("id, nome")
      .eq("empresa_id", empresaId)
      .eq("status", "aguardando_aprovacao")
      .limit(10);
    for (const c of data ?? [])
      eventos.push({ tipo: "campanha_aprovacao", ref: c.id, n: notificacaoCampanha(c) });
  }

  if (quer("agendamento_promocao")) {
    // Agendamentos feitos pela Alice (e OS dela sem documento): só admin e atendentes.
    const { data: avisos } = await db
      .from("mkt_avisos")
      .select("id, titulo, mensagem")
      .eq("empresa_id", empresaId)
      .eq("tipo", "agendamento_alice")
      .gte("created_at", recente)
      .limit(30);
    for (const a of avisos ?? [])
      eventos.push({
        tipo: "agendamento_promocao",
        ref: `alice:${a.id}`,
        n: notificacaoAgendamentoAlice(a),
        para: (p) => p.papel !== "tecnico",
      });

    const { data: visitas } = await db
      .from("visits")
      .select(
        "id, scheduled_date, scheduled_time, status, work_order:work_order_id ( customer:customer_id ( full_name, phone ) )",
      )
      .eq("empresa_id", empresaId)
      .gte("created_at", recente)
      .neq("status", "Cancelado")
      .limit(30);
    const novas = (visitas ?? []) as unknown as Array<{
      id: string;
      scheduled_date: string;
      scheduled_time: string;
      work_order: { customer: { full_name: string; phone: string } | null } | null;
    }>;
    if (novas.length) {
      const tresDias = new Date(agora.getTime() - 3 * 86_400_000).toISOString();
      const { data: promo } = await db
        .from("mkt_envios")
        .select("normalized_phone, campanha:campanha_id!inner ( tipo )")
        .eq("empresa_id", empresaId)
        .eq("status", "enviado")
        .eq("campanha.tipo", "promocao")
        .gte("enviado_em", tresDias)
        .limit(1000);
      const chaves = new Set(
        (promo ?? []).map((e) => chaveTelefone(e.normalized_phone)).filter(Boolean),
      );
      for (const v of novas) {
        const c = v.work_order?.customer;
        if (!c || !chaves.has(chaveTelefone(c.phone))) continue;
        eventos.push({
          tipo: "agendamento_promocao",
          ref: v.id,
          n: notificacaoPromocao({
            cliente: c.full_name,
            data: v.scheduled_date,
            hora: v.scheduled_time ?? "",
          }),
        });
      }
    }
  }

  const horaSP = Number(
    agora.toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }),
  );
  if (quer("resumo_dia") && horaDoResumo(horaSP)) {
    const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const { contagensDoDia, toquesD1DeOntem } = await import("@/lib/mkt/avisos-equipe.server");
    const { textosDaEmpresa } = await import("@/lib/mkt/textos.server");
    const [n, textos, d1] = await Promise.all([
      contagensDoDia(db, empresaId, hoje),
      textosDaEmpresa(db, empresaId),
      toquesD1DeOntem(db, empresaId, hoje),
    ]);
    const textoEquipe = textoResumoDoDia(n, textos["aviso_resumo"]);
    // Admin: também o toque do dia seguinte de ontem (áudio × texto e quantos responderam).
    const linhaD1 = linhaToquesD1(d1);
    for (const papel of ["admin", "atendente"] as Papel[])
      eventos.push({
        tipo: "resumo_dia",
        ref: hoje,
        n: notificacaoResumo(
          papel,
          n,
          papel === "admin" && linhaD1 ? `${textoEquipe}\n${linhaD1}` : textoEquipe,
        ),
        para: (x) => x.papel === papel,
      });
    // Técnico: só os serviços dele (vinculado pelo e-mail ou nome do cadastro de técnicos).
    const tecnicosPessoas = pessoas.filter(
      (p) => p.papel === "tecnico" && querReceber("resumo_dia", p.papel, p.pref),
    );
    if (tecnicosPessoas.length) {
      const [{ data: perfis }, { data: tecnicos }, { data: visitas }] = await Promise.all([
        db
          .from("users_profiles")
          .select("id, email, full_name")
          .in(
            "id",
            tecnicosPessoas.map((p) => p.userId),
          ),
        db
          .from("technicians")
          .select("id, email, name, user_id, active")
          .eq("empresa_id", empresaId),
        db
          .from("visits")
          .select(
            "technician_id, scheduled_date, scheduled_time, status, work_order:work_order_id ( customer:customer_id ( full_name, neighborhood ) )",
          )
          .eq("empresa_id", empresaId)
          .lte("scheduled_date", hoje)
          .in("status", ["Agendado", "Confirmado", "Em deslocamento", "Em execução", "Reagendado"])
          .gte(
            "scheduled_date",
            new Date(agora.getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
          )
          .limit(2000),
      ]);
      const lista = (visitas ?? []) as unknown as Array<{
        technician_id: string | null;
        scheduled_date: string;
        scheduled_time: string;
        work_order: { customer: { full_name: string; neighborhood: string | null } | null } | null;
      }>;
      for (const p of tecnicosPessoas) {
        const perfil = perfis?.find((x) => x.id === p.userId);
        const tecId = tecnicoDoUsuario(
          { id: p.userId, email: perfil?.email ?? null, nome: perfil?.full_name ?? null },
          (tecnicos ?? []).map((t) => ({
            id: t.id,
            email: t.email,
            nome: t.name,
            userId: t.user_id,
            ativo: t.active,
          })),
        );
        const nota = tecId
          ? notificacaoResumoTecnico(
              lista
                .filter((v) => v.technician_id === tecId && v.scheduled_date === hoje)
                .map((v) => ({
                  hora: v.scheduled_time ?? "",
                  cliente: v.work_order?.customer?.full_name ?? "Cliente",
                  bairro: v.work_order?.customer?.neighborhood ?? null,
                })),
              lista.filter((v) => v.technician_id === tecId && v.scheduled_date < hoje).length,
            )
          : // Sem técnico vinculado: o resumo da operação, como antes.
            notificacaoResumo("tecnico", n, textoEquipe);
        eventos.push({
          tipo: "resumo_dia",
          ref: hoje,
          n: nota,
          para: (x) => x.userId === p.userId,
        });
      }
    }
  }
  return eventos;
}

export async function processarNotificacoes(agora = new Date()) {
  const db = await dbServico();
  const porEmpresa = await pessoasComCelular(db);
  let enviadas = 0;
  let falhas = 0;
  for (const [empresaId, pessoas] of porEmpresa) {
    if (enviadas >= MAX_POR_RODADA) break;
    const eventos = await eventosDaEmpresa(db, empresaId, pessoas, agora);
    for (const ev of eventos) {
      for (const p of pessoas) {
        if (enviadas >= MAX_POR_RODADA) break;
        if (!querReceber(ev.tipo, p.papel, p.pref)) continue;
        if (ev.para && !ev.para(p)) continue;
        const id = await registrarUmaVez(db, empresaId, p.userId, ev.tipo, ev.ref, ev.n.titulo);
        if (!id) continue; // já notificado
        const r = await enviarParaPessoa(db, p.celulares, ev.n);
        await db.from("push_envios").update({ enviados: r.enviados }).eq("id", id);
        if (ev.marcar?.length)
          await db.from("push_envios").upsert(
            ev.marcar.map((ref) => ({
              empresa_id: empresaId,
              user_id: p.userId,
              tipo: ev.tipo,
              ref,
              titulo: "(espera avisada)",
              enviados: 0,
            })),
            { onConflict: "empresa_id,user_id,tipo,ref", ignoreDuplicates: true },
          );
        enviadas += r.enviados;
        falhas += r.falhas;
      }
    }
  }
  if (enviadas || falhas) log("INFO", "push.rodada", { enviadas, falhas });
  return { enviadas, falhas };
}
