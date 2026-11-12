/**
 * Desconto com autorização (plano "Alice e vendas", item 5): o pedido da Alice, o push para a
 * equipe, a resposta (Autorizar / Outro valor / Negar), a Alice seguindo sozinha no prazo e a volta
 * ao cliente. Só liga com ia_configuracoes.negociacao_ligada. Push só para a equipe; a mensagem ao
 * cliente sai pela Alice, com o texto aprovado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HorarioUtil } from "@/lib/comercial/furos";
import { emHorarioUtil } from "@/lib/comercial/furos";
import { querReceber } from "@/lib/push/notificacoes";
import { avisadorReal, registrarEvento, type Avisador } from "./avisos.server";
import { horarioDaEmpresa } from "./transferencia.server";
import { horaDoAlarme, minutosEsperando, prazoDaTransferencia } from "./transferencia";
import {
  calcularPedido,
  fraseDeEspera,
  parametrosDaConfig,
  proximoPasso,
  reais,
  textoDoPush,
  type SituacaoAutorizacao,
} from "./negociacao";

type Db = SupabaseClient;

/** Depois disto o pedido sai da lista e o push para (3 dias, como o alarme da transferência). */
const VALIDADE_MS = 3 * 86_400_000;
const CAMPOS =
  "id, empresa_id, conversa_id, crm_lead_id, quote_id, situacao, itens, servico, valor_cheio, desconto_atual_tipo, desconto_atual_valor, cupom, concorrente_nome, concorrente_valor, frase_cliente, valor_sugerido, desconto_pct, falta_para_igualar, segue_sozinha, prazo_em, voltar_apos, fora_do_horario, valor_final, respondido_em, cliente_avisado_em, ultimo_push_em, pushes, criado_em";

export type LinhaAutorizacao = {
  id: string;
  empresa_id: string;
  conversa_id: string | null;
  crm_lead_id: string | null;
  quote_id: string | null;
  situacao: SituacaoAutorizacao;
  itens: Array<{ nome: string; quantidade: number; servico: string }>;
  servico: string | null;
  valor_cheio: number;
  desconto_atual_tipo: string | null;
  desconto_atual_valor: number;
  cupom: string | null;
  concorrente_nome: string | null;
  concorrente_valor: number | null;
  frase_cliente: string | null;
  valor_sugerido: number;
  desconto_pct: number;
  falta_para_igualar: number | null;
  segue_sozinha: boolean;
  prazo_em: string | null;
  voltar_apos: string;
  fora_do_horario: boolean;
  valor_final: number | null;
  respondido_em: string | null;
  cliente_avisado_em: string | null;
  ultimo_push_em: string | null;
  pushes: number;
  criado_em: string;
};

type Orcamento = {
  id: string;
  numero: number;
  subtotal: number;
  desconto: number;
  desconto_tipo: string | null;
  cupom: string | null;
  total: number;
  valor_a_vista: number | null;
  distancia_km: number | null;
  observacoes: string | null;
  quote_items: Array<{ nome_snapshot: string; quantidade: number; tipo_servico: string }>;
};

/** O tipo do desconto que o orçamento já tem, como a tabela guarda. */
export function tipoDoDescontoAtual(o: {
  desconto: number;
  desconto_tipo: string | null;
  cupom: string | null;
  observacoes: string | null;
}): "combo" | "cupom" | "campanha" | "indicacao" | null {
  if (!(Number(o.desconto) > 0)) return null;
  if (o.cupom) return "cupom";
  if (o.desconto_tipo === "campanha" || o.desconto_tipo === "indicacao") return o.desconto_tipo;
  if (/combo higieniza/i.test(o.observacoes ?? "")) return "combo";
  return null;
}

export type EntradaFerramenta = {
  motivo: "caro" | "concorrente";
  concorrente_valor?: number | undefined;
  concorrente_nome?: string | undefined;
  frase_cliente: string;
};

/**
 * Ferramenta pedir_autorizacao_desconto. Devolve o texto para a Alice (a frase exata para o
 * cliente, ou por que não dá para pedir).
 */
