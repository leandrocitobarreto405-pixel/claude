/**
 * Disparo das campanhas e gatilhos pelo Chatwoot (Cloud Scheduler a cada minuto).
 *
 * 1. mkt_reservar_envios: só o que já pode sair (flag ligada, campanha aprovada, lote liberado,
 *    terça a quinta a partir das 10h no calendário, 9h nos gatilhos, antes da hora limite e nunca
 *    entre 21h e 8h). Os envios já vêm espaçados (agendado_para); aqui ainda esperamos
 *    intervalo_segundos entre um e outro.
 * 2. Antes de cada mensagem, mkt_confirmar_envio (pausa no meio, flag desligada, opt-out).
 * 3. Contato e conversa no Chatwoot, modelo com o primeiro nome e a condição, etiqueta do lote.
 * 4. mkt_registrar_envio: grava o resultado e pausa sozinho o lote se passar dos limites.
 */
import {
  dbServico,
  contextoEmpresa,
  log,
  rpc,
  type ContextoEmpresa,
  type Db,
} from "./contexto.server";
import {
  conversaExistente,
  criarConversa,
  enviarModelo,
  etiquetarConversa,
  garantirContato,
  modelosDaCaixa,
} from "./chatwoot.server";
import {
  preencher,
  situacaoModelo,
  templateParams,
  textoCondicao,
  type ModeloMeta,
} from "./modelos";

type Reservado = {
  envio_id: string;
  empresa_id: string;
  campanha_id: string;
  lote_id: string;
  normalized_phone: string;
  primeiro_nome: string | null;
  template_nome: string;
  variante_sn: boolean;
  idioma: string;
  condicao_texto: string | null;
  condicao_pct: number | null;
  etiqueta: string;
  chatwoot_contact_id: number | null;
  conversa_chatwoot_id: number | null;
};

