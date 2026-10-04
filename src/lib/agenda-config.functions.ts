/**
 * Configuração da agenda (técnicos, veículos, horários base, rodízio), da promoção para agenda
 * vazia e dos contatos internos da equipe. Leitura por qualquer pessoa da empresa (a Agenda usa o
 * rodízio para o alerta); alteração só pelo admin (middleware + RLS).
 */
import { createServerFn } from "@tanstack/react-start";
import { filtrosValidos, type Filtros } from "@/lib/listas";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

export const CHAVE_AGENDA_CONFIG = ["agenda-config"] as const;

const ID = /^[0-9a-f-]{36}$/i;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ConfigAgenda = {
  rodizioManhaInicio: string;
  rodizioManhaFim: string;
  rodizioTardeInicio: string;
  rodizioTardeFim: string;
  comecarAPartir: string;
  duracaoMin: number;
  voltaMin: number;
  diasAFrente: number;
  descontoPct: number;
  pixPct: number;
  orcamentoDias: number;
  conversasNovas: boolean;
  template: string;
  /** A promoção de dia vago está liberada (cada envio ainda depende de "Ativar"). */
  promoLigada: boolean;
  /** Listas de quem recebe a promoção (uma opção "até X dias" por família). */
  promoListas: Filtros;
  /** Margem mínima (R$) e distância máxima (km): quem fica fora aparece desmarcado. */
  margemMin: number | null;
  kmMax: number | null;
  /** Custo médio de produto por tipo de serviço (R$). */
  produtoHigienizacao: number;
  produtoImpermeabilizacao: number;
};

export const CONFIG_AGENDA_PADRAO: ConfigAgenda = {
  rodizioManhaInicio: "07:00",
  rodizioManhaFim: "10:00",
  rodizioTardeInicio: "17:00",
  rodizioTardeFim: "20:00",
  comecarAPartir: "11:00",
  duracaoMin: 180,
  voltaMin: 30,
  diasAFrente: 1,
  descontoPct: 20,
  pixPct: 5,
  orcamentoDias: 15,
  conversasNovas: true,
  template: "promocao_agenda",
  promoLigada: false,
  promoListas: { orcamento: { ate: 10 }, conversa: { ate: 30 } },
  margemMin: null,
  kmMax: null,
  produtoHigienizacao: 0,
  produtoImpermeabilizacao: 0,
};

export type TecnicoAgenda = { id: string; nome: string; ativo: boolean };
export type VeiculoAgenda = {
  id: string;
  nome: string;
  tecnicoId: string | null;
  diaRodizio: number | null;
};
export type HorarioBaseAgenda = { tecnicoId: string; diaSemana: number; hora: string };

export type DadosAgendaConfig = {
  admin: boolean;
  configurado: boolean;
  config: ConfigAgenda;
  tecnicos: TecnicoAgenda[];
  veiculos: VeiculoAgenda[];
  horarios: HorarioBaseAgenda[];
};

type LinhaConfig = {
  rodizio_manha_inicio: string;
  rodizio_manha_fim: string;
  rodizio_tarde_inicio: string;
  rodizio_tarde_fim: string;
  rodizio_comecar_a_partir: string;
  duracao_atendimento_min: number;
  deslocamento_volta_min: number;
  promo_dias_a_frente: number;
  promo_desconto_pct: number;
  promo_pix_pct: number;
  promo_orcamento_dias: number;
  promo_conversas_novas: boolean;
  promo_template_nome: string;
  promo_ligada?: boolean;
  promo_listas?: unknown;
  promo_margem_min?: number | string | null;
  promo_km_max?: number | string | null;
  custo_produto_higienizacao?: number | string;
  custo_produto_impermeabilizacao?: number | string;
};

const h5 = (h: string) => h.slice(0, 5);

