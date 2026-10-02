import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import { montarAvisos, type Aviso, type FontesDeAvisos } from "@/lib/avisos";
import { ultimaPassagem } from "@/lib/conversas";
import { addDaysISO, todayISO } from "@/lib/format";
import type { Papel } from "@/lib/tenant";

// Avisos da equipe, juntados a partir do que já existe no banco (só leitura).

const PAPEIS: Papel[] = ["admin", "atendente", "tecnico"];

export const listarAvisos = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<Aviso[]> => {
    const db = context.supabase;
    const { data: papelBruto } = await db.rpc("meu_papel" as never);
    const papel = PAPEIS.includes(papelBruto as unknown as Papel)
      ? (papelBruto as unknown as Papel)
      : null;
    const escritorio = papel === "admin" || papel === "atendente";
    const hoje = todayISO();
    const desde14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const vazio = { data: [] as never[], count: 0 };

    const [conversas, marketing, atrasados, semTecnico, reagendados, pagamentos] =
      await Promise.all([
        escritorio
          ? db
              .from("conversas")
              .select(
                "id, aguardando_desde, contato:whatsapp_contact_id ( profile_name, display_phone )",
              )
              .eq("empresa_id", context.empresaId)
              .eq("status", "open")
              .not("aguardando_desde", "is", null)
              .order("aguardando_desde")
              .limit(300)
          : Promise.resolve(vazio),
        escritorio
          ? db
              .from("mkt_avisos")
              .select("id, tipo, titulo, mensagem, created_at, lido_em")
              .eq("empresa_id", context.empresaId)
              // A espera já aparece pela própria conversa; este tipo só existe para o WhatsApp.
              .neq("tipo", "cliente_esperando")
              .gte("created_at", desde14)
              .order("created_at", { ascending: false })
              .limit(30)
          : Promise.resolve(vazio),
        db
          .from("visits")
          .select("id", { count: "exact", head: true })
          .lt("scheduled_date", hoje)
          .in("status", ["Agendado", "Em execução", "Reagendado"]),
        db
          .from("visits")
          .select("id", { count: "exact", head: true })
          .is("technician_id", null)
          .neq("status", "Cancelado"),
        db
          .from("visits")
          .select(
            "id, scheduled_date, scheduled_time, work_order:work_order_id ( customer:customer_id ( full_name ) )",
          )
          .not("rescheduled_from_visit_id", "is", null)
          .gte("scheduled_date", hoje)
          .lte("scheduled_date", addDaysISO(hoje, 2))
          .neq("status", "Cancelado")
          .order("scheduled_date")
          .limit(10),
        papel === "admin"
          ? db
              .from("payments")
              .select("id", { count: "exact", head: true })
              .in("payment_status", ["Não pago", "Parcialmente pago"])
          : Promise.resolve(vazio),
      ]);

    type LinhaConversa = {
      id: string;
      aguardando_desde: string;
      contato: { profile_name: string | null; display_phone: string | null } | null;
    };
    // Só quem está esperando de verdade (o cliente falou por último).
    const { esperasReais } = await import("@/lib/conversas-espera.server");
    const reais = escritorio
      ? new Set((await esperasReais(db, context.empresaId)).map((e) => e.id))
      : new Set<string>();
    const esperando = ((conversas.data ?? []) as unknown as LinhaConversa[]).filter((c) =>
      reais.has(c.id),
    );
    const ids = esperando.map((c) => c.id);
    const { data: execs } = ids.length
      ? await db
          .from("ia_execucoes")
          .select("conversa_id, ferramentas")
          .in("conversa_id", ids)
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: [] };
    const passagemDe = (id: string) =>
      ultimaPassagem(
        ((execs ?? []) as Array<{ conversa_id: string; ferramentas: unknown }>).filter(
          (e) => e.conversa_id === id,
        ),
      );

    const fontes: FontesDeAvisos = {
      conversasEsperando: esperando.map((c) => {
        const p = passagemDe(c.id);
        return {
          id: c.id,
          nome: c.contato?.profile_name || c.contato?.display_phone || "Cliente",
          desde: c.aguardando_desde,
          motivo: p?.motivo ?? null,
          posVenda: p?.posVenda ?? false,
        };
      }),
      marketing: (
        (marketing.data ?? []) as Array<{
          id: string;
          tipo: string;
          titulo: string;
          mensagem: string;
          created_at: string;
          lido_em: string | null;
        }>
      ).map((m) => ({
        id: m.id,
        tipo: m.tipo,
        titulo: m.titulo,
        mensagem: m.mensagem,
        criadoEm: m.created_at,
        lidoEm: m.lido_em,
      })),
      atrasados: atrasados.count ?? 0,
      semTecnico: semTecnico.count ?? 0,
      reagendados: (
        (reagendados.data ?? []) as unknown as Array<{
          id: string;
          scheduled_date: string;
          scheduled_time: string;
          work_order: { customer: { full_name: string } | null } | null;
        }>
      ).map((r) => ({
        id: r.id,
        cliente: r.work_order?.customer?.full_name ?? "Cliente",
        data: r.scheduled_date,
        hora: r.scheduled_time ?? "",
      })),
      pagamentosPendentes: pagamentos.count ?? 0,
    };
    return montarAvisos(fontes, papel);
  });

