/**
 * Preparação das campanhas do calendário e conferência dos modelos na Meta (via Chatwoot).
 *
 * Preparar = recalcular grupos, montar lotes e estimativa (mkt_preparar_campanha) e conferir se
 * todo modelo que vai sair (com e sem nome) existe, está aprovado e dá para preencher com a
 * condição da campanha. Modelo com problema → campanha bloqueada + aviso.
 */
import { configMkt, contextoEmpresa, log, rpc, type Db } from "./contexto.server";
import { modelosDaCaixa } from "./chatwoot.server";
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
): Promise<Conferencia> {
  const { data: k, error } = await db
    .from("mkt_campanhas")
    .select("id, empresa_id, condicao_texto, condicao_pct")
    .eq("id", campanhaId)
    .single();
  if (error) throw error;
  const cfg = await configMkt(db, k.empresa_id);
  let modelos = modelosProntos;
  let erroChatwoot: string | null = null;
  if (!modelos) {
    try {
      const ctx = await contextoEmpresa(db, k.empresa_id);
      if (!ctx.tokenAdmin) throw new Error("token de API do Chatwoot não configurado");
      modelos = await modelosDaCaixa(ctx.conta, ctx.tokenAdmin, ctx.caixa);
    } catch (e) {
      erroChatwoot = `não consegui ler os modelos no Chatwoot: ${e instanceof Error ? e.message : String(e)}`;
      modelos = [];
    }
  }
  const { data: envios, error: e2 } = await db
    .from("mkt_envios")
    .select(
      "template_nome, variante_sn, grupo, normalized_phone, mkt_contatos(nome, primeiro_nome)",
    )
    .eq("campanha_id", campanhaId)
    .neq("status", "cancelado")
    .order("ordem")
    .limit(5000);
  if (e2) throw e2;
  const lista = (envios ?? []) as unknown as EnvioPrevia[];
  const condicao = textoCondicao(k.condicao_texto, k.condicao_pct);

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

export async function prepararCampanha(
  db: Db,
  campanhaId: string,
  opcoes: { hoje?: string; automatico?: boolean; modelos?: ModeloMeta[] } = {},
): Promise<ResultadoPreparo> {
  const estimativa = await rpc<Estimativa>(db, "mkt_preparar_campanha", {
    _campanha: campanhaId,
    _hoje: opcoes.hoje ?? null,
  });
  const conf = await conferirCampanha(db, campanhaId, opcoes.modelos);
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
