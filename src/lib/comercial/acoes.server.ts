/**
 * Tatiana faz e informa (03/11/2026): executa no app, em modo ativo, o que planejarAcoes decidiu
 * (previsão de pagamento na OS, orçamento em rascunho, cadastro do cliente), grava cada ação em
 * comercial_acoes com o estado anterior, resolve a cobrança correspondente e sabe desfazer. Em
 * modo teste só registra "faria". Nada aqui envia mensagem a cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dataCurta } from "@/lib/feriados";
import { NOME_ACAO, type AcaoPlanejada, type SituacaoAcao, type TipoAcao } from "./acoes";
import { NOME_GERENTE, type TipoCobranca } from "./tatiana";

type Db = SupabaseClient;

type Registro = {
  tipo: TipoAcao;
  situacao: SituacaoAcao;
  titulo: string;
  frase: string;
  referencia: Record<string, unknown>;
  antes?: unknown;
  depois?: unknown;
  erro?: string | null;
};

type Onde = {
  empresaId: string;
  noiteId: string | null;
  leadId: string | null;
  conversaId: string | null;
  cobrancaId: string | null;
};

async function gravar(db: Db, onde: Onde, r: Registro): Promise<void> {
  const { error } = await db.from("comercial_acoes").insert({
    empresa_id: onde.empresaId,
    noite_id: onde.noiteId,
    cobranca_id: onde.cobrancaId,
    crm_lead_id: onde.leadId,
    conversa_id: onde.conversaId,
    tipo: r.tipo,
    situacao: r.situacao,
    titulo: r.titulo.slice(0, 300),
    frase: r.frase.slice(0, 400) || null,
    referencia: r.referencia,
    antes: r.antes ?? null,
    depois: r.depois ?? null,
    erro: r.erro ?? null,
  });
  if (error) throw new Error(`ação da ${NOME_GERENTE}: ${error.message}`);
}

const COLUNA_CADASTRO = {
  nome: "full_name",
  cpf: "document_number",
  email: "email",
  endereco: "full_address",
  cep: "postal_code",
} as const;

type Feito = { referencia: Record<string, unknown>; antes: unknown; depois: unknown };

async function executar(
  db: Db,
  o: { empresaId: string; leadId: string | null; hoje: string; conversaId?: string | null },
  acao: AcaoPlanejada,
): Promise<Feito> {
  if (acao.tipo === "previsao_pagamento") {
    const { data: wo } = await db
      .from("work_orders")
      .select(
        "negotiated_payment_method, negotiated_installments, payment_notes, total_gross_value",
      )
      .eq("id", acao.dados.osId)
      .eq("empresa_id", o.empresaId)
      .maybeSingle();
    const w = wo as {
      negotiated_payment_method: string | null;
      negotiated_installments: number | null;
      payment_notes: string | null;
      total_gross_value: number | string | null;
    } | null;
    if (!w) throw new Error("OS não encontrada");
    if (w.negotiated_payment_method) throw new Error("a OS já tem pagamento combinado");
    const nota = `Previsão (${NOME_GERENTE}, ${dataCurta(o.hoje)}): ${acao.titulo}. Lida na conversa; não é pagamento recebido.`;
    const depois = {
      negotiated_payment_method: acao.dados.metodo,
      negotiated_installments: acao.dados.parcelas,
      payment_notes: [w.payment_notes, nota].filter(Boolean).join("\n").slice(0, 2000),
      total_gross_value:
        Number(w.total_gross_value ?? 0) > 0 ? w.total_gross_value : acao.dados.valor,
    };
    const { error } = await db
      .from("work_orders")
      .update(depois)
      .eq("id", acao.dados.osId)
      .eq("empresa_id", o.empresaId);
    if (error) throw new Error(error.message);
    return { referencia: { work_order_id: acao.dados.osId }, antes: w, depois };
  }
  if (acao.tipo === "orcamento_rascunho") {
    const { data: q, error } = await db
      .from("quotes")
      .insert({
        empresa_id: o.empresaId,
        crm_lead_id: o.leadId,
        cliente_nome: acao.dados.clienteNome.slice(0, 120),
        cliente_telefone: acao.dados.telefone,
        status: "rascunho",
        subtotal: acao.dados.total,
        total: acao.dados.total,
        observacoes: `Rascunho da ${NOME_GERENTE} (${dataCurta(o.hoje)}): itens lidos na conversa. Conferir e salvar.`,
      })
      .select("id, numero")
      .single();
    if (error || !q) throw new Error(error?.message ?? "orçamento não criado");
    const quote = q as { id: string; numero: number | null };
    const { error: e2 } = await db.from("quote_items").insert(
      acao.dados.itens.map((i, idx) => ({
        empresa_id: o.empresaId,
        quote_id: quote.id,
        nome_snapshot: i.descricao,
        tipo_servico: /impermeab/i.test(i.descricao) ? "impermeabilizacao" : "higienizacao",
        preco_tabela: i.valor ?? 0,
        preco_aplicado: i.valor ?? 0,
        quantidade: i.quantidade,
        subtotal: Math.round((i.valor ?? 0) * i.quantidade * 100) / 100,
        display_order: idx + 1,
      })),
    );
    if (e2) {
      await db.from("quotes").delete().eq("id", quote.id);
      throw new Error(e2.message);
    }
    return {
      referencia: { quote_id: quote.id, numero: quote.numero },
      antes: null,
      depois: { itens: acao.dados.itens, total: acao.dados.total },
    };
  }
  if (acao.tipo === "virar_os") return virarOs(db, o, acao.dados);
  // cadastro
  const { data: c } = await db
    .from("customers")
    .select("full_name, document_number, email, full_address, postal_code")
    .eq("id", acao.dados.clienteId)
    .eq("empresa_id", o.empresaId)
    .maybeSingle();
  if (!c) throw new Error("cadastro não encontrado");
  const atual = c as Record<string, string | null>;
  const antes: Record<string, string | null> = {};
  const depois: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(acao.dados.campos)) {
    const col = COLUNA_CADASTRO[campo as keyof typeof COLUNA_CADASTRO];
    if (!col || !valor || (atual[col] ?? "").trim()) continue;
    antes[col] = atual[col] ?? null;
    depois[col] = valor;
  }
  if (!Object.keys(depois).length) throw new Error("os campos já estavam preenchidos");
  const { error } = await db
    .from("customers")
    .update(depois)
    .eq("id", acao.dados.clienteId)
    .eq("empresa_id", o.empresaId);
  if (error) throw new Error(error.message);
  return { referencia: { customer_id: acao.dados.clienteId }, antes, depois };
}

/** B7: vira o orçamento em OS pelo mesmo caminho da reserva da Alice (agenda real, feriado, cliente). */
async function virarOs(
  db: Db,
  o: { empresaId: string; leadId: string | null; hoje: string; conversaId?: string | null },
  d: import("./acoes").DadosVirarOs,
): Promise<Feito> {
  if (!o.leadId) throw new Error("sem lead");
  if (!o.conversaId) throw new Error("sem conversa do cliente");
  const [{ data: cfg }, { data: conv }, { data: lead }, { data: quotes }] = await Promise.all([
    db.from("ia_configuracoes").select("*").eq("empresa_id", o.empresaId).maybeSingle(),
    db
      .from("conversas")
      .select("whatsapp_contact_id")
      .eq("id", o.conversaId)
      .eq("empresa_id", o.empresaId)
      .maybeSingle(),
    db
      .from("crm_leads")
      .select(
        "is_open, closed_at, linked_work_order_id, status_id, next_follow_up_at, sales_origin_id",
      )
      .eq("id", o.leadId)
      .eq("empresa_id", o.empresaId)
      .maybeSingle(),
    db
      .from("quotes")
      .select("id, status, generated_work_order_id")
      .eq("empresa_id", o.empresaId)
      .eq("crm_lead_id", o.leadId)
      .neq("status", "convertido"),
  ]);
  if (!cfg) throw new Error("configuração da Alice não encontrada");
  if ((lead as { linked_work_order_id?: string | null } | null)?.linked_work_order_id)
    throw new Error("o lead já tem OS");
  const { horaLivreNoPeriodo, reservarHorario } = await import("@/lib/alice/agendamento.server");
  const ctx = {
    admin: db,
    empresaId: o.empresaId,
    // Notas e histórico da OS dizem "Tatiana (IA)"; nada é enviado ao cliente (sem processador).
    cfg: { ...(cfg as Record<string, unknown>), nome: NOME_GERENTE },
    conversaId: o.conversaId,
    leadId: o.leadId,
    contatoId:
      (conv as { whatsapp_contact_id?: string | null } | null)?.whatsapp_contact_id ?? null,
    agora: new Date(),
    ultimaDoCliente: null,
    etapas: [],
    passagem: null,
    saida: [],
    agendouFollowup: false,
    notas: [],
    midias: new Set<string>(),
  } as unknown as Parameters<typeof reservarHorario>[0];
  const hora = d.hora ?? (d.periodo ? await horaLivreNoPeriodo(ctx, d.data, d.periodo) : null);
  if (!hora)
    throw new Error(
      `sem horário livre em ${dataCurta(d.data)}${d.periodo ? ` de ${d.periodo === "manha" ? "manhã" : "tarde"}` : ""}`,
    );
  const r = await reservarHorario(ctx, {
    data: d.data,
    hora,
    ...(d.orcamento ? { orcamentos: [d.orcamento] } : {}),
    pagamento: d.pagamento,
    ...(d.parcelas ? { parcelas: d.parcelas } : {}),
    nome_completo: d.nome,
    cep: d.cep,
    numero: d.numero,
    ...(d.complemento ? { complemento: d.complemento } : {}),
  });
  const os = (ctx as { osReservada?: { id: string; os_number: string } }).osReservada;
  if (r.erro || !os) throw new Error(r.texto.slice(0, 280));
  return {
    referencia: { work_order_id: os.id, os_number: os.os_number },
    antes: { lead, quotes: quotes ?? [] },
    depois: { work_order_id: os.id, os_number: os.os_number, data: d.data, hora },
  };
}

/** Desfazer do B7: cancela a OS (sem visita concluída nem pagamento) e devolve orçamento e lead. */
async function desfazerVirarOs(
  db: Db,
  empresaId: string,
  a: LinhaAcao,
  osId: string,
): Promise<void> {
  const [{ data: visitas }, { data: pags }] = await Promise.all([
    db.from("visits").select("id, status").eq("work_order_id", osId).eq("empresa_id", empresaId),
    db
      .from("payments")
      .select("id")
      .eq("work_order_id", osId)
      .eq("empresa_id", empresaId)
      .eq("is_active", true)
      .limit(1),
  ]);
  const vs = (visitas ?? []) as Array<{ id: string; status: string | null }>;
  if (vs.some((v) => v.status === "Concluído") || (pags ?? []).length)
    throw new Error("A OS já tem visita concluída ou pagamento: cancele pela própria OS.");
  const agora = new Date().toISOString();
  const motivo = `Desfeito no app (OS criada pela ${NOME_GERENTE})`;
  const { error } = await db
    .from("work_orders")
    .update({ status: "Cancelada", cancelled_at: agora, cancellation_reason: motivo })
    .eq("id", osId)
    .eq("empresa_id", empresaId);
  if (error) throw new Error(error.message);
  await db
    .from("visits")
    .update({ status: "Cancelado" })
    .eq("work_order_id", osId)
    .eq("empresa_id", empresaId);
  const antes = (a.antes ?? {}) as {
    lead?: Record<string, unknown> | null;
    quotes?: Array<{ id: string; status: string; generated_work_order_id: string | null }>;
  };
  for (const q of antes.quotes ?? [])
    await db
      .from("quotes")
      .update({ status: q.status, generated_work_order_id: q.generated_work_order_id } as never)
      .eq("id", q.id)
      .eq("empresa_id", empresaId)
      .eq("generated_work_order_id", osId);
  if (antes.lead && a.crm_lead_id)
    await db
      .from("crm_leads")
      .update(antes.lead as never)
      .eq("id", a.crm_lead_id)
      .eq("empresa_id", empresaId)
      .eq("linked_work_order_id", osId);
  await db.from("work_order_history").insert({
    empresa_id: empresaId,
    work_order_id: osId,
    event_type: "Cancelamento",
    description: `OS cancelada. Motivo: ${motivo}`,
  });
  // Google Agenda: as visitas canceladas saem da agenda (se a empresa usa).
  const { executarNaEmpresa } = await import("@/lib/request-db.server");
  await executarNaEmpresa({ db, empresaId, userId: "" }, async () => {
    const { syncEvent } = await import("@/lib/calendar.server");
    for (const v of vs) await syncEvent("visit", v.id);
  }).catch((e) => console.error("Tatiana: agenda Google não sincronizada ao desfazer", e));
}

/**
 * Executa (modo ativo) ou registra "faria" (modo teste) as ações de um lead da noite. Cada ação
 * feita resolve a cobrança do mesmo tipo criada nesta noite, com o motivo "Feito pela Tatiana".
 */
export async function executarAcoesDaNoite(
  db: Db,
  o: {
    empresaId: string;
    noiteId: string;
    leadId: string;
    conversaId: string | null;
    modoAtivo: boolean;
    hoje: string;
    acoes: AcaoPlanejada[];
    cobrancas: ReadonlyMap<TipoCobranca, string>;
  },
): Promise<{ feitas: number; faria: number; falhou: number }> {
  const saida = { feitas: 0, faria: 0, falhou: 0 };
  // Sem o registro (tabela ainda não criada ou fora do ar), nada é feito: toda ação precisa do
  // seu Desfazer antes de mexer na OS, no orçamento ou no cadastro.
  const { error: semRegistro } = await db.from("comercial_acoes").select("id").limit(1);
  if (semRegistro) return { ...saida, falhou: o.acoes.length };
  for (const acao of o.acoes) {
    const onde: Onde = {
      empresaId: o.empresaId,
      noiteId: o.noiteId,
      leadId: o.leadId,
      conversaId: o.conversaId,
      cobrancaId: o.cobrancas.get(acao.cobrancaTipo) ?? null,
    };
    if (!o.modoAtivo) {
      await gravar(db, onde, {
        tipo: acao.tipo,
        situacao: "faria",
        titulo: acao.titulo,
        frase: acao.frase,
        referencia: {},
      });
      saida.faria += 1;
      continue;
    }
    try {
      const feito = await executar(db, o, acao);
      await gravar(db, onde, {
        tipo: acao.tipo,
        situacao: "feita",
        titulo: acao.titulo,
        frase: acao.frase,
        ...feito,
      });
      if (onde.cobrancaId)
        await db
          .from("comercial_cobrancas")
          .update({
            situacao: "resolvida",
            resolvida_em: new Date().toISOString(),
            motivo: `Feito pela ${NOME_GERENTE}`,
          })
          .eq("id", onde.cobrancaId)
          .eq("situacao", "pendente");
      saida.feitas += 1;
    } catch (e) {
      await gravar(db, onde, {
        tipo: acao.tipo,
        situacao: "falhou",
        titulo: acao.titulo,
        frase: acao.frase,
        referencia: {},
        erro: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      }).catch(() => undefined);
      saida.falhou += 1;
    }
  }
  return saida;
}

