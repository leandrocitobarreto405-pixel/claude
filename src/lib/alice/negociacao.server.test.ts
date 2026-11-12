import { test } from "node:test";
import assert from "node:assert/strict";
import type { Avisador } from "./avisos.server";
import { autorizacoes, pedirAutorizacao, responderAutorizacao } from "./negociacao.server";
import { horarioDaConfig } from "@/lib/comercial/furos";
import { PREFERENCIAS_PADRAO } from "@/lib/push/notificacoes";

type Linha = Record<string, unknown>;

/** Banco de mentira: filtros simples, insert/update de verdade e select depois de escrever. */
function banco(tabelas: Record<string, Linha[]>) {
  let n = 0;
  const from = (tabela: string) => {
    const todas = (tabelas[tabela] ??= []);
    const filtros: Array<(l: Linha) => boolean> = [];
    let patch: Linha | null = null;
    let novas: Linha[] | null = null;
    let limite = Infinity;
    const linhas = () =>
      (novas ?? todas.filter((l) => filtros.every((f) => f(l)))).slice(0, limite);
    const fim = () => {
      if (patch) {
        const alvo = todas.filter((l) => filtros.every((f) => f(l)));
        for (const l of alvo) Object.assign(l, patch);
        patch = null;
        novas = alvo;
      }
      return { data: linhas(), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      limit: (k: number) => ((limite = k), q),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      not: (c: string, _op: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) !== v), q),
      gt: (c: string, v: string) => (filtros.push((l) => String(l[c]) > v), q),
      gte: (c: string, v: string) => (filtros.push((l) => String(l[c]) >= v), q),
      like: (c: string, v: string) => (
        filtros.push((l) => String(l[c] ?? "").includes(v.replace(/%/g, ""))),
        q
      ),
      update: (p: Linha) => ((patch = p), q),
      insert: (l: Linha) => {
        const nova = { id: `id${++n}`, pushes: 0, criado_em: AGORA.toISOString(), ...l };
        todas.push(nova);
        novas = [nova];
        return q;
      },
      single: () => Promise.resolve({ data: fim().data[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: fim().data[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => ok(fim()),
    };
    return q;
  };
  return { db: { from } as never, tab: (t: string) => (tabelas[t] ??= []) };
}

const E = "emp";
// Quinta, 14h em São Paulo.
const AGORA = new Date("2026-11-12T17:00:00Z");
const horario = horarioDaConfig(
  { dias_uteis: [1, 2, 3, 4, 5, 6], hora_inicio: "08:00", hora_fim: "19:00" },
  [],
);
const CFG = { negociacao_ligada: true };

function avisador() {
  const enviados: Array<{ userId: string; ref: string; titulo: string; corpo: string }> = [];
  const a: Avisador = {
    pessoas: async () =>
      [
        { userId: "dono", papel: "admin" as const },
        { userId: "maria", papel: "atendente" as const },
      ].map((p) => ({ ...p, pref: { ...PREFERENCIAS_PADRAO } })),
    enviar: async (o) => {
      if (enviados.some((e) => e.userId === o.userId && e.ref === o.ref)) return 0;
      enviados.push({ userId: o.userId, ref: o.ref, titulo: o.titulo, corpo: o.corpo });
      return 1;
    },
  };
  return { a, enviados };
}

function dados(o: { cupom?: string | null; desconto?: number } = {}) {
  return {
    quotes: [
      {
        id: "q1",
        empresa_id: E,
        crm_lead_id: "l1",
        status: "enviado",
        numero: 10,
        subtotal: 600,
        desconto: o.desconto ?? 0,
        desconto_tipo: o.cupom ? "manual" : null,
        cupom: o.cupom ?? null,
        total: 600 - (o.desconto ?? 0),
        valor_a_vista: 570,
        distancia_km: 8.2,
        observacoes: "Criado pela Alice (IA).",
        quote_items: [
          { nome_snapshot: "Sofá comum 3 lugares", quantidade: 1, tipo_servico: "higienizacao" },
        ],
      },
    ],
    alice_autorizacoes: [] as Linha[],
    comercial_configuracoes: [
      { empresa_id: E, dias_uteis: [1, 2, 3, 4, 5, 6], hora_inicio: "08:00", hora_fim: "19:00" },
    ],
    conversas: [
      {
        id: "c1",
        status: "pending",
        encerrada_em: null,
        contato: {
          profile_name: "Carlos Lima",
          nome_confirmado: null,
          display_phone: "+55 11 90000-2210",
        },
      },
    ],
    whatsapp_messages: [] as Linha[],
  };
}
const ctx = (db: never, a: Avisador, agora = AGORA) => ({
  empresaId: E,
  conversaId: "c1",
  leadId: "l1",
  cfg: CFG,
  nomeCliente: "Carlos",
  agora,
  avisador: a,
  // horário sem feriados (o banco de mentira não tem a tabela de feriados)
});

test("pedido: grava o sugerido de 12%, avisa a equipe na hora e devolve a frase de espera", async () => {
  const { db, tab } = banco(dados());
  const { a, enviados } = avisador();
  const r = await pedirAutorizacao(db, ctx(db, a), {
    motivo: "caro",
    frase_cliente: "Achei caro, faz por menos?",
  });
  assert.equal(r.erro, false);
  assert.match(r.texto, /"Me dá uns minutinhos que eu já volto com a resposta, tá bom\? 💙"/);
  const p = tab("alice_autorizacoes")[0]!;
  assert.equal(p["valor_sugerido"], 528);
  assert.equal(p["desconto_pct"], 12);
  assert.equal(p["segue_sozinha"], true);
  assert.equal(p["prazo_em"], "2026-11-12T17:10:00.000Z");
  assert.equal(p["voltar_apos"], "2026-11-12T17:04:00.000Z");
  assert.deepEqual(
    enviados.map((e) => e.userId),
    ["dono", "maria"],
  );
  assert.equal(enviados[0]?.titulo, "💰 Autorizar desconto: Carlos (final 2210)");
  // Uma por cliente: com o pedido aberto, não pede de novo.
  const de2 = await pedirAutorizacao(db, ctx(db, a), { motivo: "caro", frase_cliente: "e aí?" });
  assert.equal(de2.erro, true);
  assert.match(de2.texto, /Já há um pedido com o gestor/);
});

test("autorizado antes dos 4 minutos: a Alice só volta depois do mínimo", async () => {
  const { db, tab } = banco(dados());
  const { a } = avisador();
  await pedirAutorizacao(db, ctx(db, a), { motivo: "caro", frase_cliente: "caro" });
  const id = String(tab("alice_autorizacoes")[0]!["id"]);
  const r = await responderAutorizacao(db, {
    empresaId: E,
    userId: "dono",
    id,
    acao: "autorizar",
    agora: new Date("2026-11-12T17:01:00Z"),
  });
  assert.deepEqual(r, { ok: true, situacao: "autorizado" });
  const h = async () => horario;
  await autorizacoes(db, new Date("2026-11-12T17:02:00Z"), a, h);
  assert.equal(tab("ia_tarefas").length, 0);
  await autorizacoes(db, new Date("2026-11-12T17:04:00Z"), a, h);
  assert.equal(tab("ia_tarefas").length, 1);
  assert.deepEqual(tab("ia_tarefas")[0]!["dados"], {
    autorizacao: id,
    motivo: "volta da autorização de desconto",
  });
  assert.ok(tab("alice_autorizacoes")[0]!["cliente_avisado_em"]);
  assert.equal(tab("alice_eventos").at(-1)!["tipo"], "autorizacao_respondida");
  // Responder de novo não muda nada.
  const de2 = await responderAutorizacao(db, { empresaId: E, userId: "maria", id, acao: "negar" });
  assert.equal(de2.ok, false);
});

test("sem resposta: push de 5 em 5 minutos e, aos 10, a Alice segue sozinha com o sugerido", async () => {
  const { db, tab } = banco(dados());
  const { a, enviados } = avisador();
  await pedirAutorizacao(db, ctx(db, a), {
    motivo: "concorrente",
    concorrente_valor: 450,
    frase_cliente: "Outra fez por 450",
  });
  const p = tab("alice_autorizacoes")[0]!;
  assert.equal(p["valor_sugerido"], 528);
  assert.equal(p["falta_para_igualar"], 78);
  const h = async () => horario;
  await autorizacoes(db, new Date("2026-11-12T17:03:00Z"), a, h);
  assert.equal(enviados.length, 2);
  await autorizacoes(db, new Date("2026-11-12T17:05:00Z"), a, h);
  assert.equal(enviados.length, 4);
  await autorizacoes(db, new Date("2026-11-12T17:10:00Z"), a, h);
  assert.equal(p["situacao"], "automatico");
  assert.equal(p["valor_final"], 528);
  assert.equal(tab("ia_tarefas").length, 1);
});

test("cupom: a Alice nunca segue sozinha; outro valor fora da faixa é recusado", async () => {
  const { db, tab } = banco(dados({ cupom: "BLOG50", desconto: 50 }));
  const { a } = avisador();
  await pedirAutorizacao(db, ctx(db, a), { motivo: "caro", frase_cliente: "dá pra melhorar?" });
  const p = tab("alice_autorizacoes")[0]!;
  assert.equal(p["segue_sozinha"], false);
  assert.equal(p["prazo_em"], null);
  const h = async () => horario;
  await autorizacoes(db, new Date("2026-11-12T18:00:00Z"), a, h);
  assert.equal(p["situacao"], "pendente");
  const ruim = await responderAutorizacao(db, {
    empresaId: E,
    userId: "dono",
    id: String(p["id"]),
    acao: "outro_valor",
    valor: 200,
  });
  assert.equal(ruim.ok, false);
  const bom = await responderAutorizacao(db, {
    empresaId: E,
    userId: "dono",
    id: String(p["id"]),
    acao: "outro_valor",
    valor: 540,
  });
  assert.deepEqual(bom, { ok: true, situacao: "outro_valor" });
  assert.equal(p["valor_final"], 540);
});

test("de noite, passando do teto: frase da noite e tarefa P1 da manhã", async () => {
  const noite = new Date("2026-11-13T01:30:00Z"); // 22h30 de quinta
  const { db, tab } = banco(dados());
  const { a, enviados } = avisador();
  const r = await pedirAutorizacao(db, ctx(db, a, noite), {
    motivo: "concorrente",
    concorrente_valor: 400,
    frase_cliente: "A outra empresa fez por 400",
  });
  assert.match(r.texto, /Já deixei seu pedido com o meu gestor, Carlos\. Amanhã logo cedo/);
  assert.equal(enviados.length, 0);
  const t = tab("crm_followups")[0]!;
  assert.equal(t["prioridade"], 1);
  assert.equal(t["scheduled_at"], "2026-11-13T11:00:00.000Z");
  assert.match(String(t["notes"]), /\[autorizacao:/);
  // Respondido de manhã: a tarefa sai da lista.
  await responderAutorizacao(db, {
    empresaId: E,
    userId: "dono",
    id: String(tab("alice_autorizacoes")[0]!["id"]),
    acao: "autorizar",
  });
  assert.equal(t["status"], "Concluída");
});

test("a equipe respondeu ao cliente na conversa: o pedido sai como assumido", async () => {
  const { db, tab } = banco(dados());
  const { a } = avisador();
  await pedirAutorizacao(db, ctx(db, a), { motivo: "caro", frase_cliente: "caro" });
  tab("whatsapp_messages").push({
    empresa_id: E,
    conversa_id: "c1",
    direction: "Enviada",
    remetente_tipo: "user",
    privada: false,
    message_timestamp: "2026-11-12T17:02:00Z",
  });
  const r = await autorizacoes(db, new Date("2026-11-12T17:03:00Z"), a, async () => horario);
  assert.equal(r.assumidas, 1);
  assert.equal(tab("alice_autorizacoes")[0]!["situacao"], "assumido");
});
