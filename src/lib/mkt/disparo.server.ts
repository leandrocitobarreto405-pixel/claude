/**
 * Disparo das campanhas e gatilhos pelo Chatwoot (Cloud Scheduler a cada minuto).
 *
 * 1. mkt_reservar_envios: só o que já pode sair (flag ligada, campanha aprovada, lote liberado,
 *    terça a quinta a partir das 10h no calendário, 9h nos gatilhos, antes da hora limite e nunca
 *    entre 21h e 8h). Os envios já vêm espaçados (agendado_para); aqui ainda esperamos
 *    intervalo_segundos entre um e outro.
 * 2. Antes de cada mensagem, mkt_confirmar_envio (pausa no meio, flag desligada, opt-out).
 * 3. Contato e conversa no Chatwoot, modelo com o primeiro nome e a condição, etiqueta do lote.
 *    Pós-venda (C1) com o cliente tendo escrito nas últimas 24 h: vai como mensagem comum (o texto
 *    do modelo, sem modelo), para parecer conversa; fora da janela, o modelo de utilidade.
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
import { enviarMensagem } from "@/lib/alice/chatwoot-api.server";
import { preencherTexto } from "@/lib/modelos-mensagem";
import { textosDaEmpresa } from "./textos.server";
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
  whatsapp_contact_id: string | null;
  chatwoot_contact_id: number | null;
  conversa_chatwoot_id: number | null;
};

/** Modelos que, com a janela de 24 h aberta, saem como mensagem comum. */
const TEXTO_LIVRE_NA_JANELA = ["tc_posvenda_resultado"];
/** Margem de segurança: a janela do WhatsApp é de 24 h; usamos 23 h 30. */
const JANELA_MS = 23.5 * 3600_000;

/** Dados da campanha que a fila não traz (tipo e desconto do Pix da promoção). */
type InfoCampanha = { tipo: string; pix: number | null };
type CacheCampanhas = Map<string, InfoCampanha>;

async function infoCampanha(db: Db, cache: CacheCampanhas, id: string): Promise<InfoCampanha> {
  let c = cache.get(id);
  if (!c) {
    const { data } = await db
      .from("mkt_campanhas")
      .select("tipo, desconto_pix_pct")
      .eq("id", id)
      .maybeSingle();
    c = { tipo: data?.tipo ?? "", pix: data?.desconto_pix_pct ?? null };
    cache.set(id, c);
  }
  return c;
}

/** O cliente escreveu nas últimas 24 h (dá para mandar texto livre na conversa dele)? */
async function janelaAberta(db: Db, r: Reservado, info: InfoCampanha): Promise<boolean> {
  if (!r.whatsapp_contact_id || !r.conversa_chatwoot_id) return false;
  // A promoção da agenda também sai como mensagem comum quando o cliente acabou de escrever.
  if (
    info.tipo !== "promocao" &&
    !TEXTO_LIVRE_NA_JANELA.includes(r.template_nome.replace(/_sn$/, ""))
  )
    return false;
  const { data } = await db
    .from("whatsapp_messages")
    .select("message_timestamp, created_at")
    .eq("empresa_id", r.empresa_id)
    .eq("whatsapp_contact_id", r.whatsapp_contact_id)
    .eq("direction", "Recebida")
    .order("message_timestamp", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const quando = data?.message_timestamp ?? data?.created_at;
  return Boolean(quando && Date.now() - Date.parse(quando) < JANELA_MS);
}

/** Textos editáveis (tela Modelos de mensagem) que substituem o modelo quando sai texto livre. */
const CHAVE_TEXTO_LIVRE: Record<string, string> = { tc_posvenda_resultado: "livre_posvenda" };

function comTextoEditado(
  p: Pronto,
  r: Reservado,
  info: InfoCampanha,
  textos: Record<string, string>,
): Pronto {
  const chave =
    info.tipo === "promocao"
      ? "livre_promocao"
      : CHAVE_TEXTO_LIVRE[r.template_nome.replace(/_sn$/, "")];
  const t = chave ? textos[chave] : undefined;
  if (!t) return p;
  const nome = r.variante_sn ? null : r.primeiro_nome?.trim() || null;
  // Texto pede o nome e o contato não tem nome confiável: fica o texto do modelo.
  if (/\{nome\}/.test(t) && !nome) return p;
  return {
    ...p,
    texto: preencherTexto(t, {
      nome: nome ?? "",
      desconto: r.condicao_texto ?? "",
      pix: `${String(Number(info.pix ?? 0)).replace(".", ",")}%`,
    }).trim(),
  };
}

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
function montar(
  modelos: ModeloMeta[],
  r: Reservado,
  info: InfoCampanha,
): Pronto | { erro: string } {
  const sit = situacaoModelo(modelos, r.template_nome, r.idioma);
  if (!sit.ok) return { erro: sit.erro };
  const promocao = info.tipo === "promocao";
  const p = preencher(sit.modelo, {
    primeiroNome: r.variante_sn ? null : r.primeiro_nome,
    // Na promoção o modelo já diz "de desconto": {{2}} é só o percentual, {{3}} o do Pix.
    condicao: promocao
      ? (r.condicao_texto ?? null)
      : textoCondicao(r.condicao_texto, r.condicao_pct),
    extras: promocao ? [`${String(Number(info.pix ?? 0)).replace(".", ",")}%`] : undefined,
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
  textoLivre: boolean,
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
  const msg = textoLivre
    ? await enviarMensagem(ctx.conta, ctx.tokenRobo!, conversa, p.texto)
    : await enviarModelo(
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
  const campanhas: CacheCampanhas = new Map();
  const textosPorEmpresa = new Map<string, Record<string, string>>();
  const pausadas = new Set<string>();
  let anterior = 0;
  for (const r of fila) {
    const c = await contextoComModelos(db, cache, r.empresa_id);
    const intervalo = "ctx" in c ? c.ctx.cfg.intervalo_segundos * 1000 : 0;
    const falta = anterior + intervalo - Date.now();
    if (anterior && falta > 0) await esperar(falta);

    const info = await infoCampanha(db, campanhas, r.campanha_id);
    const pronto = "erro" in c ? c : montar(c.modelos, r, info);
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
    let textoLivre = false;
    try {
      textoLivre = await janelaAberta(db, r, info);
      let final = pronto;
      if (textoLivre) {
        let textos = textosPorEmpresa.get(r.empresa_id);
        if (!textos) {
          textos = await textosDaEmpresa(db, r.empresa_id);
          textosPorEmpresa.set(r.empresa_id, textos);
        }
        final = comTextoEditado(pronto, r, info, textos);
      }
      const e = await enviarUm(c.ctx, final, r, textoLivre);
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
      texto_livre: textoLivre,
      erro,
      pausou,
    });
    if (ok && textoLivre) {
      await db.from("mkt_eventos").insert({
        empresa_id: r.empresa_id,
        tipo: "envio",
        resultado: "texto_livre",
        detalhe: { motivo: "cliente escreveu nas últimas 24 h", modelo: r.template_nome },
        campanha_id: r.campanha_id,
        lote_id: r.lote_id,
        envio_id: r.envio_id,
      });
    }
  }
  log("INFO", "disparo.fim", res);
  return res;
}