type LinhaAcao = {
  id: string;
  empresa_id: string;
  cobranca_id: string | null;
  crm_lead_id: string | null;
  tipo: TipoAcao;
  situacao: SituacaoAcao;
  titulo: string;
  frase: string | null;
  referencia: Record<string, string | number | null>;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  erro: string | null;
  feita_em: string;
};

/** Desfaz uma ação feita, só se o que ela mexeu ainda estiver como ela deixou. */
export async function desfazerAcao(
  db: Db,
  o: { empresaId: string; acaoId: string; userId: string | null; motivo: string | null },
): Promise<{ ok: true }> {
  const { data } = await db
    .from("comercial_acoes")
    .select(
      "id, empresa_id, cobranca_id, crm_lead_id, tipo, situacao, titulo, frase, referencia, antes, depois, erro, feita_em",
    )
    .eq("id", o.acaoId)
    .eq("empresa_id", o.empresaId)
    .maybeSingle();
  const bruto = data as LinhaAcao | null;
  if (!bruto) throw new Error("Ação não encontrada.");
  // JSON pode chegar como texto (cliente sem conversão de jsonb): normaliza antes de usar.
  const objeto = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));
  const a: LinhaAcao = {
    ...bruto,
    referencia: objeto<LinhaAcao["referencia"]>(bruto.referencia) ?? {},
    antes: objeto<LinhaAcao["antes"]>(bruto.antes),
    depois: objeto<LinhaAcao["depois"]>(bruto.depois),
  };
  const idDe = (chave: string) => {
    const v = String(a.referencia[chave] ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(v))
      throw new Error("Registro da ação incompleto: desfaça pelo app.");
    return v;
  };
  if (a.situacao !== "feita") throw new Error("Essa ação não está feita (nada a desfazer).");
  if (a.tipo === "previsao_pagamento") {
    const osId = idDe("work_order_id");
    const { data: wo } = await db
      .from("work_orders")
      .select("negotiated_payment_method")
      .eq("id", osId)
      .eq("empresa_id", o.empresaId)
      .maybeSingle();
    const atual = (wo as { negotiated_payment_method: string | null } | null)
      ?.negotiated_payment_method;
    if (atual !== (a.depois?.["negotiated_payment_method"] ?? null))
      throw new Error("A OS foi alterada depois; ajuste o pagamento pela própria OS.");
    const antes = (a.antes ?? {}) as Record<string, unknown>;
    const { error } = await db
      .from("work_orders")
      .update({
        negotiated_payment_method: antes["negotiated_payment_method"] ?? null,
        negotiated_installments: antes["negotiated_installments"] ?? null,
        payment_notes: antes["payment_notes"] ?? null,
        total_gross_value: antes["total_gross_value"] ?? null,
      })
      .eq("id", osId)
      .eq("empresa_id", o.empresaId);
    if (error) throw new Error(error.message);
  } else if (a.tipo === "orcamento_rascunho") {
    const quoteId = idDe("quote_id");
    const { data: q } = await db
      .from("quotes")
      .select("status, generated_work_order_id")
      .eq("id", quoteId)
      .eq("empresa_id", o.empresaId)
      .maybeSingle();
    const quote = q as { status: string; generated_work_order_id: string | null } | null;
    if (quote && (quote.status !== "rascunho" || quote.generated_work_order_id))
      throw new Error("O orçamento já saiu do rascunho; apague ou ajuste pelo app.");
    if (quote) {
      const { error } = await db.from("quotes").delete().eq("id", quoteId);
      if (error) throw new Error(error.message);
    }
  } else if (a.tipo === "cadastro") {
    const clienteId = idDe("customer_id");
    const depois = (a.depois ?? {}) as Record<string, string>;
    const antes = (a.antes ?? {}) as Record<string, string | null>;
    const { data: c } = await db
      .from("customers")
      .select("full_name, document_number, email, full_address, postal_code")
      .eq("id", clienteId)
      .eq("empresa_id", o.empresaId)
      .maybeSingle();
    const atual = (c ?? {}) as Record<string, string | null>;
    const volta: Record<string, string | null> = {};
    for (const [col, v] of Object.entries(depois))
      if (atual[col] === v) volta[col] = antes[col] ?? null;
    if (Object.keys(volta).length) {
      const { error } = await db
        .from("customers")
        .update(volta)
        .eq("id", clienteId)
        .eq("empresa_id", o.empresaId);
      if (error) throw new Error(error.message);
    }
  } else if (a.tipo === "virar_os") {
    await desfazerVirarOs(db, o.empresaId, a, idDe("work_order_id"));
  } else {
    throw new Error("Essa ação não tem Desfazer automático.");
  }
  const { error } = await db
    .from("comercial_acoes")
    .update({
      situacao: "desfeita",
      desfeita_em: new Date().toISOString(),
      desfeita_por: o.userId,
      desfeita_motivo: o.motivo,
    })
    .eq("id", a.id);
  if (error) throw new Error(error.message);
  if (a.cobranca_id)
    await db
      .from("comercial_cobrancas")
      .update({ situacao: "pendente", resolvida_em: null, motivo: null, visivel_equipe: true })
      .eq("id", a.cobranca_id)
      .eq("situacao", "resolvida");
  return { ok: true };
}

