/**
 * Promoção para agenda vazia: horários base livres do próximo dia, lista de quem receberia e
 * ativação (só admin). Nada sai sozinho: a promoção só é criada quando o admin toca em "Ativar",
 * e só é enviada com a chave geral "Envio ligado" do Marketing.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import { configDaLinha, type ConfigAgenda } from "@/lib/agenda-config.functions";
import { addDaysISO, todayISO } from "@/lib/format";
import {
  horariosLivres,
  montarDestinatarios,
  previaMensagem,
  type Candidato,
  type Destinatario,
  type HorarioLivre,
} from "@/lib/promocao";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<Database>;

/** Visitas que ainda vão acontecer (as encerradas ou canceladas não seguram o cliente). */
const VISITA_FUTURA = ["Agendado", "Em execução", "Reagendado"];

async function lerConfig(db: Db, empresaId: string): Promise<ConfigAgenda> {
  const { data } = await db
    .from("agenda_configuracoes")
    .select("*")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return configDaLinha(data);
}

export type ResumoHorariosLivres = {
  data: string;
  livres: HorarioLivre[];
  /** Há horários base cadastrados? (sem eles, não dá para saber o que está vago). */
  configurado: boolean;
};

async function calcularLivres(db: Db, empresaId: string, cfg: ConfigAgenda) {
  const data = addDaysISO(todayISO(), cfg.diasAFrente);
  const [base, tecnicos, visitas] = await Promise.all([
    db
      .from("agenda_horarios_base")
      .select("tecnico_id, dia_semana, hora")
      .eq("empresa_id", empresaId),
    db.from("technicians").select("id, name, active").eq("empresa_id", empresaId),
    db
      .from("visits")
      .select("technician_id, scheduled_time, status")
      .eq("empresa_id", empresaId)
      .eq("scheduled_date", data),
  ]);
  const ativos = new Map(
    (tecnicos.data ?? []).filter((t) => t.active).map((t) => [t.id, t.name] as const),
  );
  const linhas = (base.data ?? []).filter((b) => ativos.has(b.tecnico_id));
  return {
    data,
    configurado: linhas.length > 0,
    livres: horariosLivres(
      linhas.map((b) => ({
        tecnicoId: b.tecnico_id,
        tecnico: ativos.get(b.tecnico_id) ?? "",
        diaSemana: b.dia_semana,
        hora: b.hora,
      })),
      (visitas.data ?? []).map((v) => ({
        tecnicoId: v.technician_id,
        hora: v.scheduled_time ?? "",
        status: v.status,
      })),
      data,
    ),
  };
}

export const horariosLivresFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ResumoHorariosLivres> => {
    const cfg = await lerConfig(context.supabase, context.empresaId);
    return calcularLivres(context.supabase, context.empresaId, cfg);
  });

/** Início do dia de hoje em São Paulo, em ISO (UTC). */
function inicioDeHojeSP(): string {
  return new Date(`${todayISO()}T00:00:00-03:00`).toISOString();
}

async function montarLista(db: Db, empresaId: string, cfg: ConfigAgenda) {
  const desde = new Date(Date.now() - cfg.orcamentoDias * 86_400_000).toISOString();
  const hoje = todayISO();
  const [orcamentos, conversas, agendadas, internos, optout] = await Promise.all([
    db
      .from("quotes")
      .select("cliente_nome, cliente_telefone, created_at")
      .eq("empresa_id", empresaId)
      .in("status", ["rascunho", "enviado", "aprovado"])
      .is("generated_work_order_id", null)
      .not("cliente_telefone", "is", null)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(500),
    cfg.conversasNovas
      ? db
          .from("conversas")
          .select(
            "criada_em, created_at, contato:whatsapp_contact_id ( profile_name, normalized_phone )",
          )
          .eq("empresa_id", empresaId)
          .gte("criada_em", inicioDeHojeSP())
          .order("criada_em", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] as never[] }),
    db
      .from("visits")
      .select("work_order:work_order_id ( customer:customer_id ( phone ) )")
      .eq("empresa_id", empresaId)
      .gte("scheduled_date", hoje)
      .in("status", VISITA_FUTURA)
      .limit(2000),
    db.from("contatos_internos").select("telefone").eq("empresa_id", empresaId),
    db
      .from("mkt_contatos")
      .select("normalized_phone")
      .eq("empresa_id", empresaId)
      .not("optout_em", "is", null)
      .limit(5000),
  ]);

  const candidatos: Candidato[] = [
    ...(orcamentos.data ?? []).map((q) => ({
      telefone: q.cliente_telefone ?? "",
      nome: q.cliente_nome ?? "",
      origem: "orcamento" as const,
      desde: q.created_at,
    })),
    ...(
      (conversas.data ?? []) as unknown as Array<{
        criada_em: string | null;
        created_at: string;
        contato: { profile_name: string | null; normalized_phone: string } | null;
      }>
    )
      .filter((c) => c.contato)
      .map((c) => ({
        telefone: c.contato!.normalized_phone,
        nome: c.contato!.profile_name ?? "",
        origem: "conversa" as const,
        desde: c.criada_em ?? c.created_at,
      })),
  ];
  const comAgendamento = (
    (agendadas.data ?? []) as unknown as Array<{
      work_order: { customer: { phone: string } | null } | null;
    }>
  )
    .map((v) => v.work_order?.customer?.phone ?? "")
    .filter(Boolean);

  return montarDestinatarios(candidatos, {
    comAgendamento,
    internos: (internos.data ?? []).map((i) => i.telefone),
    optout: (optout.data ?? []).map((o) => o.normalized_phone),
  });
}