export async function pedirAutorizacao(
  db: Db,
  o: {
    empresaId: string;
    conversaId: string;
    leadId: string | null;
    cfg: unknown;
    nomeCliente: string | null;
    agora: Date;
    avisador?: Avisador;
  },
  e: EntradaFerramenta,
): Promise<{ texto: string; erro: boolean }> {
  const p = parametrosDaConfig(o.cfg);
  if (!p.ligada) return { texto: "Pedido de desconto não liberado nesta empresa.", erro: true };
  if (!o.leadId)
    return { texto: "Sem orçamento nesta conversa: mande o orçamento antes.", erro: true };
  const [{ data: q }, { data: anteriores }] = await Promise.all([
    db
      .from("quotes")
      .select(
        "id, numero, subtotal, desconto, desconto_tipo, cupom, total, valor_a_vista, distancia_km, observacoes, quote_items(nome_snapshot, quantidade, tipo_servico)",
      )
      .eq("empresa_id", o.empresaId)
      .eq("crm_lead_id", o.leadId)
      .neq("status", "recusado")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("alice_autorizacoes")
      .select("situacao, valor_final, valor_sugerido, conversa_id")
      .eq("empresa_id", o.empresaId)
      .eq("crm_lead_id", o.leadId)
      .in("situacao", ["pendente", "autorizado", "outro_valor", "negado", "automatico"])
      .limit(5),
  ]);
  const orc = q as unknown as Orcamento | null;
  if (!orc) return { texto: "Sem orçamento nesta conversa: mande o orçamento antes.", erro: true };
  const ant = (anteriores ?? []) as Array<{
    situacao: string;
    valor_final: number | null;
    valor_sugerido: number;
  }>;
  if (ant.some((a) => a.situacao === "pendente"))
    return {
      texto:
        "Já há um pedido com o gestor: diga ao cliente que ainda está vendo e já volta. Não peça de novo.",
      erro: true,
    };
  const feita = ant.find((a) => a.situacao !== "pendente");
  if (feita)
    return {
      texto: `Este cliente já teve negociação${feita.valor_final ? ` (ficou ${reais(Number(feita.valor_final))})` : ""}: é uma por cliente. Não peça outra; mantenha o valor e ofereça reservar um horário.`,
      erro: true,
    };
  const horario: HorarioUtil = await horarioDaEmpresa(db, o.empresaId, o.agora);
  const foraDoHorario = !emHorarioUtil(o.agora, horario);
  const valorCheio = Number(orc.subtotal) > 0 ? Number(orc.subtotal) : Number(orc.total);
  const descontoAtual = Number(orc.desconto) || 0;
  const concorrente =
    e.motivo === "concorrente" && Number(e.concorrente_valor) > 0
      ? Number(e.concorrente_valor)
      : null;
  const pedido = calcularPedido(
    { valorCheio, descontoAtual, temCupom: Boolean(orc.cupom), concorrente, foraDoHorario },
    p,
  );
  const tipoAtual = tipoDoDescontoAtual(orc);
  const servicos = [...new Set(orc.quote_items.map((i) => i.tipo_servico))];
  const linha = {
    empresa_id: o.empresaId,
    conversa_id: o.conversaId,
    crm_lead_id: o.leadId,
    quote_id: orc.id,
    situacao: "pendente",
    itens: orc.quote_items.map((i) => ({
      nome: i.nome_snapshot,
      quantidade: Number(i.quantidade),
      servico: i.tipo_servico,
    })),
    servico: servicos.length > 1 ? "combo" : (servicos[0] ?? null),
    distancia_km: orc.distancia_km,
    valor_cheio: valorCheio,
    valor_pix: pedido.valorPixMinimo,
    desconto_atual_tipo: tipoAtual,
    desconto_atual_valor: descontoAtual,
    cupom: orc.cupom,
    concorrente_nome: e.concorrente_nome?.slice(0, 120) ?? null,
    concorrente_valor: concorrente,
    frase_cliente: e.frase_cliente.slice(0, 500),
    valor_sugerido: pedido.valorSugerido,
    desconto_valor: pedido.descontoValor,
    desconto_pct: pedido.descontoPct,
    falta_para_igualar: pedido.faltaParaIgualar,
    segue_sozinha: pedido.segueSozinha,
    prazo_em: pedido.segueSozinha
      ? new Date(o.agora.getTime() + p.esperaMin * 60_000).toISOString()
      : null,
    voltar_apos: new Date(o.agora.getTime() + p.voltaMin * 60_000).toISOString(),
    fora_do_horario: foraDoHorario,
  };
  const { data: criada, error } = await db
    .from("alice_autorizacoes")
    .insert(linha)
    .select(CAMPOS)
    .single();
  if (error || !criada) {
    console.error("Alice: pedido de desconto não gravado", error?.message);
    return {
      texto:
        'Não consegui registrar o pedido de desconto: transfira para a equipe (motivo "desconto").',
      erro: true,
    };
  }
  const a = criada as unknown as LinhaAutorizacao;
  await registrarEvento(db, {
    empresa_id: o.empresaId,
    tipo: "autorizacao_pedida",
    conversa_id: o.conversaId,
    crm_lead_id: o.leadId,
    quote_id: orc.id,
    dados: {
      motivo: e.motivo,
      desconto_pct: pedido.descontoPct,
      segue_sozinha: pedido.segueSozinha,
      fora_do_horario: foraDoHorario,
      cupom: Boolean(orc.cupom),
    },
  });
  // Fora do horário: vira a primeira tarefa da manhã (P1), com o resumo e o valor sugerido.
  if (foraDoHorario && !pedido.segueSozinha) {
    const abre = prazoDaTransferencia(o.agora, horario, 10).prazoEm;
    await db.from("crm_followups").insert({
      empresa_id: o.empresaId,
      crm_lead_id: o.leadId,
      conversa_id: o.conversaId,
      scheduled_at: abre,
      status: "Pendente",
      responsavel: "equipe",
      origem: "gerente",
      trilha: "G",
      etapa: "GX",
      canal: "equipe",
      prioridade: 1,
      tarefa_tipo: "mensagem",
      motivo:
        `Pedido de desconto da Alice à noite: orçamento ${reais(Number(orc.total))}, sugerido ${reais(pedido.valorSugerido)}${concorrente ? `, concorrente ${reais(concorrente)}` : ""}${orc.cupom ? `, cliente já tem cupom` : ""}. Responder em Follow-ups › Autorizações.`.slice(
          0,
          300,
        ),
      notes: `[autorizacao:${a.id}]`,
    } as never);
  } else if (emHorarioUtil(o.agora, horario)) {
    // No horário: o primeiro push sai na hora (os seguintes, de 5 em 5 minutos, pela varredura).
    await avisarEquipe(db, a, o.agora, o.avisador ?? (await avisadorReal(db))).catch((err) =>
      console.error("Alice: push do pedido de desconto falhou", err),
    );
  }
  const frase = fraseDeEspera({
    nome: o.nomeCliente,
    noite: foraDoHorario && !pedido.segueSozinha,
  });
  return {
    texto: `Pedido de autorização registrado (o gestor vai responder). Responda ao cliente com esta frase, exatamente assim, e não escreva mais nada depois dela: "${frase}"`,
    erro: false,
  };
}

