/**
 * Rotinas do marketing.
 *
 * Diária (9h, Cloud Scheduler), por empresa com marketing configurado:
 *  - dia 1: recalcula os grupos e deixa encaminhada a próxima campanha (estimativa);
 *  - campanha não aprovada até a véspera do primeiro disparo: expira (nada sai) e avisa;
 *    na véspera, lembra que a aprovação vence hoje;
 *  - D-10 (dias_antes_preparo): prepara sozinha a campanha do calendário (grupos, lotes, modelos,
 *    custo) e avisa que tem campanha para aprovar; modelo sem aprovação na Meta bloqueia e avisa;
 *  - gatilhos do dia (C1, C2, C3 e lembrete): com a flag ligada vão para a fila; desligada ficam
 *    na tela "Gatilhos de hoje" para envio manual;
 *  - segunda-feira: resumo da semana (enviados, respostas, vendas, opt-outs).
 * Nada aqui envia mensagem para cliente: o envio é só pelo disparo (mkt-disparo), com as flags.
 *
 * A cada minuto (junto com o disparo): tarefas no Chatwoot (etiqueta de opt-out, prioridade) e
 * avisos no WhatsApp do dono (se ligado).
 */
import { dbServico, contextoEmpresa, log, rpc, type Db } from "./contexto.server";
import { avisar, formatarData, hojeSP, prepararCampanha } from "./campanhas.server";
import {
  conversaExistente,
  criarConversa,
  enviarModelo,
  etiquetarContato,
  etiquetarConversa,
  garantirContato,
  modelosDaCaixa,
  prioridadeUrgente,
} from "./chatwoot.server";
import { situacaoModelo, templateParams, variaveis } from "./modelos";

const somarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const dinheiro = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

type CampanhaCal = {
  id: string;
  nome: string;
  status: string;
  datas_disparo: string[];
  grupos: string[];
  limites: Record<string, number> | null;
  custo_msg_estimado: number;
};

const primeiraData = (k: { datas_disparo: string[] | null }) =>
  [...(k.datas_disparo ?? [])].sort()[0];

export type ResultadoRotina = {
  empresa_id: string;
  hoje: string;
  feito: string[];
  erros: string[];
};

