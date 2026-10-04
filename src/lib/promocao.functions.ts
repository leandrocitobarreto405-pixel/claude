/**
 * Promoção de dia vago: horários base livres do próximo dia, lista de quem receberia (pelas listas
 * escolhidas, com valor, km e margem) e ativação (só admin). Nada sai sozinho: a chave da promoção
 * só libera; cada envio depende do admin tocar em "Ativar", e sai com a chave geral do Marketing.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";
import { configDaLinha, type ConfigAgenda } from "@/lib/agenda-config.functions";
import { addDaysISO, todayISO } from "@/lib/format";
import { chaveTelefone } from "@/lib/avisos";
import { lerPublico, type PessoaPublico } from "@/lib/listas.functions";
import {
  horariosLivres,
  prepararDestinatario,
  previaMensagem,
  tipoDoOrcamento,
  type Coordenada,
  type CustosEmpresa,
  type DestinatarioPromocao,
  type HorarioLivre,
  type PontoTecnico,
  type TipoOrcamento,
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

/** Quem está nas listas da promoção e pode receber agora (opt-out, interno, limite já tirados). */
async function quemPodeReceber(db: Db, cfg: ConfigAgenda) {
  const pessoas = await lerPublico(db as never, cfg.promoListas, true);
  return { pessoas, podem: pessoas.filter((p) => p.pode_receber && !p.agendado_para) };
}

async function numeroDaConfig(db: Db, empresaId: string, chave: string): Promise<number | null> {
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("empresa_id", empresaId)
    .eq("key", chave)
    .maybeSingle();
  const n = Number((data?.value ?? null) as unknown);
  return data && Number.isFinite(n) && n > 0 ? n : null;
}