/** Push para a equipe (admin e atendente com "Cliente esperando a equipe" ligado). */
async function avisarEquipe(db: Db, a: LinhaAutorizacao, agora: Date, avisador: Avisador) {
  const pessoas = (await avisador.pessoas(a.empresa_id)).filter((p) =>
    querReceber("cliente_esperando", p.papel, p.pref),
  );
  if (!pessoas.length) return 0;
  const { data: conv } = await db
    .from("conversas")
    .select("contato:whatsapp_contact_id ( profile_name, nome_confirmado, display_phone )")
    .eq("id", a.conversa_id ?? "")
    .maybeSingle();
  const c = (
    conv as unknown as {
      contato: {
        profile_name: string | null;
        nome_confirmado: string | null;
        display_phone: string | null;
      } | null;
    } | null
  )?.contato;
  const texto = textoDoPush({
    nome: (c?.nome_confirmado || c?.profile_name || "").split(/\s+/)[0] ?? "",
    final: (c?.display_phone ?? "").replace(/\D/g, "").slice(-4),
    valorCheio: Number(a.valor_cheio),
    valorAtual: Number(a.valor_cheio) - Number(a.desconto_atual_valor),
    sugerido: Number(a.valor_sugerido),
    pct: Number(a.desconto_pct),
    concorrente: a.concorrente_valor ? Number(a.concorrente_valor) : null,
    cupom: a.cupom ? Number(a.desconto_atual_valor) : null,
    minutos: Math.floor((agora.getTime() - Date.parse(a.criado_em)) / 60_000),
  });
  let enviados = 0;
  for (const p of pessoas)
    enviados += await avisador.enviar({
      empresaId: a.empresa_id,
      userId: p.userId,
      tipo: "autorizacao_desconto",
      ref: `${a.id}:${a.pushes + 1}`,
      titulo: texto.titulo,
      corpo: texto.corpo,
      url: "/crm/follow-ups#autorizacoes",
      tag: `autorizacao-${a.id}`,
    });
  await db
    .from("alice_autorizacoes")
    .update({ ultimo_push_em: agora.toISOString(), pushes: a.pushes + 1 })
    .eq("id", a.id);
  a.pushes += 1;
  a.ultimo_push_em = agora.toISOString();
  return enviados;
}