export function configDaLinha(l: LinhaConfig | null): ConfigAgenda {
  if (!l) return CONFIG_AGENDA_PADRAO;
  return {
    rodizioManhaInicio: h5(l.rodizio_manha_inicio),
    rodizioManhaFim: h5(l.rodizio_manha_fim),
    rodizioTardeInicio: h5(l.rodizio_tarde_inicio),
    rodizioTardeFim: h5(l.rodizio_tarde_fim),
    comecarAPartir: h5(l.rodizio_comecar_a_partir),
    duracaoMin: l.duracao_atendimento_min,
    voltaMin: l.deslocamento_volta_min,
    diasAFrente: l.promo_dias_a_frente,
    descontoPct: Number(l.promo_desconto_pct),
    pixPct: Number(l.promo_pix_pct),
    orcamentoDias: l.promo_orcamento_dias,
    conversasNovas: l.promo_conversas_novas,
    template: l.promo_template_nome,
    promoLigada: Boolean(l.promo_ligada),
    promoListas: filtrosValidos(l.promo_listas ?? CONFIG_AGENDA_PADRAO.promoListas),
    margemMin:
      l.promo_margem_min === null || l.promo_margem_min === undefined
        ? null
        : Number(l.promo_margem_min),
    kmMax: l.promo_km_max === null || l.promo_km_max === undefined ? null : Number(l.promo_km_max),
    produtoHigienizacao: Number(l.custo_produto_higienizacao ?? 0),
    produtoImpermeabilizacao: Number(l.custo_produto_impermeabilizacao ?? 0),
  };
}

/** Listas da promoção: só "até X dias" e nunca "Agendado". */
export function listasDaPromocao(v: unknown): Filtros {
  const f = filtrosValidos(v);
  delete f.agendado;
  for (const k of Object.keys(f) as Array<keyof Filtros>) delete f[k]!.de;
  return f;
}

const valorOuNulo = (v: unknown, nome: string, max: number) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${nome}: valor inválido.`);
  return Math.round(n * 100) / 100;
};

export const lerAgendaConfig = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<DadosAgendaConfig> => {
    const db = context.supabase;
    const [{ data: papel }, cfg, tecnicos, veiculos, horarios] = await Promise.all([
      db.rpc("meu_papel" as never),
      db.from("agenda_configuracoes").select("*").eq("empresa_id", context.empresaId).maybeSingle(),
      db
        .from("technicians")
        .select("id, name, active")
        .eq("empresa_id", context.empresaId)
        .order("display_order")
        .order("name"),
      db
        .from("veiculos")
        .select("id, nome, tecnico_id, dia_rodizio")
        .eq("empresa_id", context.empresaId)
        .order("created_at"),
      db
        .from("agenda_horarios_base")
        .select("tecnico_id, dia_semana, hora")
        .eq("empresa_id", context.empresaId)
        .order("dia_semana")
        .order("hora"),
    ]);
    return {
      admin: (papel as unknown as string) === "admin",
      configurado: Boolean(cfg.data),
      config: configDaLinha(cfg.data as LinhaConfig | null),
      tecnicos: (tecnicos.data ?? []).map((t) => ({ id: t.id, nome: t.name, ativo: t.active })),
      veiculos: (veiculos.data ?? []).map((v) => ({
        id: v.id,
        nome: v.nome,
        tecnicoId: v.tecnico_id,
        diaRodizio: v.dia_rodizio,
      })),
      horarios: (horarios.data ?? []).map((h) => ({
        tecnicoId: h.tecnico_id,
        diaSemana: h.dia_semana,
        hora: h5(h.hora),
      })),
    };
  });

const inteiro = (v: unknown, min: number, max: number, nome: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${nome}: use um número entre ${min} e ${max}.`);
  return n;
};
const percentual = (v: unknown, nome: string) => {
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 25) throw new Error(`${nome}: use de 0 a 25%.`);
  return Math.round(n * 100) / 100;
};
const hora = (v: unknown, nome: string) => {
  const s = String(v ?? "").slice(0, 5);
  if (!HORA.test(s)) throw new Error(`${nome}: hora inválida.`);
  return s;
};

