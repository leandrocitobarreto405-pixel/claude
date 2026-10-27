/**
 * Leads do site (rotina a cada 5 min, dentro da varredura da Alice):
 *  1. lê as planilhas das LPs e grava os cadastros novos pela chave (nunca grava nelas);
 *  2. confere quem chamou no WhatsApp (banco: leads_site_atualizar) e liga ao lead do CRM;
 *  3. avisos SÓ NO APP (sino): lead que não respondeu 10 min depois da mensagem automática (ou,
 *     sem ela, 10 min depois do cadastro) e o resumo das 8h de ontem. Nunca vão para o WhatsApp
 *     da equipe (so_no_app);
 *  4. envio do modelo ao lead depois de N min (padrão 5): DESLIGADO por padrão, só cadastros
 *     lidos depois de "Ativar", uma vez, 24 h (ou no horário escolhido), só número válido.
 * Nada de telefone ou nome de lead nos logs.
 */
import {
  dentroDoHorario,
  horarioSP,
  linhasNovas,
  primeiroNomeLead,
  momentoDoAviso,
  textoResumoLeads,
  textoSemChamar,
  textoSemResposta,
  type ConfigAvisoLead,
  type ContagemDia,
} from "./leads-site";
import { dbServico, log, rpc, type Db } from "./mkt/contexto.server";

/** Marca do aviso só no app (o envio para o WhatsApp da equipe também filtra so_no_app). */
const SO_NO_APP = { so_no_app: true } as const;

async function avisoNoApp(
  db: Db,
  empresaId: string,
  tipo: string,
  titulo: string,
  mensagem: string,
) {
  const { error } = await db
    .from("mkt_avisos")
    .insert({ empresa_id: empresaId, tipo, titulo, mensagem, ...SO_NO_APP });
  if (error) throw error;
}

type Planilha = {
  id: string;
  empresa_id: string;
  nome: string;
  planilha_id: string;
  aba: string;
  ultima_linha: number;
  erro: string | null;
  erro_em: string | null;
};

/**
 * Lê a aba inteira e grava só os cadastros que ainda não existem (pela chave data/hora +
 * telefone). Assim, linha apagada, inserida no meio ou aba encurtada não fazem perder nem
 * duplicar lead. Erro fica na planilha (e um aviso por dia).
 */
async function lerPlanilha(db: Db, p: Planilha, token: string, agora: Date) {
  const { lerAba } = await import("./google-planilhas.server");
  const valores = await lerAba(token, p.planilha_id, p.aba, "A1:Z");
  const [cabecalho, ...linhas] = valores;
  const r = linhasNovas(cabecalho ?? [], linhas, 2, agora);
  if (r.erro) throw new Error(r.erro);
  return rpc<{ novos: number; repetidos: number }>(db, "leads_site_registrar", {
    _planilha: p.id,
    _linhas: r.linhas,
    _ultima: Math.max(1, valores.length),
  });
}

async function marcarErro(db: Db, p: Planilha, e: unknown, agora: Date) {
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  const acao =
    e && typeof e === "object" && "acao" in e && typeof e.acao === "string" ? ` ${e.acao}` : "";
  await db
    .from("leads_site_planilhas")
    .update({ erro: `${msg}${acao}`.slice(0, 600), erro_em: agora.toISOString() })
    .eq("id", p.id);
  // Um aviso por planilha a cada 24 h (o erro continua aparecendo na tela).
  if (!p.erro_em || agora.getTime() - Date.parse(p.erro_em) > 24 * 3600_000)
    await avisoNoApp(
      db,
      p.empresa_id,
      "lead_site_erro",
      "Leads do site: não deu para ler a planilha",
      `${p.nome}: ${msg}${acao}`.slice(0, 900),
    );
  log("WARNING", "leads_site.erro_planilha", { empresa: p.empresa_id, planilha: p.id, erro: msg });
}

/**
 * Aviso no sino para quem não chamou: 10 min depois da mensagem automática (se ela foi para o
 * lead) ou 10 min depois do cadastro (mensagem desligada). Só o que vence nas últimas 2 h; uma
 * vez por lead.
 */
async function avisosSemChamar(db: Db, empresaId: string, cfg: ConfigAvisoLead, agora: Date) {
  const { data } = await db
    .from("leads_site")
    .select("id, nome, lp, cadastrado_em, created_at, telefone, modelo_enviado_em, modelo_erro")
    .eq("empresa_id", empresaId)
    .eq("situacao", "nao_chamou")
    .is("repetido_de", null)
    .is("aviso_em", null)
    .gte("cadastrado_em", new Date(agora.getTime() - 6 * 3600_000).toISOString())
    .order("cadastrado_em")
    .limit(100);
  let n = 0;
  for (const l of data ?? []) {
    const m = momentoDoAviso(l, cfg);
    if (m.quando > agora || agora.getTime() - m.quando.getTime() > 2 * 3600_000) continue;
    // Marca antes de avisar: se a rotina rodar em dobro, não repete.
    const { data: marcado } = await db
      .from("leads_site")
      .update({ aviso_em: agora.toISOString() })
      .eq("id", l.id)
      .is("aviso_em", null)
      .select("id");
    if (!marcado?.length) continue;
    await avisoNoApp(
      db,
      empresaId,
      "lead_site_sem_chamar",
      m.depoisDaMensagem ? "Lead do site não respondeu" : "Lead do site ainda não chamou",
      m.depoisDaMensagem && l.modelo_enviado_em
        ? textoSemResposta({ ...l, modelo_enviado_em: l.modelo_enviado_em })
        : textoSemChamar(l),
    );
    n++;
  }
  return n;
}

/** Resumo de ontem, depois das 8h, uma vez por dia. */
async function resumoDeOntem(db: Db, empresaId: string, agora: Date) {
  const { data: hoje, hora } = horarioSP(agora);
  if (hora < "08:00") return false;
  const ontem = new Date(Date.parse(`${hoje}T12:00:00-03:00`) - 86400_000)
    .toISOString()
    .slice(0, 10);
  const { data: ja } = await db
    .from("mkt_avisos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("tipo", "lead_site_resumo")
    .gte("created_at", `${hoje}T00:00:00-03:00`)
    .limit(1);
  if (ja?.length) return false;
  const { data } = await db
    .from("leads_site")
    .select("situacao")
    .eq("empresa_id", empresaId)
    .is("repetido_de", null)
    .gte("cadastrado_em", `${ontem}T00:00:00-03:00`)
    .lt("cadastrado_em", `${hoje}T00:00:00-03:00`);
  const lista = data ?? [];
  if (!lista.length) return false;
  const c: ContagemDia = {
    total: lista.length,
    chamou: lista.filter((l) => l.situacao === "chamou").length,
    naoChamou: lista.filter((l) => l.situacao === "nao_chamou").length,
    invalido: lista.filter((l) => l.situacao === "invalido").length,
    chamadoEquipe: lista.filter((l) => l.situacao === "chamado_equipe").length,
  };
  await avisoNoApp(
    db,
    empresaId,
    "lead_site_resumo",
    "Leads do site de ontem",
    textoResumoLeads(ontem, c),
  );
  return true;
}

/** Envio automático pulado de propósito (não é erro: a equipe já cuida desse contato). */
export class EnvioPulado extends Error {}

export type LeadParaModelo = {
  id: string;
  empresa_id: string;
  nome: string | null;
  telefone: string;
};

/**
 * Manda o modelo (ex.: tc_lead_site) para o lead pelo Chatwoot, com o token do robô, e deixa a
 * conversa com a Alice. Usado pelo envio automático e pelo botão da tela. No automático
 * (soContatoNovo), contato que já tem conversa na caixa é pulado: não puxa conversa da equipe.
 */
export async function enviarModeloAoLead(
  db: Db,
  lead: LeadParaModelo,
  nomeModelo: string,
  opcoes: { soContatoNovo?: boolean } = {},
): Promise<{ conversa: number }> {
  const { contextoEmpresa } = await import("./mkt/contexto.server");
  const ctx = await contextoEmpresa(db, lead.empresa_id);
  if (!ctx.tokenAdmin || !ctx.tokenRobo) throw new Error("tokens do Chatwoot não configurados");
  const { modelosAtualizados } = await import("./mkt/modelos-situacao.server");
  const { situacaoModelo, templateParams, variaveis } = await import("./mkt/modelos");
  const { modelos } = await modelosAtualizados(db, lead.empresa_id, {
    ctx,
    precisa: [nomeModelo],
    idioma: ctx.cfg.template_idioma,
  });
  const sit = situacaoModelo(modelos, nomeModelo, ctx.cfg.template_idioma);
  if (!sit.ok) throw new Error(sit.erro);
  const corpo = sit.modelo.components?.find((x) => x.type?.toUpperCase() === "BODY")?.text ?? "";
  const vars = variaveis(corpo);
  if (vars.length > 1)
    throw new Error(
      `o modelo ${nomeModelo} precisa ter só o nome como variável (tem ${vars.length})`,
    );
  const nome = primeiroNomeLead(lead.nome);
  const parametros: Record<string, string> = vars.length ? { [vars[0]!]: nome || "tudo bem" } : {};
  const texto = vars.length ? corpo.replace(/\{\{[^}]+\}\}/, parametros[vars[0]!]!) : corpo;
  const { garantirContato, conversaExistente, criarConversa, enviarModelo } =
    await import("./mkt/chatwoot.server");
  const { mudarSituacao } = await import("./alice/chatwoot-api.server");
  const cw = await garantirContato(
    ctx.conta,
    ctx.tokenAdmin,
    ctx.caixa,
    lead.telefone,
    nome || null,
    null,
  );
  const existente = await conversaExistente(ctx.conta, ctx.tokenAdmin, cw.id, ctx.caixa);
  if (existente && opcoes.soContatoNovo)
    throw new EnvioPulado("pulado: o contato já tem conversa no WhatsApp");
  const conversa =
    existente ??
    (await criarConversa(ctx.conta, ctx.tokenRobo, ctx.caixa, cw, lead.telefone, "pending"));
  await enviarModelo(
    ctx.conta,
    ctx.tokenRobo,
    conversa,
    texto,
    templateParams(sit.modelo, parametros),
  );
  // Quando o lead responder, a Alice atende normalmente.
  await mudarSituacao(ctx.conta, ctx.tokenRobo, conversa, "pending").catch(() => undefined);
  const { data: conv } = await db
    .from("conversas")
    .update({ status: "pending", devolvida_para_alice_em: new Date().toISOString() })
    .eq("empresa_id", lead.empresa_id)
    .eq("chatwoot_conversation_id", conversa)
    .select("id")
    .maybeSingle();
  await db
    .from("leads_site")
    .update({
      modelo_enviado_em: new Date().toISOString(),
      modelo_erro: null,
      ...(conv?.id ? { conversa_id: conv.id } : {}),
    })
    .eq("id", lead.id);
  return { conversa };
}

type ConfigLeads = {
  empresa_id: string;
  aviso_minutos: number;
  envio_ligado: boolean;
  envio_ativado_em: string | null;
  envio_apos_minutos: number;
  envio_24h: boolean;
  envio_hora_inicio: string;
  envio_hora_fim: string;
  envio_modelo: string;
};