/** Põe a Alice de volta na conversa para dar a resposta do gestor ao cliente. */
async function chamarAlice(db: Db, a: LinhaAutorizacao, agora: Date) {
  if (!a.conversa_id) return;
  const { cancelarFollowupPendente } = await import("./ferramentas.server");
  await cancelarFollowupPendente(
    db as never,
    a.empresa_id,
    a.conversa_id,
    "volta da autorização de desconto",
  );
  const { error } = await db.from("ia_tarefas").insert({
    empresa_id: a.empresa_id,
    conversa_id: a.conversa_id,
    tipo: "followup",
    executar_apos: agora.toISOString(),
    motivo: "volta da autorização de desconto",
    dados: { autorizacao: a.id, motivo: "volta da autorização de desconto" },
  });
  if (error && error.code !== "23505") throw new Error(error.message);
  await db
    .from("alice_autorizacoes")
    .update({ cliente_avisado_em: agora.toISOString() })
    .eq("id", a.id)
    .is("cliente_avisado_em", null);
  await registrarEvento(db, {
    empresa_id: a.empresa_id,
    tipo: "autorizacao_respondida",
    conversa_id: a.conversa_id,
    crm_lead_id: a.crm_lead_id,
    quote_id: a.quote_id,
    dados: {
      situacao: a.situacao,
      segundos: a.respondido_em
        ? Math.max(0, Math.round((Date.parse(a.respondido_em) - Date.parse(a.criado_em)) / 1000))
        : null,
      desconto_pct:
        a.valor_final && Number(a.valor_cheio) > 0
          ? Math.round((1 - Number(a.valor_final) / Number(a.valor_cheio)) * 10000) / 100
          : 0,
    },
  });
  const { enfileirarPendentes } = await import("./fila.server");
  await enfileirarPendentes(db as never);
}

/** Varredura (a cada 5 minutos): push, Alice seguindo sozinha no prazo, volta ao cliente, placar. */
export async function rodarAutorizacoes(agora = new Date()) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  return autorizacoes(db, agora, await avisadorReal(db), (emp) => horarioDaEmpresa(db, emp, agora));
}

