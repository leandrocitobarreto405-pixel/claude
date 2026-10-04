/**
 * Modelos de mensagem: conexão com a Meta, lista para a tela e envio para aprovação. Só servidor;
 * chamado pelas funções de modelos-mensagem.functions.ts depois de conferir que é o admin.
 * O token só é lido aqui e nunca sai (nem em log, nem em erro, nem para a tela).
 */
import { log, type Db } from "@/lib/mkt/contexto.server";
import {
  componentesDoFormulario,
  formularioDoModelo,
  mesmoTexto,
  modelosDaEmpresa,
  modelosEsperados,
  motivoDaRecusa,
  ondeEUsado,
  rascunhoParaEdicao,
  regraDeEdicao,
  situacaoDoModelo,
  sugestaoDeModelo,
  validarFormulario,
  type ContextoUso,
  type FormModelo,
  type ModeloDaMeta,
  type RegraEdicao,
  type Tom,
} from "@/lib/modelos-mensagem";
import {
  conferirConexao,
  criarModelo,
  editarModelo,
  ErroMeta,
  lerModelo,
  listarModelos,
  mensagemDoErro,
  semToken,
  type ConexaoMeta,
} from "./graph.server";

export async function conexaoDaEmpresa(db: Db, empresaId: string): Promise<ConexaoMeta | null> {
  const [{ data: cx }, { data: sg }] = await Promise.all([
    db.from("meta_conexoes").select("waba_id").eq("empresa_id", empresaId).maybeSingle(),
    db.from("meta_conexao_segredos").select("token").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  if (!cx?.waba_id || !sg?.token) return null;
  return { waba: cx.waba_id, token: sg.token };
}

/** Confere na Meta e só então grava. Erro sai sem o token. */
export async function salvarConexao(
  db: Db,
  empresaId: string,
  userId: string,
  waba: string,
  token: string,
) {
  let nome: string | null;
  try {
    nome = (await conferirConexao({ waba, token })).nome;
  } catch (e) {
    throw new Error(semToken(mensagemDoErro(e), token));
  }
  const { error: e1 } = await db.from("meta_conexoes").upsert({
    empresa_id: empresaId,
    waba_id: waba,
    waba_nome: nome,
    configurada_em: new Date().toISOString(),
    configurada_por: userId,
  });
  if (e1) throw new Error("Não foi possível salvar a conexão.");
  const { error: e2 } = await db
    .from("meta_conexao_segredos")
    .upsert({ empresa_id: empresaId, token, updated_at: new Date().toISOString() });
  if (e2) throw new Error("Não foi possível salvar o token.");
  log("INFO", "meta.conexao_salva", { empresa: empresaId, waba });
  return { nome };
}

async function contextoDeUso(
  db: Db,
  empresaId: string,
): Promise<ContextoUso & { empresa: string }> {
  const [{ data: mkt }, { data: agenda }, { data: empresa }] = await Promise.all([
    db
      .from("mkt_configuracoes")
      .select("aviso_template_nome, aviso_whatsapp_ligado, modelos")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    db
      .from("agenda_configuracoes")
      .select("promo_template_nome")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    db.from("empresas").select("nome").eq("id", empresaId).maybeSingle(),
  ]);
  return {
    // Avisos pelo WhatsApp desligados: o modelo de aviso não é necessário.
    modeloAviso: mkt?.aviso_whatsapp_ligado ? (mkt.aviso_template_nome ?? "nexa_aviso") : null,
    modeloPromocao: agenda?.promo_template_nome ?? "promocao_agenda",
    modelos: modelosDaEmpresa(mkt?.modelos),
    empresa: empresa?.nome ?? "nossa empresa",
  };
}

/** Edições feitas pelo Nexa enquanto o modelo estava aprovado (contam no limite da Meta). */
async function edicoesAprovadas(db: Db, empresaId: string) {
  const desde = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const { data } = await db
    .from("modelos_edicoes")
    .select("template_nome, idioma, created_at")
    .eq("empresa_id", empresaId)
    .eq("acao", "editar")
    .eq("ok", true)
    .eq("status_antes", "APPROVED")
    .gte("created_at", desde);
  const mapa = new Map<string, string[]>();
  for (const e of data ?? []) {
    const k = `${e.template_nome}|${e.idioma}`;
    mapa.set(k, [...(mapa.get(k) ?? []), e.created_at]);
  }
  return mapa;
}

export type LinhaModelo = {
  id: string | null;
  nome: string;
  idioma: string;
  status: string;
  situacao: { rotulo: string; tom: Tom };
  categoria: string;
  qualidade: string | null;
  motivoRecusa: string;
  usadoEm: string | null;
  form: FormModelo & { naoEditavel: string | null };
  regra: RegraEdicao;
  /** Texto novo pronto para revisar (ainda não foi para a Meta). */
  rascunho: { form: FormModelo; origem: string | null; em: string } | null;
};

export type ListaModelos = {
  /** De onde veio a lista: da Meta (com edição) ou do Chatwoot (só leitura). */
  fonte: "meta" | "chatwoot" | "nenhuma";
  erro: string | null;
  modelos: LinhaModelo[];
  faltando: Array<{
    nome: string;
    sugestao: FormModelo | null;
    /** A sugestão é um rascunho salvo (texto novo pronto para revisar). */
    rascunho: { origem: string | null; em: string } | null;
  }>;
  /** Modelo de cada finalidade e o da promoção (para os textos sem aprovação). */
  nomes: Record<string, string>;
};

function qualidade(q: ModeloDaMeta["quality_score"]): string | null {
  const s = typeof q === "string" ? q : q?.score;
  return s && s !== "UNKNOWN" ? s : null;
}

/** Rascunhos da empresa, por "nome|idioma". */
async function rascunhosDaEmpresa(db: Db, empresaId: string) {
  const { data } = await db
    .from("modelos_rascunhos")
    .select("template_nome, idioma, form, origem, updated_at")
    .eq("empresa_id", empresaId);
  const mapa = new Map<string, { form: FormModelo; origem: string | null; em: string }>();
  for (const r of data ?? []) {
    const form = { ...(r.form as unknown as FormModelo), nome: r.template_nome, idioma: r.idioma };
    mapa.set(`${r.template_nome}|${r.idioma}`, { form, origem: r.origem, em: r.updated_at });
  }
  return mapa;
}

export async function listarParaTela(db: Db, empresaId: string): Promise<ListaModelos> {
  const [cx, uso, edicoes, rascunhos] = await Promise.all([
    conexaoDaEmpresa(db, empresaId),
    contextoDeUso(db, empresaId),
    edicoesAprovadas(db, empresaId),
    rascunhosDaEmpresa(db, empresaId),
  ]);
  let brutos: ModeloDaMeta[] = [];
  let fonte: ListaModelos["fonte"] = "nenhuma";
  let erro: string | null = null;
  if (cx) {
    try {
      brutos = await listarModelos(cx);
      fonte = "meta";
    } catch (e) {
      erro = semToken(mensagemDoErro(e), cx.token);
    }
  }
  if (fonte === "nenhuma") {
    // Sem a conexão com a Meta (ou com erro nela): mostra o que o Chatwoot sabe, só para leitura.
    try {
      const { contextoEmpresa } = await import("@/lib/mkt/contexto.server");
      const { modelosDaCaixa } = await import("@/lib/mkt/chatwoot.server");
      const ctx = await contextoEmpresa(db, empresaId);
      if (ctx.tokenAdmin) {
        brutos = (await modelosDaCaixa(ctx.conta, ctx.tokenAdmin, ctx.caixa)) as ModeloDaMeta[];
        fonte = "chatwoot";
      }
    } catch (e) {
      erro ??= `Não foi possível ler os modelos pelo Chatwoot: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
    }
  }
  const agora = new Date();
  const modelos = brutos
    .filter((m) => !["DELETED", "PENDING_DELETION"].includes(String(m.status).toUpperCase()))
    .map((m): LinhaModelo => ({
      id: fonte === "meta" && m.id ? String(m.id) : null,
      nome: m.name,
      idioma: m.language,
      status: String(m.status).toUpperCase(),
      situacao: situacaoDoModelo(m.status),
      categoria: String(m.category ?? "").toUpperCase(),
      qualidade: qualidade(m.quality_score),
      motivoRecusa: motivoDaRecusa(m.rejected_reason),
      usadoEm: ondeEUsado(m.name, uso),
      form: formularioDoModelo(m),
      regra: regraDeEdicao(m.status, edicoes.get(`${m.name}|${m.language}`) ?? [], agora),
      rascunho: null,
    }))
    .map((linha): LinhaModelo => {
      const r = rascunhos.get(`${linha.nome}|${linha.idioma}`);
      if (!r) return linha;
      const form = rascunhoParaEdicao(r.form, linha);
      // Rascunho igual ao que já está na Meta não precisa de revisão.
      return mesmoTexto(form, linha.form) ? linha : { ...linha, rascunho: { ...r, form } };
    })
    .sort(
      (a, b) =>
        Number(Boolean(b.rascunho)) - Number(Boolean(a.rascunho)) ||
        Number(Boolean(b.usadoEm)) - Number(Boolean(a.usadoEm)) ||
        a.nome.localeCompare(b.nome),
    );
  const nomes = new Set(modelos.map((m) => m.nome.replace(/_sn$/, "")));
  const existentes = new Set(modelos.map((m) => `${m.nome}|${m.idioma}`));
  // Rascunho de um modelo que ainda não existe na Meta (ex.: a versão _sn ou um modelo novo).
  const novos: ListaModelos["faltando"] = [...rascunhos.entries()]
    .filter(([k]) => !existentes.has(k))
    .map(([, r]) => {
      // A versão _sn segue a categoria do modelo com nome que já está na Meta.
      const irmao = modelos.find(
        (m) => m.nome === r.form.nome.replace(/_sn$/, "") && m.idioma === r.form.idioma,
      );
      return {
        nome: r.form.nome,
        sugestao: irmao ? rascunhoParaEdicao(r.form, { ...irmao, nome: r.form.nome }) : r.form,
        rascunho: { origem: r.origem, em: r.em },
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const faltando =
    fonte === "nenhuma"
      ? []
      : [
          ...novos,
          ...modelosEsperados(uso)
            .filter((n) => !nomes.has(n) && !novos.some((x) => x.nome === n))
            .map((nome) => ({ nome, sugestao: sugestaoDeModelo(nome, uso), rascunho: null })),
        ];
  return {
    fonte,
    erro,
    modelos,
    faltando,
    nomes: { ...uso.modelos, promocao: uso.modeloPromocao ?? "" },
  };
}

async function registrar(
  db: Db,
  linha: {
    empresa_id: string;
    template_id: string | null;
    template_nome: string;
    idioma: string;
    acao: "criar" | "editar";
    status_antes: string | null;
    ok: boolean;
    erro: string | null;
    criado_por: string;
  },
) {
  await db.from("modelos_edicoes").insert(linha);
}

export type ResultadoEnvio = { status: string; chatwootAtualizado: boolean };

/**
 * Cria (sem id) ou edita (com id) e manda para a análise da Meta. Respeita o limite de edições de
 * modelo aprovado. Toda tentativa fica registrada (sem o token).
 */
export async function enviarParaAprovacao(
  db: Db,
  empresaId: string,
  userId: string,
  entrada: { id: string | null; form: FormModelo },
): Promise<ResultadoEnvio> {
  const f = entrada.form;
  const problemas = validarFormulario(f);
  if (problemas.length) throw new Error(problemas.join(" "));
  const cx = await conexaoDaEmpresa(db, empresaId);
  if (!cx) throw new Error("Configure a conexão com a Meta (token e ID da conta) antes de enviar.");
  const componentes = componentesDoFormulario(f);
  const base = {
    empresa_id: empresaId,
    template_nome: f.nome,
    idioma: f.idioma,
    criado_por: userId,
  };
  let status = "PENDING";
  if (entrada.id) {
    let atual: ModeloDaMeta;
    try {
      atual = await lerModelo(cx, entrada.id);
    } catch (e) {
      throw new Error(semToken(mensagemDoErro(e), cx.token));
    }
    if (atual.name !== f.nome || atual.language !== f.idioma)
      throw new Error("A Meta não deixa mudar o nome nem o idioma de um modelo. Crie um novo.");
    const statusAntes = String(atual.status).toUpperCase();
    const edicoes = (await edicoesAprovadas(db, empresaId)).get(`${f.nome}|${f.idioma}`) ?? [];
    const regra = regraDeEdicao(statusAntes, edicoes);
    if (!regra.pode) throw new Error(regra.motivo);
    const categoriaAtual = String(atual.category ?? "").toUpperCase();
    if (statusAntes === "APPROVED" && categoriaAtual && f.categoria !== categoriaAtual)
      throw new Error("A Meta não deixa mudar a categoria de um modelo aprovado.");
    try {
      await editarModelo(cx, entrada.id, {
        components: componentes,
        ...(f.categoria !== categoriaAtual ? { category: f.categoria } : {}),
      });
    } catch (e) {
      const msg = semToken(mensagemDoErro(e), cx.token);
      await registrar(db, {
        ...base,
        template_id: entrada.id,
        acao: "editar",
        status_antes: statusAntes,
        ok: false,
        erro: msg.slice(0, 500),
      });
      throw new Error(msg);
    }
    await registrar(db, {
      ...base,
      template_id: entrada.id,
      acao: "editar",
      status_antes: statusAntes,
      ok: true,
      erro: null,
    });
    status = await lerModelo(cx, entrada.id)
      .then((m) => String(m.status).toUpperCase())
      .catch(() => "PENDING");
  } else {
    try {
      const r = await criarModelo(cx, {
        name: f.nome,
        language: f.idioma,
        category: f.categoria,
        components: componentes,
      });
      status = String(r.status ?? "PENDING").toUpperCase();
      await registrar(db, {
        ...base,
        template_id: r.id ?? null,
        acao: "criar",
        status_antes: null,
        ok: true,
        erro: null,
      });
    } catch (e) {
      const msg = semToken(
        e instanceof ErroMeta ? mensagemDoErro(e) : "Erro inesperado ao criar o modelo.",
        cx.token,
      );
      await registrar(db, {
        ...base,
        template_id: null,
        acao: "criar",
        status_antes: null,
        ok: false,
        erro: msg.slice(0, 500),
      });
      throw new Error(msg);
    }
  }
  // O texto foi para a Meta: o rascunho dele não é mais necessário.
  await db
    .from("modelos_rascunhos")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("template_nome", f.nome)
    .eq("idioma", f.idioma);
  log("INFO", "meta.modelo_enviado", {
    empresa: empresaId,
    modelo: f.nome,
    acao: entrada.id ? "editar" : "criar",
    status,
  });

  // O disparo lê os modelos pelo Chatwoot: pede para ele atualizar a lista (se a versão aceitar).
  let chatwootAtualizado = false;
  try {
    const { contextoEmpresa } = await import("@/lib/mkt/contexto.server");
    const { sincronizarModelos } = await import("@/lib/mkt/chatwoot.server");
    const ctx = await contextoEmpresa(db, empresaId);
    if (ctx.tokenAdmin)
      chatwootAtualizado = await sincronizarModelos(ctx.conta, ctx.tokenAdmin, ctx.caixa);
  } catch {
    chatwootAtualizado = false;
  }
  return { status, chatwootAtualizado };
}

/** Guarda o texto para revisar depois (não envia nada para a Meta). */
export async function salvarRascunho(
  db: Db,
  empresaId: string,
  userId: string,
  form: FormModelo,
  origem: string | null,
) {
  const problemas = validarFormulario(form);
  if (problemas.length) throw new Error(problemas.join(" "));
  const { error } = await db.from("modelos_rascunhos").upsert({
    empresa_id: empresaId,
    template_nome: form.nome,
    idioma: form.idioma,
    form,
    origem,
    atualizado_por: userId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("Não foi possível guardar o rascunho.");
}

export async function descartarRascunho(db: Db, empresaId: string, nome: string, idioma: string) {
  const { error } = await db
    .from("modelos_rascunhos")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("template_nome", nome)
    .eq("idioma", idioma);
  if (error) throw new Error("Não foi possível descartar o rascunho.");
}