export const salvarAgendaConfig = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((c: ConfigAgenda): ConfigAgenda => {
    const cfg: ConfigAgenda = {
      rodizioManhaInicio: hora(c.rodizioManhaInicio, "Início do rodízio (manhã)"),
      rodizioManhaFim: hora(c.rodizioManhaFim, "Fim do rodízio (manhã)"),
      rodizioTardeInicio: hora(c.rodizioTardeInicio, "Início do rodízio (tarde)"),
      rodizioTardeFim: hora(c.rodizioTardeFim, "Fim do rodízio (tarde)"),
      comecarAPartir: hora(c.comecarAPartir, "Começar a partir de"),
      duracaoMin: inteiro(c.duracaoMin, 30, 600, "Duração do atendimento"),
      voltaMin: inteiro(c.voltaMin, 0, 240, "Tempo de volta"),
      diasAFrente: inteiro(c.diasAFrente, 1, 7, "Dias à frente"),
      descontoPct: percentual(c.descontoPct, "Desconto da promoção"),
      pixPct: percentual(c.pixPct, "Desconto no Pix"),
      orcamentoDias: inteiro(c.orcamentoDias, 1, 90, "Orçamentos dos últimos"),
      conversasNovas: Boolean(c.conversasNovas),
      template: String(c.template ?? "").trim(),
      promoLigada: Boolean(c.promoLigada),
      promoListas: listasDaPromocao(c.promoListas),
      margemMin: valorOuNulo(c.margemMin, "Margem mínima", 100000),
      kmMax: valorOuNulo(c.kmMax, "Distância máxima", 1000),
      produtoHigienizacao:
        valorOuNulo(c.produtoHigienizacao, "Produto da higienização", 10000) ?? 0,
      produtoImpermeabilizacao:
        valorOuNulo(c.produtoImpermeabilizacao, "Produto da impermeabilização", 10000) ?? 0,
    };
    if (cfg.kmMax === 0) throw new Error("Distância máxima: use mais que 0 km ou deixe em branco.");
    if (cfg.descontoPct < 1) throw new Error("Desconto da promoção: use de 1 a 25%.");
    if (cfg.descontoPct + cfg.pixPct > 25)
      throw new Error("Promoção + Pix passam de 25%. Diminua um dos dois.");
    if (
      cfg.rodizioManhaInicio >= cfg.rodizioManhaFim ||
      cfg.rodizioTardeInicio >= cfg.rodizioTardeFim
    )
      throw new Error("O início do rodízio precisa ser antes do fim.");
    if (!/^[a-z0-9_]{1,512}$/.test(cfg.template))
      throw new Error("Nome do modelo: só letras minúsculas, números e _.");
    return cfg;
  })
  .handler(async ({ data: c, context }) => {
    const { error } = await context.supabase.from("agenda_configuracoes").upsert({
      empresa_id: context.empresaId,
      rodizio_manha_inicio: c.rodizioManhaInicio,
      rodizio_manha_fim: c.rodizioManhaFim,
      rodizio_tarde_inicio: c.rodizioTardeInicio,
      rodizio_tarde_fim: c.rodizioTardeFim,
      rodizio_comecar_a_partir: c.comecarAPartir,
      duracao_atendimento_min: c.duracaoMin,
      deslocamento_volta_min: c.voltaMin,
      promo_dias_a_frente: c.diasAFrente,
      promo_desconto_pct: c.descontoPct,
      promo_pix_pct: c.pixPct,
      promo_orcamento_dias: c.orcamentoDias,
      promo_conversas_novas: c.conversasNovas,
      promo_template_nome: c.template,
      promo_ligada: c.promoLigada,
      promo_listas: c.promoListas,
      promo_margem_min: c.margemMin,
      promo_km_max: c.kmMax,
      custo_produto_higienizacao: c.produtoHigienizacao,
      custo_produto_impermeabilizacao: c.produtoImpermeabilizacao,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    return { ok: true };
  });

/** Chave e listas da promoção de dia vago (cartões do Marketing e do Início). */
export const salvarPromocaoRapidaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { ligada?: boolean; listas?: Filtros }) => ({
    ligada: typeof i.ligada === "boolean" ? i.ligada : undefined,
    listas: i.listas === undefined ? undefined : listasDaPromocao(i.listas),
  }))
  .handler(async ({ data, context }) => {
    const mudancas: { promo_ligada?: boolean; promo_listas?: Filtros } = {};
    if (data.ligada !== undefined) mudancas.promo_ligada = data.ligada;
    if (data.listas !== undefined) mudancas.promo_listas = data.listas;
    const { error } = await context.supabase
      .from("agenda_configuracoes")
      .upsert({ empresa_id: context.empresaId, ...mudancas }, { onConflict: "empresa_id" });
    if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    return { ok: true };
  });

// ---------------------------------------------------------------- técnicos e veículos
export const adicionarTecnico = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { nome: string }) => {
    const nome = String(i.nome ?? "").trim();
    if (nome.length < 2 || nome.length > 60) throw new Error("Informe o nome do técnico.");
    return { nome };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("technicians")
      .insert({ empresa_id: context.empresaId, name: data.nome });
    if (error) throw new Error(`Não foi possível adicionar: ${error.message}`);
    return { ok: true };
  });

export const ativarTecnico = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { id: string; ativo: boolean }) => {
    if (!ID.test(i.id)) throw new Error("Técnico inválido.");
    return { id: i.id, ativo: Boolean(i.ativo) };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("technicians")
      .update({ active: data.ativo })
      .eq("id", data.id)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    return { ok: true };
  });