export async function autorizacoes(
  db: Db,
  agora: Date,
  avisador: Avisador,
  horarioDe: (empresaId: string) => Promise<HorarioUtil>,
): Promise<{
  abertas: number;
  pushes: number;
  sozinha: number;
  avisadas: number;
  assumidas: number;
}> {
  const saida = { abertas: 0, pushes: 0, sozinha: 0, avisadas: 0, assumidas: 0 };
  const { data } = await db
    .from("alice_autorizacoes")
    .select(CAMPOS)
    .in("situacao", ["pendente", "autorizado", "outro_valor", "negado", "automatico"])
    .is("cliente_avisado_em", null)
    .gte("criado_em", new Date(agora.getTime() - VALIDADE_MS).toISOString())
    .order("criado_em")
    .limit(200);
  const lista = (data ?? []) as unknown as LinhaAutorizacao[];
  saida.abertas = lista.length;
  const horarios = new Map<string, HorarioUtil>();
  for (const a of lista) {
    // A equipe assumiu a conversa (alguém respondeu ao cliente) ou ela foi encerrada: o pedido sai.
    if (a.conversa_id) {
      const [{ data: conv }, { data: msgs }] = await Promise.all([
        db.from("conversas").select("status, encerrada_em").eq("id", a.conversa_id).maybeSingle(),
        db
          .from("whatsapp_messages")
          .select("id")
          .eq("empresa_id", a.empresa_id)
          .eq("conversa_id", a.conversa_id)
          .eq("direction", "Enviada")
          .eq("remetente_tipo", "user")
          .eq("privada", false)
          .gt("message_timestamp", a.criado_em)
          .limit(1),
      ]);
      const c = conv as { status: string | null; encerrada_em: string | null } | null;
      if (!c || c.encerrada_em || (msgs ?? []).length) {
        await db
          .from("alice_autorizacoes")
          .update({ situacao: c && !c.encerrada_em ? "assumido" : "cancelado" })
          .eq("id", a.id)
          .eq("situacao", a.situacao);
        saida.assumidas++;
        continue;
      }
    }
    const passo = proximoPasso(
      {
        situacao: a.situacao,
        criadoEm: a.criado_em,
        prazoEm: a.prazo_em,
        voltarApos: a.voltar_apos,
        segueSozinha: a.segue_sozinha,
        respondidoEm: a.respondido_em,
        clienteAvisadoEm: a.cliente_avisado_em,
      },
      agora,
    );
    if (passo === "seguir_sozinha") {
      const { data: mudou } = await db
        .from("alice_autorizacoes")
        .update({
          situacao: "automatico",
          valor_final: a.valor_sugerido,
          respondido_em: agora.toISOString(),
        })
        .eq("id", a.id)
        .eq("situacao", "pendente")
        .select("id");
      if (!(mudou ?? []).length) continue;
      a.situacao = "automatico";
      a.valor_final = a.valor_sugerido;
      a.respondido_em = agora.toISOString();
      saida.sozinha++;
      if (agora.getTime() >= Date.parse(a.voltar_apos)) {
        await chamarAlice(db, a, agora);
        saida.avisadas++;
      }
      continue;
    }
    if (passo === "avisar_cliente") {
      await chamarAlice(db, a, agora);
      saida.avisadas++;
      continue;
    }
    if (passo === "esperar" && a.situacao === "pendente") {
      if (!horarios.has(a.empresa_id)) horarios.set(a.empresa_id, await horarioDe(a.empresa_id));
      const horario = horarios.get(a.empresa_id)!;
      const aberta = {
        criadaEm: a.criado_em,
        // Fora do horário, o primeiro push sai quando o atendimento abre.
        prazoEm: a.fora_do_horario
          ? prazoDaTransferencia(new Date(a.criado_em), horario, 10).prazoEm
          : null,
        foraDoHorario: a.fora_do_horario,
        ultimoPushEm: a.ultimo_push_em,
      };
      if (!horaDoAlarme(aberta, agora, horario)) continue;
      saida.pushes += await avisarEquipe(db, a, agora, avisador);
      void minutosEsperando;
    }
  }
  await marcarPlacar(db, agora);
  return saida;
}

/** Placar: fechou (OS ligada ao lead depois do pedido) ou não (7 dias sem fechar). */
async function marcarPlacar(db: Db, agora: Date) {
  const { data } = await db
    .from("alice_autorizacoes")
    .select("id, crm_lead_id, criado_em")
    .not("cliente_avisado_em", "is", null)
    .is("fechou", null)
    .limit(100);
  for (const a of (data ?? []) as Array<{
    id: string;
    crm_lead_id: string | null;
    criado_em: string;
  }>) {
    if (!a.crm_lead_id) continue;
    const { data: lead } = await db
      .from("crm_leads")
      .select("linked_work_order_id")
      .eq("id", a.crm_lead_id)
      .maybeSingle();
    const fechou = Boolean(
      (lead as { linked_work_order_id?: string | null } | null)?.linked_work_order_id,
    );
    if (fechou)
      await db
        .from("alice_autorizacoes")
        .update({ fechou: true, fechou_em: agora.toISOString() })
        .eq("id", a.id);
    else if (agora.getTime() - Date.parse(a.criado_em) > 7 * 86_400_000)
      await db.from("alice_autorizacoes").update({ fechou: false }).eq("id", a.id);
  }
}