// ---------------------------------------------------------------- WhatsApp da equipe

export type ConfigAvisosWhatsapp = {
  admin: boolean;
  ligado: boolean;
  telefone: string | null;
  modelo: string | null;
  esperaMinutos: number | null;
  resumoDiario: boolean;
  /** Último erro de envio nas últimas 24 h (para mostrar na tela). */
  ultimoErro: string | null;
  enviadosHoje: number;
  /** O celular configurado está na base de clientes: nada é enviado até trocar. */
  numeroBloqueado: boolean;
};

export const configAvisosWhatsapp = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ConfigAvisosWhatsapp> => {
    const db = context.supabase;
    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const [{ data: papel }, { data: cfg }, { data: erro }, enviados] = await Promise.all([
      db.rpc("meu_papel" as never),
      db
        .from("mkt_configuracoes")
        .select(
          "aviso_whatsapp_ligado, aviso_telefone, aviso_template_nome, aviso_espera_minutos, aviso_resumo_diario",
        )
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      db
        .from("mkt_avisos")
        .select("whatsapp_erro")
        .eq("empresa_id", context.empresaId)
        .not("whatsapp_erro", "is", null)
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("mkt_avisos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", context.empresaId)
        .gte("whatsapp_enviado_em", desde),
    ]);
    const { numeroEhDeCliente } = await import("@/lib/mkt/avisos-equipe.server");
    const numeroBloqueado = cfg?.aviso_telefone
      ? await numeroEhDeCliente(db, context.empresaId, cfg.aviso_telefone)
      : false;
    return {
      numeroBloqueado,
      admin: (papel as unknown as string) === "admin",
      ligado: Boolean(cfg?.aviso_whatsapp_ligado),
      telefone: cfg?.aviso_telefone ?? null,
      modelo: cfg?.aviso_template_nome ?? null,
      esperaMinutos: cfg?.aviso_espera_minutos ?? null,
      resumoDiario: Boolean(cfg?.aviso_resumo_diario),
      ultimoErro: erro?.whatsapp_erro ?? null,
      enviadosHoje: enviados.count ?? 0,
    };
  });

export const salvarAvisosWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (input: {
      ligado: boolean;
      telefone: string | null;
      modelo: string | null;
      esperaMinutos: number | null;
      resumoDiario: boolean;
    }) => {
      const telefone = String(input.telefone ?? "").replace(/\D/g, "") || null;
      if (telefone && (telefone.length < 10 || telefone.length > 13))
        throw new Error("Telefone inválido. Use DDD + número, ex.: 11 98888-7777.");
      const modelo =
        String(input.modelo ?? "")
          .trim()
          .slice(0, 100) || null;
      const espera =
        input.esperaMinutos === null || input.esperaMinutos === undefined
          ? null
          : Math.round(Number(input.esperaMinutos));
      if (espera !== null && !(espera >= 5 && espera <= 240))
        throw new Error("O tempo de espera precisa ficar entre 5 e 240 minutos.");
      return {
        ligado: Boolean(input.ligado),
        telefone,
        modelo,
        esperaMinutos: espera,
        resumoDiario: Boolean(input.resumoDiario),
      };
    },
  )
  .handler(async ({ data, context }) => {
    if (data.ligado && (!data.telefone || !data.modelo))
      throw new Error("Para ligar, informe o celular da equipe e o nome do modelo.");
    const { recusarNumeroDeCliente } = await import("@/lib/mkt/avisos-equipe.server");
    await recusarNumeroDeCliente(context.supabase, context.empresaId, data.telefone);
    const { error } = await context.supabase.from("mkt_configuracoes").upsert(
      {
        empresa_id: context.empresaId,
        aviso_whatsapp_ligado: data.ligado,
        aviso_telefone: data.telefone,
        aviso_template_nome: data.modelo,
        aviso_espera_minutos: data.esperaMinutos,
        aviso_resumo_diario: data.resumoDiario,
      },
      { onConflict: "empresa_id" },
    );
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });
