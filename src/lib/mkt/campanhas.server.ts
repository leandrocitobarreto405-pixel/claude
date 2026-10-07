/**
 * Preparação das campanhas do calendário e conferência dos modelos na Meta (via Chatwoot).
 *
 * Preparar = recalcular grupos, montar lotes e estimativa (mkt_preparar_campanha) e conferir se
 * todo modelo que vai sair (com e sem nome) existe, está aprovado e dá para preencher com a
 * condição da campanha. Modelo com problema → campanha bloqueada + aviso.
 */
import { configMkt, log, rpc, type Db } from "./contexto.server";
import { preencher, situacaoModelo, textoCondicao, type ModeloMeta } from "./modelos";

export function hojeSP(agora = new Date()) {
  return agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export async function avisar(
  db: Db,
  empresaId: string,
  tipo: string,
  titulo: string,
  mensagem: string,
  campanhaId: string | null = null,
  umPorDia = false,
) {
  if (umPorDia) {
    let q = db
      .from("mkt_avisos")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("tipo", tipo)
      .gte("created_at", new Date(Date.now() - 20 * 3600_000).toISOString());
    q = campanhaId ? q.eq("campanha_id", campanhaId) : q.is("campanha_id", null);
    const { data } = await q.limit(1);
    if (data?.length) return;
  }
  const { error } = await db.from("mkt_avisos").insert({
    empresa_id: empresaId,
    tipo,
    titulo,
    mensagem,
    campanha_id: campanhaId,
  });
  if (error) throw error;
  log("INFO", "aviso", { empresa: empresaId, tipo, titulo });
}

export type PreviaContato = {
  nome: string | null;
  telefone: string;
  grupo: string | null;
  modelo: string;
  texto: string | null;
  botoes: string[];
  erro: string | null;
};

export type Conferencia = {
  modelos: Array<{ nome: string; envios: number; ok: boolean; erro: string | null }>;
  previa: PreviaContato[];
  problemas: string[];
};

type EnvioPrevia = {
  template_nome: string;
  variante_sn: boolean;
  grupo: string | null;
  normalized_phone: string;
  mkt_contatos: { nome: string | null; primeiro_nome: string | null } | null;
};

/** Confere os modelos da campanha e monta a prévia com 3 contatos reais (2 com nome, 1 sem). */
export async function conferirCampanha(
  db: Db,
  campanhaId: string,
  modelosProntos?: ModeloMeta[],
  /** Só os envios deste lote (lembretes do dia). */
  loteId?: string,
  /** Preparo e aprovação: pede ao Chatwoot para atualizar os modelos antes de conferir. */
  opcoes: { sincronizar?: boolean } = {},
): Promise<Conferencia> {
  const { data: k, error } = await db
    .from("mkt_campanhas")
    .select("id, empresa_id, condicao_texto, condicao_pct")
    .eq("id", campanhaId)
    .single();
  if (error) throw error;
  const cfg = await configMkt(db, k.empresa_id);
  const { data: envios, error: e2 } = await db
    .from("mkt_envios")
    .select(
      "template_nome, variante_sn, grupo, normalized_phone, mkt_contatos(nome, primeiro_nome)",
    )
    .eq("campanha_id", campanhaId)
    .neq("status", "cancelado")
    .match(loteId ? { lote_id: loteId } : {})
    .order("ordem")
    .limit(5000);
  if (e2) throw e2;
  const lista = (envios ?? []) as unknown as EnvioPrevia[];
  const condicao = textoCondicao(k.condicao_texto, k.condicao_pct);

  let modelos = modelosProntos;
  let erroChatwoot: string | null = null;
  if (!modelos) {
    try {
      // A lista do Chatwoot pode estar atrasada: atualiza e, se ainda divergir, vale a Meta.
      const { modelosAtualizados } = await import("./modelos-situacao.server");
      const sit = await modelosAtualizados(db, k.empresa_id, {
        sincronizar: opcoes.sincronizar === true,
        precisa: [...new Set(lista.map((e) => e.template_nome))],
        idioma: cfg.template_idioma,
      });
      modelos = sit.modelos;
    } catch (e) {
      erroChatwoot = `não consegui ler os modelos no Chatwoot: ${e instanceof Error ? e.message : String(e)}`;
      modelos = [];
    }
  }

  const porModelo = new Map<string, number>();
  for (const e of lista) porModelo.set(e.template_nome, (porModelo.get(e.template_nome) ?? 0) + 1);
  const conf: Conferencia = { modelos: [], previa: [], problemas: [] };
  if (erroChatwoot) conf.problemas.push(erroChatwoot);
  for (const [nome, n] of porModelo) {
    const sit = situacaoModelo(modelos, nome, cfg.template_idioma);
    let erro = sit.ok ? null : sit.erro;
    if (sit.ok) {
      // Preenche com um nome de exemplo: o que falhar aqui falha para todos.
      const p = preencher(sit.modelo, {
        primeiroNome: nome.endsWith("_sn") ? null : "Ana",
        condicao,
      });
      if (!p.ok) erro = p.erro;
    }
    conf.modelos.push({ nome, envios: n, ok: !erro, erro });
    if (erro && !erroChatwoot) conf.problemas.push(erro);
  }

  const escolhidos = [
    ...lista.filter((e) => !e.variante_sn).slice(0, 2),
    ...lista.filter((e) => e.variante_sn).slice(0, 1),
  ];
  for (const e of [...escolhidos, ...lista.filter((x) => !escolhidos.includes(x))].slice(0, 3)) {
    const sit = situacaoModelo(modelos, e.template_nome, cfg.template_idioma);
    const p = sit.ok
      ? preencher(sit.modelo, {
          primeiroNome: e.variante_sn ? null : (e.mkt_contatos?.primeiro_nome ?? null),
          condicao,
        })
      : null;
    conf.previa.push({
      nome: e.mkt_contatos?.nome ?? null,
      telefone: e.normalized_phone,
      grupo: e.grupo,
      modelo: e.template_nome,
      texto: p?.ok ? p.texto : null,
      botoes: p?.ok ? p.botoes : [],
      erro: !sit.ok ? sit.erro : p && !p.ok ? p.erro : null,
    });
  }
  return conf;
}

export type Estimativa = {
  total?: number;
  por_grupo?: Record<string, number>;
  por_modelo?: Record<string, number>;
  sem_nome?: number;
  custo?: number;
  lotes?: number;
  datas?: string[];
  previa_dia1?: boolean;
} | null;

export type ResultadoPreparo = {
  campanha_id: string;
  situacao: "aguardando_aprovacao" | "bloqueada";
  estimativa: Estimativa;
  problemas: string[];
};

/**
 * Falha ao preparar/aprovar fica escrita no cartão da campanha (motivo_status), além do aviso na
 * tela. Não muda a situação; o próximo preparo ou aprovação com sucesso limpa o texto.
 */
export async function registrarFalhaNoCartao(
  db: Db,
  campanhaId: string,
  etapa: "preparar" | "aprovar",
  erro: unknown,
) {
  const texto = erro instanceof Error ? erro.message : String(erro);
  await db
    .from("mkt_campanhas")
    .update({ motivo_status: `Falha ao ${etapa}: ${texto}`.slice(0, 500) })
    .eq("id", campanhaId)
    .in("status", ["rascunho", "aguardando_aprovacao"]);
}

export async function prepararCampanha(
  db: Db,
  campanhaId: string,
  opcoes: { hoje?: string; automatico?: boolean; modelos?: ModeloMeta[] } = {},
): Promise<ResultadoPreparo> {
  let estimativa: Estimativa;
  try {
    estimativa = await rpc<Estimativa>(db, "mkt_preparar_campanha", {
      _campanha: campanhaId,
      _hoje: opcoes.hoje ?? null,
    });
  } catch (e) {
    await registrarFalhaNoCartao(db, campanhaId, "preparar", e);
    throw e;
  }
  // Quem foi tirado à mão (desta ou da original) continua fora depois de preparar de novo.
  if (await aplicarRetirados(db, campanhaId)) {
    const { data: atual } = await db
      .from("mkt_campanhas")
      .select("estimativa")
      .eq("id", campanhaId)
      .maybeSingle();
    estimativa = (atual?.estimativa ?? estimativa) as Estimativa;
  }
  const conf = await conferirCampanha(db, campanhaId, opcoes.modelos, undefined, {
    sincronizar: true,
  });
  const { data: k } = await db
    .from("mkt_campanhas")
    .select("empresa_id, nome, datas_disparo")
    .eq("id", campanhaId)
    .single();
  if (conf.problemas.length) {
    const motivo = conf.problemas.join("; ");
    await rpc(db, "mkt_encerrar_campanha", {
      _campanha: campanhaId,
      _status: "bloqueada",
      _motivo: motivo,
    });
    if (k)
      await avisar(
        db,
        k.empresa_id,
        "campanha_bloqueada",
        "Campanha bloqueada",
        `A campanha "${k.nome}" foi bloqueada: ${motivo}. Nada vai sair até o modelo estar aprovado e a campanha ser preparada de novo.`,
        campanhaId,
      );
    log("WARNING", "campanha.bloqueada", { campanha: campanhaId, motivo });
    return {
      campanha_id: campanhaId,
      situacao: "bloqueada",
      estimativa,
      problemas: conf.problemas,
    };
  }
  if (k && opcoes.automatico) {
    const e = estimativa;
    const primeira = [...(k.datas_disparo ?? [])].sort()[0];
    await avisar(
      db,
      k.empresa_id,
      "campanha_para_aprovar",
      "Campanha para aprovar",
      `A campanha "${k.nome}" está pronta: ${e?.total ?? 0} contatos, custo estimado R$ ${Number(
        e?.custo ?? 0,
      )
        .toFixed(2)
        .replace(
          ".",
          ",",
        )}. Primeiro disparo em ${formatarData(primeira)}. Aprove ou recuse no Nexa até a véspera.`,
      campanhaId,
    );
  }
  log("INFO", "campanha.preparada", { campanha: campanhaId, estimativa });
  return {
    campanha_id: campanhaId,
    situacao: "aguardando_aprovacao",
    estimativa,
    problemas: [],
  };
}

export function formatarData(iso: string | undefined | null) {
  if (!iso) return "-";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

// ---------------------------------------------------------------- tirar pessoas antes de aprovar
export const MOTIVO_TIRADO = "tirado da campanha antes de aprovar";
export const MOTIVO_MANUAL = "já chamado manualmente";
/** Situações em que ainda dá para tirar ou devolver pessoas (antes de aprovar). */
export const ANTES_DE_APROVAR = ["rascunho", "aguardando_aprovacao", "bloqueada"];

function pedacos<T>(lista: T[], tamanho = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

/** A campanha e as de origem ("Mandar para quem ficou de fora" do "Mandar..."), até 5 níveis. */
async function cadeiaDeOrigem(db: Db, campanhaId: string): Promise<string[]> {
  const ids = [campanhaId];
  let atual = campanhaId;
  for (let i = 0; i < 5; i++) {
    const { data } = await db
      .from("mkt_campanhas")
      .select("repete_de")
      .eq("id", atual)
      .maybeSingle();
    const origem = data?.repete_de as string | null | undefined;
    if (!origem || ids.includes(origem)) break;
    ids.push(origem);
    atual = origem;
  }
  return ids;
}

/**
 * Depois de preparar: quem foi tirado à mão desta campanha (ou da original, no "Mandar para quem
 * ficou de fora") não entra. Devolve quantos ficaram de fora.
 */
export async function aplicarRetirados(db: Db, campanhaId: string): Promise<number> {
  const ids = await cadeiaDeOrigem(db, campanhaId);
  const { data: ret } = await db
    .from("mkt_campanha_retirados")
    .select("contato_id")
    .in("campanha_id", ids);
  const contatos = [...new Set((ret ?? []).map((r) => r.contato_id as string))];
  if (!contatos.length) return 0;
  let n = 0;
  for (const parte of pedacos(contatos)) {
    const { data } = await db
      .from("mkt_envios")
      .update({ status: "cancelado", erro: MOTIVO_TIRADO })
      .eq("campanha_id", campanhaId)
      .in("contato_id", parte)
      .in("status", ["pendente", "manual"])
      .select("id");
    n += data?.length ?? 0;
  }
  if (n) await recontarCampanha(db, campanhaId);
  return n;
}

/** Quantidade dos lotes e estimativa (pessoas e custo) sem quem foi tirado. */
export async function recontarCampanha(db: Db, campanhaId: string) {
  const [{ data: lotes }, { data: k }] = await Promise.all([
    db.from("mkt_lotes").select("id").eq("campanha_id", campanhaId),
    db
      .from("mkt_campanhas")
      .select("estimativa, custo_msg_estimado")
      .eq("id", campanhaId)
      .maybeSingle(),
  ]);
  let total = 0;
  for (const l of lotes ?? []) {
    const { count } = await db
      .from("mkt_envios")
      .select("id", { count: "exact", head: true })
      .eq("lote_id", l.id)
      .neq("status", "cancelado");
    total += count ?? 0;
    await db
      .from("mkt_lotes")
      .update({ quantidade: count ?? 0 })
      .eq("id", l.id);
  }
  const contar = async (motivo: string) =>
    (
      await db
        .from("mkt_envios")
        .select("id", { count: "exact", head: true })
        .eq("campanha_id", campanhaId)
        .eq("status", "cancelado")
        .eq("erro", motivo)
    ).count ?? 0;
  const [tirados, manuais] = await Promise.all([contar(MOTIVO_TIRADO), contar(MOTIVO_MANUAL)]);
  const est = (k?.estimativa ?? {}) as Record<string, unknown>;
  await db
    .from("mkt_campanhas")
    .update({
      estimativa: {
        ...est,
        total,
        custo: Math.round(total * Number(k?.custo_msg_estimado ?? 0) * 100) / 100,
        tirados,
        chamados_manualmente: manuais,
      } as never,
    })
    .eq("id", campanhaId);
}

/** Tira (ou devolve) uma pessoa da campanha antes de aprovar. */
export async function tirarOuDevolver(
  db: Db,
  o: {
    empresaId: string;
    campanhaId: string;
    contatoId: string;
    userId: string;
    devolver: boolean;
  },
) {
  if (o.devolver) {
    await db
      .from("mkt_campanha_retirados")
      .delete()
      .eq("campanha_id", o.campanhaId)
      .eq("contato_id", o.contatoId)
      .eq("empresa_id", o.empresaId);
    await db
      .from("mkt_envios")
      .update({ status: "pendente", erro: null })
      .eq("campanha_id", o.campanhaId)
      .eq("contato_id", o.contatoId)
      .eq("status", "cancelado")
      .eq("erro", MOTIVO_TIRADO);
  } else {
    const { error } = await db.from("mkt_campanha_retirados").upsert(
      {
        empresa_id: o.empresaId,
        campanha_id: o.campanhaId,
        contato_id: o.contatoId,
        retirado_por: o.userId,
      },
      { onConflict: "campanha_id,contato_id" },
    );
    if (error) throw new Error(`Não foi possível tirar: ${error.message}`);
    await db
      .from("mkt_envios")
      .update({ status: "cancelado", erro: MOTIVO_TIRADO })
      .eq("campanha_id", o.campanhaId)
      .eq("contato_id", o.contatoId)
      .in("status", ["pendente", "manual"]);
  }
  await recontarCampanha(db, o.campanhaId);
}

/**
 * Quem foi marcado "já chamei manualmente" há menos do limite sai das campanhas ainda não
 * aprovadas (conta como marketing naquele dia). Devolve quantas mensagens deixaram de sair.
 */
export async function tirarChamadosManualmente(db: Db, empresaId: string): Promise<number> {
  const { limite_marketing_dias } = await configMkt(db, empresaId);
  const corte = new Date(Date.now() - Number(limite_marketing_dias ?? 30) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data: campanhas } = await db
    .from("mkt_campanhas")
    .select("id")
    .eq("empresa_id", empresaId)
    .in("status", ANTES_DE_APROVAR);
  let n = 0;
  for (const k of campanhas ?? []) {
    const { data: envios } = await db
      .from("mkt_envios")
      .select("id, mkt_contatos!inner(chamado_manual_em)")
      .eq("campanha_id", k.id)
      .in("status", ["pendente", "manual"])
      .gte("mkt_contatos.chamado_manual_em", corte)
      .limit(5000);
    const ids = (envios ?? []).map((e) => e.id as string);
    if (!ids.length) continue;
    for (const parte of pedacos(ids)) {
      await db
        .from("mkt_envios")
        .update({ status: "cancelado", erro: MOTIVO_MANUAL })
        .in("id", parte);
    }
    n += ids.length;
    await recontarCampanha(db, k.id);
  }
  return n;
}