export type PromocaoDeHoje = {
  id: string;
  status: string;
  total: number;
  enviados: number;
  pendentes: number;
  erros: number;
  cancelados: number;
};

export type SituacaoPromocao = {
  admin: boolean;
  envioLigado: boolean;
  config: ConfigAgenda;
  horarios: ResumoHorariosLivres;
  destinatarios: Destinatario[];
  previa: string;
  promocaoDeHoje: PromocaoDeHoje | null;
};

async function promocaoDeHoje(db: Db, empresaId: string): Promise<PromocaoDeHoje | null> {
  const { data: camp } = await db
    .from("mkt_campanhas")
    .select("id, status")
    .eq("empresa_id", empresaId)
    .eq("tipo", "promocao")
    .gte("created_at", inicioDeHojeSP())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!camp) return null;
  const { data: envios } = await db
    .from("mkt_envios")
    .select("status")
    .eq("campanha_id", camp.id)
    .limit(2000);
  const conta = (...s: string[]) => (envios ?? []).filter((e) => s.includes(e.status)).length;
  return {
    id: camp.id,
    status: camp.status,
    total: envios?.length ?? 0,
    enviados: conta("enviado"),
    pendentes: conta("pendente", "manual", "enviando"),
    erros: conta("erro"),
    cancelados: conta("cancelado"),
  };
}

export const situacaoPromocaoFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<SituacaoPromocao> => {
    const db = context.supabase;
    const [{ data: papel }, cfg, mkt] = await Promise.all([
      db.rpc("meu_papel" as never),
      lerConfig(db, context.empresaId),
      db
        .from("mkt_configuracoes")
        .select("disparo_ligado")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
    ]);
    const [horarios, destinatarios, deHoje] = await Promise.all([
      calcularLivres(db, context.empresaId, cfg),
      montarLista(db, context.empresaId, cfg),
      promocaoDeHoje(db, context.empresaId),
    ]);
    return {
      admin: (papel as unknown as string) === "admin",
      envioLigado: Boolean(mkt.data?.disparo_ligado),
      config: cfg,
      horarios,
      destinatarios,
      previa: previaMensagem(destinatarios[0]?.nome ?? "Carla", cfg.descontoPct, cfg.pixPct),
      promocaoDeHoje: deHoje,
    };
  });

/**
 * Cria a promoção para as pessoas escolhidas (o admin conferiu a lista). A lista é refeita aqui no
 * servidor: só entra quem ainda está nela (não confia em nome ou telefone vindos da tela).
 */
export const ativarPromocaoFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { chaves: string[] }) => ({
    chaves: (i.chaves ?? [])
      .map((c) => String(c).replace(/\D/g, ""))
      .filter((c) => c.length >= 10)
      .slice(0, 500),
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    if (!data.chaves.length) throw new Error("Escolha pelo menos uma pessoa.");
    if (await promocaoDeHoje(db, context.empresaId).then((p) => p && p.pendentes > 0))
      throw new Error("Já existe uma promoção de hoje com envios na fila.");
    const cfg = await lerConfig(db, context.empresaId);
    const escolhidas = new Set(data.chaves);
    const lista = (await montarLista(db, context.empresaId, cfg)).filter((d) =>
      escolhidas.has(d.chave),
    );
    if (!lista.length) throw new Error("Ninguém da lista escolhida pode receber agora.");
    const { dbServico, rpc } = await import("@/lib/mkt/contexto.server");
    const res = await rpc<{ campanha: string; envios: number; ignorados: number }>(
      await dbServico(),
      "mkt_criar_promocao",
      {
        _emp: context.empresaId,
        _usuario: context.userId,
        _contatos: lista.map((d) => ({ telefone: d.telefone, nome: d.nome })),
        _desconto: cfg.descontoPct,
        _pix: cfg.pixPct,
        _template: cfg.template,
        _hoje: null,
      },
    );
    return res;
  });