export type ResultadoDisparo = {
  reservados: number;
  enviados: number;
  erros: number;
  devolvidos: number;
  pausas: number;
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Cache = Map<string, { ctx: ContextoEmpresa; modelos: ModeloMeta[] } | { erro: string }>;

async function contextoComModelos(db: Db, cache: Cache, empresaId: string) {
  let c = cache.get(empresaId);
  if (!c) {
    try {
      const ctx = await contextoEmpresa(db, empresaId);
      if (!ctx.tokenAdmin) throw new Error("token de API do Chatwoot não configurado");
      if (!ctx.tokenRobo) throw new Error("robô da Alice não configurado no Chatwoot");
      const modelos = await modelosDaCaixa(ctx.conta, ctx.tokenAdmin, ctx.caixa);
      c = { ctx, modelos };
    } catch (e) {
      c = { erro: e instanceof Error ? e.message : String(e) };
    }
    cache.set(empresaId, c);
  }
  return c;
}

type Pronto = { modelo: ModeloMeta; texto: string; parametros: Record<string, string> };

/** Modelo aprovado e preenchível? Se não, o problema é da campanha, não do contato. */
function montar(modelos: ModeloMeta[], r: Reservado): Pronto | { erro: string } {
  const sit = situacaoModelo(modelos, r.template_nome, r.idioma);
  if (!sit.ok) return { erro: sit.erro };
  const p = preencher(sit.modelo, {
    primeiroNome: r.variante_sn ? null : r.primeiro_nome,
    condicao: textoCondicao(r.condicao_texto, r.condicao_pct),
  });
  if (!p.ok) return { erro: p.erro };
  return { modelo: sit.modelo, texto: p.texto, parametros: p.parametros };
}

/** Problema geral (modelo, Chatwoot): pausa a campanha inteira e avisa, sem gastar envios. */
async function pausarPorProblema(db: Db, r: Reservado, motivo: string) {
  await rpc(db, "mkt_pausar", {
    _campanha: r.campanha_id,
    _lote: null,
    _motivo: `pausa automática: ${motivo}`,
  });
  await db.from("mkt_avisos").insert({
    empresa_id: r.empresa_id,
    tipo: "pausa_automatica",
    titulo: "Envio pausado",
    mensagem: `O envio foi pausado antes de sair: ${motivo}. Corrija e toque em "Retomar".`,
    campanha_id: r.campanha_id,
  });
  log("ERROR", "campanha.pausada_problema", { campanha: r.campanha_id, motivo });
}

async function enviarUm(
  ctx: ContextoEmpresa,
  p: Pronto,
  r: Reservado,
): Promise<{ conversa: number; mensagem: number }> {
  let conversa = r.conversa_chatwoot_id;
  if (!conversa) {
    const contato = await garantirContato(
      ctx.conta,
      ctx.tokenAdmin!,
      ctx.caixa,
      r.normalized_phone,
      r.primeiro_nome,
      r.chatwoot_contact_id,
    );
    conversa =
      (await conversaExistente(ctx.conta, ctx.tokenAdmin!, contato.id, ctx.caixa)) ??
      // Com a Alice ligada, a conversa nasce com ela (pendente); sem a Alice, aberta para a equipe.
      (await criarConversa(
        ctx.conta,
        ctx.tokenRobo!,
        ctx.caixa,
        contato,
        r.normalized_phone,
        ctx.aliceAtiva ? "pending" : "open",
      ));
  }
  const msg = await enviarModelo(
    ctx.conta,
    ctx.tokenRobo!,
    conversa,
    p.texto,
    templateParams(p.modelo, p.parametros),
  );
  // Etiqueta do lote: falha aqui não desfaz o envio.
  await etiquetarConversa(ctx.conta, ctx.tokenRobo!, conversa, [r.etiqueta]).catch((e) =>
    log("WARNING", "etiqueta.falha", { envio: r.envio_id, erro: String(e) }),
  );
  return { conversa, mensagem: msg.id };
}

/** agora: só nos testes (simula o relógio para as regras de dia e horário). */
export async function processarFila(
  opcoes: { limite?: number; agora?: string | null } = {},
): Promise<ResultadoDisparo> {
  const db = await dbServico();
  const limite = Math.min(Math.max(opcoes.limite ?? 6, 1), 50);
  const fila =
    (await rpc<Reservado[] | null>(db, "mkt_reservar_envios", {
      _limite: limite,
      _agora: opcoes.agora ?? null,
    })) ?? [];
  const res: ResultadoDisparo = {
    reservados: fila.length,
    enviados: 0,
    erros: 0,
    devolvidos: 0,
    pausas: 0,
  };
  if (!fila.length) return res;
  log("INFO", "disparo.inicio", { reservados: fila.length });

  const cache: Cache = new Map();
  const pausadas = new Set<string>();
  let anterior = 0;
  for (const r of fila) {
    const c = await contextoComModelos(db, cache, r.empresa_id);
    const intervalo = "ctx" in c ? c.ctx.cfg.intervalo_segundos * 1000 : 0;
    const falta = anterior + intervalo - Date.now();
    if (anterior && falta > 0) await esperar(falta);

    const pronto = "erro" in c ? c : montar(c.modelos, r);
    if ("erro" in pronto && !pausadas.has(r.campanha_id)) {
      pausadas.add(r.campanha_id);
      await pausarPorProblema(db, r, pronto.erro);
      res.pausas++;
    }
    // Pausada acima (ou por alguém no Nexa): a conferência devolve o envio para a fila.
    const pode = await rpc<boolean>(db, "mkt_confirmar_envio", {
      _envio: r.envio_id,
      _agora: opcoes.agora ?? null,
    });
    if (!pode || "erro" in pronto || "erro" in c) {
      res.devolvidos++;
      continue;
    }
    anterior = Date.now();
    let ok = false;
    let erro: string | null = null;
    let conversa: number | null = null;
    let mensagem: number | null = null;
    try {
      const e = await enviarUm(c.ctx, pronto, r);
      ok = true;
      conversa = e.conversa;
      mensagem = e.mensagem;
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
    const reg = await rpc<{ pausou?: boolean } | null>(db, "mkt_registrar_envio", {
      _envio: r.envio_id,
      _ok: ok,
      _erro: erro,
      _conversa: conversa,
      _mensagem: mensagem,
    });
    if (ok) res.enviados++;
    else res.erros++;
    const pausou = Boolean(reg?.pausou);
    if (pausou) res.pausas++;
    log(ok ? "INFO" : "WARNING", ok ? "envio.ok" : "envio.erro", {
      envio: r.envio_id,
      campanha: r.campanha_id,
      lote: r.lote_id,
      modelo: r.template_nome,
      erro,
      pausou,
    });
  }
  log("INFO", "disparo.fim", res);
  return res;
}