export type AcaoFeita = {
  id: string;
  tipo: TipoAcao;
  nome: string;
  titulo: string;
  frase: string | null;
  situacao: SituacaoAcao;
  feitaEm: string;
  leadId: string | null;
  erro: string | null;
};

/** Ações desde `desdeIso` (feitas, "faria", desfeitas e falhas), as mais novas primeiro. */
export async function acoesDesde(
  db: Db,
  empresaId: string,
  desdeIso: string,
): Promise<AcaoFeita[]> {
  const { data } = await db
    .from("comercial_acoes")
    .select("id, tipo, situacao, titulo, frase, feita_em, crm_lead_id, erro")
    .eq("empresa_id", empresaId)
    .gte("feita_em", desdeIso)
    .order("feita_em", { ascending: false })
    .limit(50);
  return (
    (data ?? []) as Array<
      Omit<LinhaAcao, "empresa_id" | "cobranca_id" | "referencia" | "antes" | "depois">
    >
  ).map((a) => ({
    id: a.id,
    tipo: a.tipo,
    nome: NOME_ACAO[a.tipo],
    titulo: a.titulo,
    frase: a.frase,
    situacao: a.situacao,
    feitaEm: a.feita_em,
    leadId: a.crm_lead_id,
    erro: a.erro,
  }));
}