/** Envio automático (só com "Ativar"): N min depois do cadastro, até 1 h depois; 24 h ou no horário escolhido. */
async function envioAutomatico(db: Db, cfg: ConfigLeads, agora: Date) {
  if (!cfg.envio_ligado || !cfg.envio_ativado_em) return { enviados: 0, erros: 0 };
  if (!cfg.envio_24h && !dentroDoHorario(agora, cfg.envio_hora_inicio, cfg.envio_hora_fim))
    return { enviados: 0, erros: 0 };
  const ate = new Date(agora.getTime() - cfg.envio_apos_minutos * 60_000);
  const desde = new Date(ate.getTime() - 3600_000);
  const { data } = await db
    .from("leads_site")
    .select("id, empresa_id, nome, telefone")
    .eq("empresa_id", cfg.empresa_id)
    .eq("situacao", "nao_chamou")
    .is("repetido_de", null)
    .not("telefone", "is", null)
    .is("modelo_enviado_em", null)
    .is("modelo_erro", null)
    .lte("cadastrado_em", ate.toISOString())
    .gte("cadastrado_em", desde.toISOString())
    .gte("created_at", cfg.envio_ativado_em)
    .order("cadastrado_em")
    .limit(10);
  let enviados = 0;
  let erros = 0;
  for (const l of data ?? []) {
    // Reserva: marca o erro "enviando" antes; se cair no meio, não manda de novo.
    const { data: reservado } = await db
      .from("leads_site")
      .update({ modelo_erro: "enviando" })
      .eq("id", l.id)
      .is("modelo_erro", null)
      .is("modelo_enviado_em", null)
      .select("id");
    if (!reservado?.length) continue;
    try {
      // Telefone que já tinha cadastro antes de ativar: a equipe já cuida, não manda.
      const { data: antes } = await db
        .from("leads_site")
        .select("id")
        .eq("empresa_id", cfg.empresa_id)
        .eq("telefone", l.telefone!)
        .lt("created_at", cfg.envio_ativado_em)
        .limit(1);
      if (antes?.length) throw new EnvioPulado("pulado: telefone cadastrado antes da ativação");
      await enviarModeloAoLead(db, { ...l, telefone: l.telefone! }, cfg.envio_modelo, {
        soContatoNovo: true,
      });
      enviados++;
    } catch (e) {
      if (e instanceof EnvioPulado) {
        await db.from("leads_site").update({ modelo_erro: e.message }).eq("id", l.id);
        continue;
      }
      erros++;
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      await db.from("leads_site").update({ modelo_erro: msg }).eq("id", l.id);
      await avisoNoApp(
        db,
        cfg.empresa_id,
        "lead_site_erro",
        "Leads do site: modelo não enviado",
        `${primeiroNomeLead(l.nome) || "Lead"}: ${msg}`,
      );
    }
  }
  return { enviados, erros };
}

export async function rodarLeadsSite(agora = new Date()) {
  const db = await dbServico();
  const { data: planilhas } = await db
    .from("leads_site_planilhas")
    .select("id, empresa_id, nome, planilha_id, aba, ultima_linha, erro, erro_em")
    .eq("ativa", true);
  const { data: cfgs } = await db.from("leads_site_configuracoes").select("*");
  const empresas = new Set<string>([
    ...(planilhas ?? []).map((p) => p.empresa_id),
    ...(cfgs ?? []).map((c) => c.empresa_id),
  ]);
  const r = { lidos: 0, chamaram: 0, avisos: 0, enviados: 0, erros: 0 };
  for (const empresaId of empresas) {
    try {
      const minhas = (planilhas ?? []).filter((p) => p.empresa_id === empresaId);
      if (minhas.length) {
        const { tokenDaEmpresa } = await import("./google-planilhas.server");
        let token: string | null = null;
        try {
          token = await tokenDaEmpresa(empresaId);
        } catch (e) {
          for (const p of minhas) await marcarErro(db, p, e, agora);
          r.erros++;
        }
        if (token)
          for (const p of minhas) {
            try {
              r.lidos += (await lerPlanilha(db, p, token, agora)).novos;
            } catch (e) {
              await marcarErro(db, p, e, agora);
              r.erros++;
            }
          }
      }
      r.chamaram += (
        await rpc<{ chamaram: number }>(db, "leads_site_atualizar", { _emp: empresaId })
      ).chamaram;
      const cfg = (cfgs ?? []).find((c) => c.empresa_id === empresaId) as ConfigLeads | undefined;
      r.avisos += await avisosSemChamar(
        db,
        empresaId,
        cfg ?? {
          aviso_minutos: 10,
          envio_ligado: false,
          envio_ativado_em: null,
          envio_apos_minutos: 5,
          envio_24h: true,
          envio_hora_inicio: "00:00",
          envio_hora_fim: "23:59",
        },
        agora,
      );
      if (await resumoDeOntem(db, empresaId, agora)) r.avisos++;
      if (cfg) {
        const e = await envioAutomatico(db, cfg, agora);
        r.enviados += e.enviados;
        r.erros += e.erros;
      }
    } catch (e) {
      r.erros++;
      log("ERROR", "leads_site.erro", {
        empresa: empresaId,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return r;
}
