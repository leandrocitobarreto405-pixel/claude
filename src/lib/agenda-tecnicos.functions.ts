// Configurações › Agenda › "Agenda dos técnicos no WhatsApp" (só admin). O modelo é por número:
// cada empresa cadastra o agenda_tecnico_dia no próprio WhatsApp, e "Ativar" só libera com ele
// aprovado (Utilidade) no número da própria empresa. O envio nasce DESLIGADO.
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresaGravavel } from "@/lib/empresa.middleware";
import {
  TEXTO_SITUACAO_MODELO,
  agoraSP,
  diaSeguinte,
  podeAtivarAgenda,
  type SituacaoModeloAgenda,
} from "@/lib/agenda-tecnicos";

const ID = /^[0-9a-f-]{36}$/i;

export const CHAVE_AGENDA_TECNICOS = ["agenda-tecnicos"] as const;

export type EnvioTela = {
  dia: string;
  situacao: string;
  motivo: string | null;
  via: string | null;
  servicos: number;
  teste: boolean;
  quando: string;
};

export type AgendaTecnicosTela = {
  ativo: boolean;
  hora: string;
  modelo: {
    situacao: SituacaoModeloAgenda;
    texto: string;
    motivo: string | null;
    erro: string | null;
  };
  podeAtivar: boolean;
  amanha: string;
  tecnicos: Array<{
    id: string;
    nome: string;
    telefone: string | null;
    recebe: boolean;
    parceiro: boolean;
    ativo: boolean;
    servicosAmanha: number;
    ultimo: EnvioTela | null;
  }>;
  contatosInternos: Array<{ id: string; nome: string | null; final: string }>;
};

export const agendaTecnicosFn = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<AgendaTecnicosTela> => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { estadoDoModelo, mensagensPorTecnico, tecnicosDaEmpresa } =
      await import("@/lib/agenda-tecnicos.server");
    const db = await dbServico();
    const emp = context.empresaId;
    const amanha = diaSeguinte(agoraSP().dia);
    let modelo: AgendaTecnicosTela["modelo"];
    try {
      const e = await estadoDoModelo(db, emp);
      modelo = { ...e, texto: TEXTO_SITUACAO_MODELO[e.situacao], erro: null };
    } catch (e) {
      modelo = {
        situacao: "pendente",
        texto: "Não foi possível conferir o modelo na Meta agora",
        motivo: null,
        erro: e instanceof Error ? e.message.slice(0, 300) : String(e),
      };
    }
    const [{ data: cfg }, tecnicos, porTecnico, { data: envios }, { data: internos }] =
      await Promise.all([
        db
          .from("agenda_configuracoes")
          .select("agenda_tecnicos_ativo, agenda_tecnicos_hora")
          .eq("empresa_id", emp)
          .maybeSingle(),
        tecnicosDaEmpresa(db, emp),
        mensagensPorTecnico(db, emp, amanha),
        db
          .from("agenda_tecnicos_envios")
          .select("tecnico_id, dia_agenda, situacao, motivo, via, servicos, teste, created_at")
          .eq("empresa_id", emp)
          .order("created_at", { ascending: false })
          .limit(200),
        db.from("contatos_internos").select("id, nome, telefone").eq("empresa_id", emp),
      ]);
    return {
      ativo: Boolean(cfg?.agenda_tecnicos_ativo),
      hora: String(cfg?.agenda_tecnicos_hora ?? "18:00").slice(0, 5),
      modelo,
      podeAtivar: podeAtivarAgenda(modelo.situacao) && !modelo.erro,
      amanha,
      tecnicos: tecnicos.map((t) => {
        const u = (envios ?? []).find((e) => e.tecnico_id === t.id);
        return {
          id: t.id,
          nome: t.name,
          telefone: t.telefone,
          recebe: t.recebe_agenda,
          parceiro: t.parceiro,
          ativo: t.active,
          servicosAmanha: porTecnico.get(t.id)?.length ?? 0,
          ultimo: u
            ? {
                dia: u.dia_agenda,
                situacao: u.situacao,
                motivo: u.motivo,
                via: u.via,
                servicos: u.servicos,
                teste: u.teste,
                quando: u.created_at,
              }
            : null,
        };
      }),
      contatosInternos: (internos ?? []).map((c) => ({
        id: c.id,
        nome: c.nome,
        final: String(c.telefone ?? "").slice(-4),
      })),
    };
  });