/** Tipo de serviço do orçamento em aberto mais recente de cada telefone. */
async function tiposDosOrcamentos(db: Db, empresaId: string) {
  const { data } = await db
    .from("quotes")
    .select("cliente_telefone, created_at, quote_items ( tipo_servico )")
    .eq("empresa_id", empresaId)
    .in("status", ["rascunho", "enviado", "aprovado"])
    .is("generated_work_order_id", null)
    .not("cliente_telefone", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  const tipos = new Map<string, TipoOrcamento>();
  for (const q of (data ?? []) as unknown as Array<{
    cliente_telefone: string | null;
    quote_items: Array<{ tipo_servico: string | null }> | null;
  }>) {
    const chave = chaveTelefone(q.cliente_telefone);
    if (!chave || tipos.has(chave)) continue;
    tipos.set(chave, tipoDoOrcamento((q.quote_items ?? []).map((i) => i.tipo_servico)));
  }
  return tipos;
}

/** Custo por km usado nos orçamentos quando a empresa não configurou. */
const CUSTO_KM_PADRAO = 0.57;

/** Tempo máximo gasto localizando endereços por abertura da tela (o mapa aceita 1 pedido/s). */
const ORCAMENTO_GEO_MS = 8_000;

/**
 * Base de cada técnico com horário livre e os serviços dele no dia. Base sem coordenada é
 * localizada uma vez pelo endereço e guardada.
 */
async function pontosDosTecnicos(
  db: Db,
  empresaId: string,
  horarios: ResumoHorariosLivres,
  prazo: number,
): Promise<PontoTecnico[]> {
  const ids = [...new Set(horarios.livres.map((l) => l.tecnicoId))];
  if (!ids.length) return [];
  const [tecs, visitas] = await Promise.all([
    db
      .from("technicians")
      .select("id, name, base_address, base_latitude, base_longitude")
      .eq("empresa_id", empresaId)
      .in("id", ids),
    db
      .from("visits")
      .select(
        "technician_id, status, work_order:work_order_id ( customer:customer_id ( latitude, longitude ) )",
      )
      .eq("empresa_id", empresaId)
      .eq("scheduled_date", horarios.data)
      .in("technician_id", ids),
  ]);
  const servicos = new Map<string, Coordenada[]>();
  for (const v of (visitas.data ?? []) as unknown as Array<{
    technician_id: string | null;
    status: string;
    work_order: { customer: { latitude: number | null; longitude: number | null } | null } | null;
  }>) {
    const c = v.work_order?.customer;
    if (!v.technician_id || !c || c.latitude === null || c.longitude === null) continue;
    if (!VISITA_FUTURA.includes(v.status) && v.status !== "Concluído") continue;
    servicos.set(v.technician_id, [
      ...(servicos.get(v.technician_id) ?? []),
      { lat: Number(c.latitude), lon: Number(c.longitude) },
    ]);
  }
  const pontos: PontoTecnico[] = [];
  for (const t of tecs.data ?? []) {
    let base: Coordenada | null =
      t.base_latitude !== null && t.base_longitude !== null
        ? { lat: Number(t.base_latitude), lon: Number(t.base_longitude) }
        : null;
    if (!base && t.base_address && Date.now() < prazo) {
      const { geocode } = await import("@/lib/geo.server");
      const achou = await geocode(t.base_address).catch(() => null);
      if (achou) {
        base = achou;
        const { dbServico } = await import("@/lib/mkt/contexto.server");
        await (
          await dbServico()
        )
          .from("technicians")
          .update({ base_latitude: achou.lat, base_longitude: achou.lon })
          .eq("empresa_id", empresaId)
          .eq("id", t.id);
      }
    }
    pontos.push({ tecnicoId: t.id, tecnico: t.name, base, servicos: servicos.get(t.id) ?? [] });
  }
  return pontos;
}

/**
 * Localiza no mapa (e guarda no contato) quem tem endereço e ainda não tem coordenada, até o
 * prazo. Endereço que já falhou não é tentado de novo até mudar.
 */
async function localizarContatos(
  db: Db,
  empresaId: string,
  pessoas: PessoaPublico[],
  prazo: number,
): Promise<Map<string, Coordenada>> {
  const achados = new Map<string, Coordenada>();
  const faltam = pessoas.filter(
    (p) => (p.latitude === null || p.longitude === null) && (p.endereco || p.cep),
  );
  if (!faltam.length || Date.now() >= prazo) return achados;
  const { data: tentados } = await db
    .from("mkt_contatos")
    .select("id, geo_em, geo_endereco")
    .eq("empresa_id", empresaId)
    .in(
      "id",
      faltam.map((p) => p.contato_id),
    );
  const jaTentado = new Map((tentados ?? []).map((t) => [t.id, t] as const));
  const { geocodeParts } = await import("@/lib/geo.server");
  const { dbServico } = await import("@/lib/mkt/contexto.server");
  const servico = await dbServico();
  for (const p of faltam) {
    if (Date.now() >= prazo) break;
    const endereco = [p.endereco, p.cep].filter(Boolean).join(" · ");
    const t = jaTentado.get(p.contato_id);
    if (t?.geo_em && t.geo_endereco === endereco) continue;
    const achou = await geocodeParts({ full_address: p.endereco, postal_code: p.cep }).catch(
      () => null,
    );
    if (achou) achados.set(p.contato_id, achou);
    await servico
      .from("mkt_contatos")
      .update({
        latitude: achou?.lat ?? null,
        longitude: achou?.lon ?? null,
        geo_endereco: endereco,
        geo_em: new Date().toISOString(),
      })
      .eq("empresa_id", empresaId)
      .eq("id", p.contato_id);
  }
  return achados;
}

async function montarLista(
  db: Db,
  empresaId: string,
  cfg: ConfigAgenda,
  horarios: ResumoHorariosLivres,
): Promise<{ total: number; destinatarios: DestinatarioPromocao[]; custoKmConfigurado: boolean }> {
  const prazo = Date.now() + ORCAMENTO_GEO_MS;
  const [{ pessoas, podem }, tipos, imposto, custoKm] = await Promise.all([
    quemPodeReceber(db, cfg),
    tiposDosOrcamentos(db, empresaId),
    numeroDaConfig(db, empresaId, "tax_percent"),
    numeroDaConfig(db, empresaId, "cost_per_km"),
  ]);
  const pontos = await pontosDosTecnicos(db, empresaId, horarios, prazo);
  const achados = await localizarContatos(db, empresaId, podem, prazo);
  const custos: CustosEmpresa = {
    impostoPct: imposto ?? 6,
    // Mesmo padrão dos orçamentos quando a empresa não configurou.
    custoKm: custoKm ?? CUSTO_KM_PADRAO,
    produtoHigienizacao: cfg.produtoHigienizacao,
    produtoImpermeabilizacao: cfg.produtoImpermeabilizacao,
  };
  const vistos = new Set<string>();
  const destinatarios: DestinatarioPromocao[] = [];
  for (const p of podem) {
    const chave = chaveTelefone(p.telefone);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    const coord =
      p.latitude !== null && p.longitude !== null
        ? { lat: Number(p.latitude), lon: Number(p.longitude) }
        : (achados.get(p.contato_id) ?? null);
    destinatarios.push(
      prepararDestinatario(
        {
          chave,
          telefone: p.telefone,
          nome: p.nome ?? "",
          familias: p.familias,
          diasOrcamento: p.dias_orcamento,
          diasConversa: p.dias_conversa,
          valor: p.orcamento_valor && p.orcamento_valor > 0 ? p.orcamento_valor : null,
          kmOrcamento: p.orcamento_km,
          tipo: tipos.get(chave) ?? null,
          coord,
        },
        pontos,
        cfg,
        custos,
      ),
    );
  }
  const dias = (d: DestinatarioPromocao) =>
    Math.min(d.diasOrcamento ?? Infinity, d.diasConversa ?? Infinity);
  destinatarios.sort((a, b) => dias(a) - dias(b) || a.nome.localeCompare(b.nome));
  return { total: pessoas.length, destinatarios, custoKmConfigurado: custoKm !== null };
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
  /** Pessoas nas listas escolhidas (antes de tirar quem não pode receber agora). */
  totalNaLista: number;
  destinatarios: DestinatarioPromocao[];
  custoKmConfigurado: boolean;
  /** Dias mínimos entre duas mensagens de marketing para a mesma pessoa. */
  limiteMarketingDias: number;
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
    const [{ data: papel }, cfg, mkt, empresa] = await Promise.all([
      db.rpc("meu_papel" as never),
      lerConfig(db, context.empresaId),
      db
        .from("mkt_configuracoes")
        .select("disparo_ligado, limite_marketing_dias")
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      db.from("empresas").select("nome").eq("id", context.empresaId).maybeSingle(),
    ]);
    const [horarios, deHoje] = await Promise.all([
      calcularLivres(db, context.empresaId, cfg),
      promocaoDeHoje(db, context.empresaId),
    ]);
    const lista = await montarLista(db, context.empresaId, cfg, horarios);
    const destinatarios = lista.destinatarios;
    return {
      admin: (papel as unknown as string) === "admin",
      envioLigado: Boolean(mkt.data?.disparo_ligado),
      config: cfg,
      horarios,
      totalNaLista: lista.total,
      destinatarios,
      custoKmConfigurado: lista.custoKmConfigurado,
      limiteMarketingDias: mkt.data?.limite_marketing_dias ?? 30,
      previa: previaMensagem(
        destinatarios.find((d) => d.podeEnviar)?.nome ?? "Carla",
        cfg.descontoPct,
        cfg.pixPct,
        empresa.data?.nome ?? "nossa empresa",
      ),
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
    if (!cfg.promoLigada)
      throw new Error("A promoção de dia vago está desligada. Ligue a chave antes de ativar.");
    const escolhidas = new Set(data.chaves);
    const vistos = new Set<string>();
    const lista = (await quemPodeReceber(db, cfg)).podem
      .map((p) => ({
        chave: chaveTelefone(p.telefone) ?? "",
        telefone: p.telefone,
        nome: (p.nome ?? "").trim(),
      }))
      .filter(
        (d) => d.nome && escolhidas.has(d.chave) && !vistos.has(d.chave) && vistos.add(d.chave),
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

export type ResumoPromocao = {
  admin: boolean;
  ligada: boolean;
  listas: ConfigAgenda["promoListas"];
  /** Pessoas nas listas escolhidas e quantas podem receber agora. */
  total: number;
  podem: number;
  horarios: ResumoHorariosLivres;
};

/** Resumo para os cartões do Marketing e do Início (sem localizar endereços: é rápido). */
export const resumoPromocaoFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ResumoPromocao> => {
    const db = context.supabase;
    const [{ data: papel }, cfg] = await Promise.all([
      db.rpc("meu_papel" as never),
      lerConfig(db, context.empresaId),
    ]);
    const admin = (papel as unknown as string) === "admin";
    const [horarios, lista] = await Promise.all([
      calcularLivres(db, context.empresaId, cfg),
      // Técnico não vê listas de marketing (o banco também bloqueia).
      (papel as unknown as string) === "tecnico"
        ? Promise.resolve({ pessoas: [], podem: [] })
        : quemPodeReceber(db, cfg),
    ]);
    return {
      admin,
      ligada: cfg.promoLigada,
      listas: cfg.promoListas,
      total: lista.pessoas.length,
      podem: lista.podem.filter((p) => (p.nome ?? "").trim()).length,
      horarios,
    };
  });
