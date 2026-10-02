import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
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
              .limit(30)
          : Promise.resolve(vazio),
        escritorio
          ? db
              .from("mkt_avisos")
              .select("id, tipo, titulo, mensagem, created_at, lido_em")
              .eq("empresa_id", context.empresaId)
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
    const esperando = (conversas.data ?? []) as unknown as LinhaConversa[];
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