export const salvarVeiculo = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((v: Omit<VeiculoAgenda, "id"> & { id?: string | null }) => {
    const nome = String(v.nome ?? "").trim();
    if (!nome || nome.length > 60) throw new Error("Informe o nome ou a placa do veículo.");
    const dia = v.diaRodizio === null || v.diaRodizio === undefined ? null : Number(v.diaRodizio);
    if (dia !== null && !(Number.isInteger(dia) && dia >= 1 && dia <= 5))
      throw new Error("O rodízio é de segunda a sexta.");
    return {
      id: v.id && ID.test(v.id) ? v.id : null,
      nome,
      tecnicoId: v.tecnicoId && ID.test(v.tecnicoId) ? v.tecnicoId : null,
      diaRodizio: dia,
    };
  })
  .handler(async ({ data, context }) => {
    const linha = { nome: data.nome, tecnico_id: data.tecnicoId, dia_rodizio: data.diaRodizio };
    const { error } = data.id
      ? await context.supabase
          .from("veiculos")
          .update(linha)
          .eq("id", data.id)
          .eq("empresa_id", context.empresaId)
      : await context.supabase.from("veiculos").insert({ ...linha, empresa_id: context.empresaId });
    if (error) throw new Error(`Não foi possível salvar o veículo: ${error.message}`);
    return { ok: true };
  });

export const excluirVeiculo = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { id: string }) => {
    if (!ID.test(i.id)) throw new Error("Veículo inválido.");
    return { id: i.id };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("veiculos")
      .delete()
      .eq("id", data.id)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error(`Não foi possível remover: ${error.message}`);
    return { ok: true };
  });

/** Troca os horários base de um técnico pelos informados. */
export const salvarHorariosTecnico = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { tecnicoId: string; horarios: { diaSemana: number; hora: string }[] }) => {
    if (!ID.test(i.tecnicoId)) throw new Error("Técnico inválido.");
    const vistos = new Set<string>();
    const horarios: { diaSemana: number; hora: string }[] = [];
    for (const h of (i.horarios ?? []).slice(0, 100)) {
      const dia = inteiro(h.diaSemana, 0, 6, "Dia da semana");
      const hh = hora(h.hora, "Horário base");
      const k = `${dia}-${hh}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      horarios.push({ diaSemana: dia, hora: hh });
    }
    return { tecnicoId: i.tecnicoId, horarios };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { error: e1 } = await db
      .from("agenda_horarios_base")
      .delete()
      .eq("empresa_id", context.empresaId)
      .eq("tecnico_id", data.tecnicoId);
    if (e1) throw new Error(`Não foi possível salvar: ${e1.message}`);
    if (data.horarios.length) {
      const { error } = await db.from("agenda_horarios_base").insert(
        data.horarios.map((h) => ({
          empresa_id: context.empresaId,
          tecnico_id: data.tecnicoId,
          dia_semana: h.diaSemana,
          hora: h.hora,
        })),
      );
      if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    }
    return { ok: true };
  });

// ---------------------------------------------------------------- contatos internos
export type ContatoInterno = {
  id: string;
  telefone: string;
  nome: string | null;
  criadoEm: string;
};

export const listarContatosInternos = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<ContatoInterno[]> => {
    const { data } = await context.supabase
      .from("contatos_internos")
      .select("id, telefone, nome, created_at")
      .eq("empresa_id", context.empresaId)
      .order("created_at");
    return (data ?? []).map((c) => ({
      id: c.id,
      telefone: c.telefone,
      nome: c.nome,
      criadoEm: c.created_at,
    }));
  });

export const marcarContatoInterno = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { telefone: string; nome?: string | null }) => {
    const digitos = String(i.telefone ?? "").replace(/\D/g, "");
    if (digitos.length < 10 || digitos.length > 13)
      throw new Error("Informe o celular com DDD, ex.: (11) 98888-7777.");
    return {
      telefone: digitos,
      nome:
        String(i.nome ?? "")
          .trim()
          .slice(0, 120) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("contatos_internos").insert({
      empresa_id: context.empresaId,
      telefone: data.telefone,
      nome: data.nome,
      chave: "",
    });
    if (error) {
      if (error.code === "23505") throw new Error("Esse número já está marcado como interno.");
      throw new Error(`Não foi possível marcar: ${error.message}`);
    }
    return { ok: true };
  });

export const desmarcarContatoInterno = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { id: string }) => {
    if (!ID.test(i.id)) throw new Error("Contato inválido.");
    return { id: i.id };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("contatos_internos")
      .delete()
      .eq("id", data.id)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error(`Não foi possível desmarcar: ${error.message}`);
    return { ok: true };
  });