// ---------------------------------------------------------------- tela e resposta da equipe
export type AutorizacaoNaTela = {
  id: string;
  conversaId: string | null;
  nome: string;
  telefoneFinal: string;
  situacao: SituacaoAutorizacao;
  itens: Array<{ nome: string; quantidade: number; servico: string }>;
  servico: string | null;
  distanciaKm: number | null;
  valorCheio: number;
  valorAtual: number;
  descontoAtualTipo: string | null;
  cupom: string | null;
  concorrenteNome: string | null;
  concorrenteValor: number | null;
  fraseCliente: string | null;
  valorSugerido: number;
  descontoPct: number;
  faltaParaIgualar: number | null;
  valorPixMinimo: number | null;
  segueSozinha: boolean;
  prazoEm: string | null;
  foraDoHorario: boolean;
  valorFinal: number | null;
  criadoEm: string;
  respondidoEm: string | null;
};

/** Pedidos abertos e os respondidos hoje (bloco "Autorizações de desconto" em Follow-ups). */
export async function autorizacoesNaTela(
  db: Db,
  empresaId: string,
  agora = new Date(),
): Promise<AutorizacaoNaTela[]> {
  const inicioDoDia = new Date(
    `${agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T00:00:00-03:00`,
  ).toISOString();
  const { data } = await db
    .from("alice_autorizacoes")
    .select(
      `${CAMPOS}, distancia_km, valor_pix, conversa:conversa_id ( contato:whatsapp_contact_id ( profile_name, nome_confirmado, display_phone ) )`,
    )
    .eq("empresa_id", empresaId)
    .gte("criado_em", new Date(agora.getTime() - VALIDADE_MS).toISOString())
    .order("criado_em", { ascending: false })
    .limit(30);
  type Linha = LinhaAutorizacao & {
    distancia_km: number | null;
    valor_pix: number | null;
    conversa: {
      contato: {
        profile_name: string | null;
        nome_confirmado: string | null;
        display_phone: string | null;
      } | null;
    } | null;
  };
  return ((data ?? []) as unknown as Linha[])
    .filter((a) => a.situacao === "pendente" || (a.respondido_em ?? a.criado_em) >= inicioDoDia)
    .map((a) => ({
      id: a.id,
      conversaId: a.conversa_id,
      nome: a.conversa?.contato?.nome_confirmado || a.conversa?.contato?.profile_name || "Cliente",
      telefoneFinal: (a.conversa?.contato?.display_phone ?? "").replace(/\D/g, "").slice(-4),
      situacao: a.situacao,
      itens: a.itens ?? [],
      servico: a.servico,
      distanciaKm: a.distancia_km === null ? null : Number(a.distancia_km),
      valorCheio: Number(a.valor_cheio),
      valorAtual: Number(a.valor_cheio) - Number(a.desconto_atual_valor),
      descontoAtualTipo: a.desconto_atual_tipo,
      cupom: a.cupom,
      concorrenteNome: a.concorrente_nome,
      concorrenteValor: a.concorrente_valor === null ? null : Number(a.concorrente_valor),
      fraseCliente: a.frase_cliente,
      valorSugerido: Number(a.valor_sugerido),
      descontoPct: Number(a.desconto_pct),
      faltaParaIgualar: a.falta_para_igualar === null ? null : Number(a.falta_para_igualar),
      valorPixMinimo: a.valor_pix === null ? null : Number(a.valor_pix),
      segueSozinha: a.segue_sozinha,
      prazoEm: a.prazo_em,
      foraDoHorario: a.fora_do_horario,
      valorFinal: a.valor_final === null ? null : Number(a.valor_final),
      criadoEm: a.criado_em,
      respondidoEm: a.respondido_em,
    }));
}