async function rotinaEmpresa(db: Db, empresaId: string, hoje: string): Promise<ResultadoRotina> {
  const r: ResultadoRotina = { empresa_id: empresaId, hoje, feito: [], erros: [] };
  const passo = async (nome: string, f: () => Promise<string | void>) => {
    try {
      const x = await f();
      if (x) r.feito.push(`${nome}: ${x}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r.erros.push(`${nome}: ${msg}`);
      log("ERROR", `rotina.${nome}.erro`, { empresa: empresaId, erro: msg });
    }
  };
  const { data: cfg } = await db
    .from("mkt_configuracoes")
    .select("*")
    .eq("empresa_id", empresaId)
    .single();
  if (!cfg) return r;
  const { data: cals } = await db
    .from("mkt_campanhas")
    .select("id, nome, status, datas_disparo, grupos, limites, custo_msg_estimado")
    .eq("empresa_id", empresaId)
    .eq("tipo", "calendario")
    .in("status", ["rascunho", "aguardando_aprovacao", "bloqueada"]);
  const campanhas = (cals ?? []) as unknown as CampanhaCal[];

  // Dia 1: grupos do mês + próxima campanha encaminhada.
  if (hoje.endsWith("-01")) {
    await passo("grupos", async () => {
      const g = await rpc<{ grupos?: Record<string, number> }>(db, "mkt_calcular_grupos", {
        _emp: empresaId,
        _hoje: hoje,
      });
      const grupos = g?.grupos ?? {};
      const proximas = campanhas
        .filter((k) => k.status === "rascunho" && primeiraData(k))
        .filter((k) => primeiraData(k)! >= hoje && primeiraData(k)! <= somarDias(hoje, 45));
      for (const k of proximas) {
        const porGrupo: Record<string, number> = {};
        for (const gr of k.grupos)
          porGrupo[gr] = Math.min(grupos[gr] ?? 0, k.limites?.[gr] ?? Number.MAX_SAFE_INTEGER);
        const total = Object.values(porGrupo).reduce((a, b) => a + b, 0);
        const custo = Math.round(total * Number(k.custo_msg_estimado) * 100) / 100;
        await db
          .from("mkt_campanhas")
          .update({ estimativa: { previa_dia1: true, por_grupo: porGrupo, total, custo } })
          .eq("id", k.id);
        await avisar(
          db,
          empresaId,
          "campanha_encaminhada",
          "Próxima campanha encaminhada",
          `"${k.nome}": cerca de ${total} contatos, ${dinheiro(custo)}. Primeiro disparo em ${formatarData(
            primeiraData(k),
          )}; o Nexa prepara ${cfg.dias_antes_preparo} dias antes e te avisa para aprovar.`,
          k.id,
          true,
        );
      }
      return `grupos ${JSON.stringify(grupos)}; encaminhadas ${proximas.length}`;
    });
  }

  // Expira o que não foi aprovado até a véspera; lembra na véspera.
  await passo("prazo", async () => {
    let expiradas = 0;
    for (const k of campanhas) {
      const d = primeiraData(k);
      if (!d) continue;
      if (d <= hoje) {
        await rpc(db, "mkt_encerrar_campanha", {
          _campanha: k.id,
          _status: "expirada",
          _motivo: "não aprovada até a véspera do primeiro disparo",
        });
        await avisar(
          db,
          empresaId,
          "campanha_expirada",
          "Campanha não saiu",
          `A campanha "${k.nome}" não foi aprovada até a véspera (${formatarData(
            somarDias(d, -1),
          )}) e não foi enviada.`,
          k.id,
        );
        expiradas++;
      } else if (k.status === "aguardando_aprovacao" && d === somarDias(hoje, 1)) {
        await avisar(
          db,
          empresaId,
          "aprovacao_vence_hoje",
          "Aprovação vence hoje",
          `A campanha "${k.nome}" sai amanhã (${formatarData(d)}) se for aprovada hoje. Sem aprovação, nada é enviado.`,
          k.id,
          true,
        );
      }
    }
    return expiradas ? `expiradas ${expiradas}` : undefined;
  });

  // D-10: prepara sozinha e pede aprovação.
  if (cfg.preparo_automatico) {
    await passo("preparo", async () => {
      const prontas: string[] = [];
      for (const k of campanhas) {
        const d = primeiraData(k);
        if (k.status !== "rascunho" || !d) continue;
        // Precisa de pelo menos um dia para aprovar (a véspera é o limite).
        if (d > somarDias(hoje, cfg.dias_antes_preparo) || d <= somarDias(hoje, 1)) continue;
        const p = await prepararCampanha(db, k.id, { hoje, automatico: true });
        prontas.push(`${k.nome} (${p.situacao})`);
      }
      return prontas.length ? prontas.join(", ") : undefined;
    });
  }

  // Gatilhos do dia.
  await passo("gatilhos", async () => {
    const g = await rpc(db, "mkt_gerar_gatilhos", { _emp: empresaId, _hoje: hoje });
    return JSON.stringify(g);
  });

  // Resumo do dia para a equipe (opção da tela Avisos).
  if (cfg.aviso_resumo_diario) {
    await passo("resumo_dia", async () => {
      const { avisoResumoDoDia } = await import("./avisos-equipe.server");
      return avisoResumoDoDia(db, empresaId, hoje);
    });
  }

  // Segunda-feira: resumo da semana.
  if (new Date(`${hoje}T12:00:00Z`).getUTCDay() === 1) {
    await passo("resumo", async () => {
      type Resumo = {
        enviados?: number;
        respostas?: number;
        vendas?: number;
        valor?: number;
        manuais_pendentes?: number;
      };
      const gat = await rpc<Record<string, Resumo>>(db, "mkt_resumo_gatilhos", {
        _emp: empresaId,
        _dias: 7,
      });
      const desde = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data: env } = await db
        .from("mkt_envios")
        .select("status, respondido_em, work_order_id, valor_venda, mkt_campanhas!inner(tipo)")
        .eq("empresa_id", empresaId)
        .eq("mkt_campanhas.tipo", "calendario")
        .gte("enviado_em", desde);
      const { count: optouts } = await db
        .from("mkt_contatos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .gte("optout_em", desde);
      const cal = env ?? [];
      const soma = (f: (x: Resumo) => number) =>
        Object.values(gat ?? {}).reduce((a, x) => a + f(x), 0);
      const texto = [
        `Gatilhos: ${soma((x) => x.enviados ?? 0)} enviados, ${soma((x) => x.respostas ?? 0)} respostas, ${soma(
          (x) => x.vendas ?? 0,
        )} vendas (${dinheiro(soma((x) => Number(x.valor ?? 0)))}), ${soma((x) => x.manuais_pendentes ?? 0)} esperando envio manual.`,
        `Campanhas: ${cal.filter((e) => e.status === "enviado").length} enviados, ${
          cal.filter((e) => e.respondido_em).length
        } respostas, ${cal.filter((e) => e.work_order_id).length} vendas (${dinheiro(
          cal.reduce((a, e) => a + Number(e.valor_venda ?? 0), 0),
        )}).`,
        `Opt-outs na semana: ${optouts ?? 0}.`,
      ].join(" ");
      await avisar(db, empresaId, "resumo_semanal", "Resumo da semana", texto, null, true);
      return texto;
    });
  }
  log(r.erros.length ? "WARNING" : "INFO", "rotina.diaria", r);
  return r;
}

export async function rotinaDiaria(opcoes: { hoje?: string; empresaId?: string | null } = {}) {
  const db = await dbServico();
  const hoje = opcoes.hoje ?? hojeSP();
  let q = db.from("mkt_configuracoes").select("empresa_id");
  if (opcoes.empresaId) q = q.eq("empresa_id", opcoes.empresaId);
  const { data, error } = await q;
  if (error) throw error;
  const resultados: ResultadoRotina[] = [];
  for (const { empresa_id } of data ?? [])
    resultados.push(await rotinaEmpresa(db, empresa_id, hoje));
  return resultados;
}

// ---------------------------------------------------------------- tarefas no Chatwoot
type Tarefa = {
  id: string;
  empresa_id: string;
  tipo: "etiqueta_optout" | "prioridade_urgente";
  tentativas: number;
  conversas: {
    chatwoot_conversation_id: number;
    whatsapp_contacts: { chatwoot_contact_id: number | null } | null;
  } | null;
};

const ETIQUETA_CAMPANHA = (e: string) => /^(camp|gat)-/.test(e);

export async function processarTarefas(limite = 20) {
  const db = await dbServico();
  const { data } = await db
    .from("mkt_tarefas")
    .select(
      "id, empresa_id, tipo, tentativas, conversas(chatwoot_conversation_id, whatsapp_contacts(chatwoot_contact_id))",
    )
    .eq("situacao", "pendente")
    .order("created_at")
    .limit(limite);
  let feitas = 0;
  let erros = 0;
  for (const t of (data ?? []) as unknown as Tarefa[]) {
    try {
      const ctx = await contextoEmpresa(db, t.empresa_id);
      const conversa = t.conversas?.chatwoot_conversation_id;
      const token = ctx.tokenRobo ?? ctx.tokenAdmin;
      if (!token) throw new Error("sem token do Chatwoot");
      if (t.tipo === "prioridade_urgente") {
        if (!conversa) throw new Error("sem conversa");
        await prioridadeUrgente(ctx.conta, token, conversa);
      } else {
        // Opt-out: tira as etiquetas de campanha e põe "optout" na conversa e no contato.
        if (conversa)
          await etiquetarConversa(ctx.conta, token, conversa, ["optout"], ETIQUETA_CAMPANHA);
        const contato = t.conversas?.whatsapp_contacts?.chatwoot_contact_id;
        if (contato && ctx.tokenAdmin)
          await etiquetarContato(ctx.conta, ctx.tokenAdmin, contato, ["optout"], ETIQUETA_CAMPANHA);
      }
      await db
        .from("mkt_tarefas")
        .update({
          situacao: "feita",
          feita_em: new Date().toISOString(),
          tentativas: t.tentativas + 1,
        })
        .eq("id", t.id);
      feitas++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .from("mkt_tarefas")
        .update({
          tentativas: t.tentativas + 1,
          erro: msg.slice(0, 500),
          ...(t.tentativas + 1 >= 5 ? { situacao: "erro" as const } : {}),
        })
        .eq("id", t.id);
      erros++;
      log("WARNING", "tarefa.erro", { tarefa: t.id, tipo: t.tipo, erro: msg });
    }
  }
  return { feitas, erros };
}

// ---------------------------------------------------------------- avisos no WhatsApp do dono
/** Parâmetro de modelo do WhatsApp não aceita quebra de linha nem muitos espaços. */
export function textoDoAviso(titulo: string, mensagem: string) {
  return `${titulo}: ${mensagem}`.replace(/\s+/g, " ").trim().slice(0, 900);
}

export async function processarAvisosWhatsapp() {
  const db = await dbServico();
  const { data: cfgs } = await db
    .from("mkt_configuracoes")
    .select("empresa_id, aviso_telefone, aviso_template_nome, template_idioma, updated_at")
    .eq("aviso_whatsapp_ligado", true);
  let enviados = 0;
  let erros = 0;
  for (const cfg of cfgs ?? []) {
    // Só avisos das últimas 24 h (ligar a opção não despeja o histórico no WhatsApp).
    const desde = new Date(Math.max(Date.now() - 86400_000, Date.parse(cfg.updated_at) - 60_000));
    const { data: avisos } = await db
      .from("mkt_avisos")
      .select("id, titulo, mensagem")
      .eq("empresa_id", cfg.empresa_id)
      .is("whatsapp_enviado_em", null)
      .is("whatsapp_erro", null)
      .gte("created_at", desde.toISOString())
      .order("created_at")
      .limit(10);
    if (!avisos?.length) continue;
    try {
      // Trava: o aviso é só para a equipe. Se o número configurado for de um cliente, nada sai.
      const { numeroEhDeCliente } = await import("./avisos-equipe.server");
      if (await numeroEhDeCliente(db, cfg.empresa_id, cfg.aviso_telefone))
        throw new Error("o telefone do aviso é de um cliente; nada foi enviado");
      const ctx = await contextoEmpresa(db, cfg.empresa_id);
      if (!ctx.tokenAdmin || !ctx.tokenRobo) throw new Error("tokens do Chatwoot não configurados");
      const modelos = await modelosDaCaixa(ctx.conta, ctx.tokenAdmin, ctx.caixa);
      const sit = situacaoModelo(modelos, cfg.aviso_template_nome ?? "", cfg.template_idioma);
      if (!sit.ok) throw new Error(sit.erro);
      const fone = (cfg.aviso_telefone ?? "").replace(/\D/g, "");
      const numero = fone.length <= 11 ? `55${fone}` : fone;
      const contato = await garantirContato(
        ctx.conta,
        ctx.tokenAdmin,
        ctx.caixa,
        numero,
        null,
        null,
      );
      const conversa =
        (await conversaExistente(ctx.conta, ctx.tokenAdmin, contato.id, ctx.caixa)) ??
        (await criarConversa(ctx.conta, ctx.tokenRobo, ctx.caixa, contato, numero, "open"));
      const corpo =
        sit.modelo.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";
      const vars = variaveis(corpo);
      for (const a of avisos) {
        const texto = textoDoAviso(a.titulo, a.mensagem);
        // Modelo de aviso: uma variável só no corpo, com o texto do aviso.
        const p =
          vars.length === 1
            ? {
                ok: true as const,
                parametros: { [vars[0]!]: texto },
                texto: corpo.replace(/\{\{[^}]+\}\}/, texto),
              }
            : {
                ok: false as const,
                erro: `modelo de aviso precisa de exatamente 1 variável (tem ${vars.length})`,
              };
        try {
          if (!p.ok) throw new Error(p.erro);
          await enviarModelo(
            ctx.conta,
            ctx.tokenRobo,
            conversa,
            p.texto,
            templateParams(sit.modelo, p.parametros),
          );
          await db
            .from("mkt_avisos")
            .update({ whatsapp_enviado_em: new Date().toISOString() })
            .eq("id", a.id);
          enviados++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await db
            .from("mkt_avisos")
            .update({ whatsapp_erro: msg.slice(0, 500) })
            .eq("id", a.id);
          erros++;
        }
      }
    } catch (e) {
      erros++;
      log("WARNING", "aviso_whatsapp.erro", {
        empresa: cfg.empresa_id,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { enviados, erros };
}