/** Liga/desliga e horário. Ligar só com o modelo aprovado no número da própria empresa. */
export const salvarAgendaTecnicosFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, requireEmpresaGravavel])
  .inputValidator((i: { ativo: boolean; hora: string }) => {
    const hora = String(i.hora ?? "");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new Error("Horário inválido.");
    return { ativo: i.ativo === true, hora };
  })
  .handler(async ({ data, context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();
    if (data.ativo) {
      const { estadoDoModelo } = await import("@/lib/agenda-tecnicos.server");
      const e = await estadoDoModelo(db, context.empresaId);
      if (!podeAtivarAgenda(e.situacao)) throw new Error(TEXTO_SITUACAO_MODELO[e.situacao]);
    }
    const { error } = await db.from("agenda_configuracoes").upsert(
      {
        empresa_id: context.empresaId,
        agenda_tecnicos_ativo: data.ativo,
        agenda_tecnicos_hora: data.hora,
        ...(data.ativo ? { agenda_tecnicos_modelo: "agenda_tecnico_dia" } : {}),
      },
      { onConflict: "empresa_id" },
    );
    if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    return { ok: true };
  });

/** Quem recebe a agenda (técnico da equipe; parceiro fica fora). */
export const recebeAgendaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, requireEmpresaGravavel])
  .inputValidator((i: { tecnicoId: string; recebe: boolean }) => {
    if (!ID.test(String(i.tecnicoId))) throw new Error("Técnico inválido.");
    return { tecnicoId: String(i.tecnicoId), recebe: i.recebe === true };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("technicians")
      .update({ recebe_agenda: data.recebe })
      .eq("id", data.tecnicoId)
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error(`Não foi possível salvar: ${error.message}`);
    return { ok: true };
  });

/** Cadastra o agenda_tecnico_dia no número da empresa (não envia nada para ninguém). */
export const cadastrarModeloAgendaFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, requireEmpresaGravavel])
  .handler(async ({ context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { cadastrarModeloAgenda } = await import("@/lib/agenda-tecnicos.server");
    const e = await cadastrarModeloAgenda(await dbServico(), context.empresaId, context.userId);
    return { situacao: e.situacao, texto: TEXTO_SITUACAO_MODELO[e.situacao] };
  });

/**
 * Agenda de teste: a agenda de um técnico só para um contato interno da equipe (nunca para
 * cliente). Funciona com o envio automático desligado.
 */
export const enviarAgendaTesteFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, requireEmpresaGravavel])
  .inputValidator((i: { tecnicoId: string; contatoId: string; dia?: string }) => {
    if (!ID.test(String(i.tecnicoId))) throw new Error("Técnico inválido.");
    if (!ID.test(String(i.contatoId))) throw new Error("Escolha o contato interno.");
    const dia = i.dia && /^\d{4}-\d{2}-\d{2}$/.test(i.dia) ? i.dia : null;
    return { tecnicoId: String(i.tecnicoId), contatoId: String(i.contatoId), dia };
  })
  .handler(async ({ data, context }) => {
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const { enviarAgenda, mensagensPorTecnico, tecnicosDaEmpresa } =
      await import("@/lib/agenda-tecnicos.server");
    const db = await dbServico();
    const emp = context.empresaId;
    const { data: contato } = await db
      .from("contatos_internos")
      .select("telefone")
      .eq("id", data.contatoId)
      .eq("empresa_id", emp)
      .maybeSingle();
    if (!contato?.telefone) throw new Error("Contato interno não encontrado.");
    const { recusarNumeroDeCliente } = await import("@/lib/mkt/avisos-equipe.server");
    await recusarNumeroDeCliente(db, emp, contato.telefone);
    const tecnico = (await tecnicosDaEmpresa(db, emp)).find((t) => t.id === data.tecnicoId);
    if (!tecnico) throw new Error("Técnico não encontrado.");
    if (tecnico.parceiro) throw new Error("Parceiro terceirizado não recebe a agenda.");
    const dia = data.dia ?? diaSeguinte(agoraSP().dia);
    const mensagens = (await mensagensPorTecnico(db, emp, dia)).get(tecnico.id) ?? [];
    if (!mensagens.length)
      throw new Error(
        `${tecnico.name} não tem atendimentos nesse dia. Escolha outro técnico ou dia.`,
      );
    const r = await enviarAgenda(db, emp, {
      tecnico,
      dia,
      mensagens,
      teste: true,
      destino: contato.telefone,
      criadoPor: context.userId,
    });
    if (r.situacao === "erro") throw new Error(`Não foi enviada: ${r.motivo}`);
    return { situacao: r.situacao, servicos: mensagens.length };
  });