/** A resposta da equipe. Só um pedido pendente muda; o valor tem de ficar entre 50% e 100% do cheio. */
export async function responderAutorizacao(
  db: Db,
  o: {
    empresaId: string;
    userId: string;
    id: string;
    acao: "autorizar" | "outro_valor" | "negar";
    valor?: number | null;
    agora?: Date;
  },
): Promise<{ ok: true; situacao: SituacaoAutorizacao } | { ok: false; erro: string }> {
  const agora = o.agora ?? new Date();
  const { data } = await db
    .from("alice_autorizacoes")
    .select(CAMPOS)
    .eq("empresa_id", o.empresaId)
    .eq("id", o.id)
    .maybeSingle();
  const a = data as unknown as LinhaAutorizacao | null;
  if (!a) return { ok: false, erro: "Pedido não encontrado." };
  if (a.situacao !== "pendente")
    return {
      ok: false,
      erro:
        a.situacao === "automatico"
          ? "A Alice já seguiu com o valor sugerido (ninguém respondeu no prazo)."
          : "Este pedido já foi respondido.",
    };
  let situacao: SituacaoAutorizacao;
  let valorFinal: number | null = null;
  if (o.acao === "negar") situacao = "negado";
  else if (o.acao === "autorizar") {
    situacao = "autorizado";
    valorFinal = Number(a.valor_sugerido);
  } else {
    const v = Math.round(Number(o.valor) * 100) / 100;
    const cheio = Number(a.valor_cheio);
    if (!(v > 0) || v > cheio || v < cheio * 0.5)
      return {
        ok: false,
        erro: `Valor inválido: use entre ${reais(Math.ceil(cheio * 0.5))} e ${reais(cheio)}.`,
      };
    situacao = "outro_valor";
    valorFinal = v;
  }
  const { data: mudou } = await db
    .from("alice_autorizacoes")
    .update({
      situacao,
      valor_final: valorFinal,
      respondido_por: o.userId,
      respondido_em: agora.toISOString(),
    })
    .eq("id", a.id)
    .eq("situacao", "pendente")
    .select("id");
  if (!(mudou ?? []).length) return { ok: false, erro: "Este pedido já foi respondido." };
  // A tarefa da manhã (pedido feito à noite) sai da lista: o pedido foi respondido.
  await db
    .from("crm_followups")
    .update({
      status: "Concluída",
      completed_at: agora.toISOString(),
      result: `pedido de desconto respondido (${situacao === "negado" ? "negado" : reais(valorFinal ?? 0)})`,
    })
    .eq("empresa_id", o.empresaId)
    .eq("status", "Pendente")
    .like("notes", `%[autorizacao:${a.id}]%`);
  return { ok: true, situacao };
}

/** Pedido ainda com o gestor nesta conversa (para o aviso do momento da Alice). */
export async function temAutorizacaoPendente(
  db: Db,
  empresaId: string,
  conversaId: string,
): Promise<boolean> {
  const { data } = await db
    .from("alice_autorizacoes")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .eq("situacao", "pendente")
    .limit(1);
  return Boolean((data ?? []).length);
}

/** Valor liberado para o orçamento com desconto "negociacao" (null se não há). */
export async function valorLiberado(
  db: Db,
  empresaId: string,
  conversaId: string,
): Promise<{ id: string; valorFinal: number; valorCheio: number } | null> {
  const { data } = await db
    .from("alice_autorizacoes")
    .select("id, valor_final, valor_cheio")
    .eq("empresa_id", empresaId)
    .eq("conversa_id", conversaId)
    .in("situacao", ["autorizado", "outro_valor", "automatico"])
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const a = data as { id: string; valor_final: number | null; valor_cheio: number } | null;
  return a?.valor_final
    ? { id: a.id, valorFinal: Number(a.valor_final), valorCheio: Number(a.valor_cheio) }
    : null;
}

/** Dados da autorização para a volta da Alice (motor). */
export async function autorizacaoParaVolta(
  db: Db,
  empresaId: string,
  id: string,
): Promise<LinhaAutorizacao | null> {
  const { data } = await db
    .from("alice_autorizacoes")
    .select(CAMPOS)
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as LinhaAutorizacao | null) ?? null;
}
