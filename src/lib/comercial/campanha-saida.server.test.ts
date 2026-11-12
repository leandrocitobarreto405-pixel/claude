import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avaliarSaida,
  mandarParaCampanha,
  saidasRecentes,
  segurarNaLista,
} from "./campanha-saida.server";
import { resultadoCampanha, SAIDA_PARA_CAMPANHA_LIGADA } from "./campanha-saida";

type Linha = Record<string, unknown>;

/** Banco de mentira: filtros simples, update de verdade nas linhas e registro das escritas. */
function banco(tabelas: Record<string, Linha[]>) {
  const escritas: string[] = [];
  const from = (tabela: string) => {
    let linhas = tabelas[tabela] ?? [];
    let patch: Linha | null = null;
    let cabeca = false;
    const fim = () => {
      if (patch) {
        escritas.push(tabela);
        for (const l of linhas) Object.assign(l, patch);
      }
      return { data: cabeca ? null : linhas, count: linhas.length, error: null };
    };
    const q: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => ((cabeca = Boolean(o?.head)), q),
      order: () => q,
      limit: () => q,
      eq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => l[c] === v)), q),
      in: (c: string, vs: unknown[]) => ((linhas = linhas.filter((l) => vs.includes(l[c]))), q),
      gte: (c: string, v: string) => ((linhas = linhas.filter((l) => String(l[c]) >= v)), q),
      like: (c: string, v: string) => (
        (linhas = linhas.filter((l) => String(l[c] ?? "").startsWith(v.replace(/%$/, "")))),
        q
      ),
      update: (p: Linha) => ((patch = p), q),
      maybeSingle: () => Promise.resolve({ data: fim().data?.[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => ok(fim()),
    };
    return q;
  };
  return { db: { from } as never, escritas };
}

const E = "emp";
const agora = new Date("2026-11-13T00:30:00Z");
const tarefa = { id: "t1", crm_lead_id: "l1", tarefa_tipo: "mensagem", prioridade: 3, notes: "x" };
const dados = (x: Record<string, Linha[]> = {}) => ({
  whatsapp_messages: [
    {
      empresa_id: E,
      crm_lead_id: "l1",
      direction: "Recebida",
      privada: false,
      message_timestamp: "2026-10-30T15:00:00Z",
    },
  ],
  crm_leads: [
    {
      empresa_id: E,
      id: "l1",
      orcamento_enviado_em: "2026-10-31T15:00:00Z",
      linked_work_order_id: null,
      lead_name: "Ana Souza",
      normalized_phone: "5511900001234",
    },
  ],
  quotes: [],
  comercial_analises: [
    {
      empresa_id: E,
      id: "f1",
      crm_lead_id: "l1",
      caixinha: 5,
      rever_em: null,
      rever_motivo: null,
      etiquetas: { servico: "sofá" },
    },
  ],
  crm_followups: [
    {
      empresa_id: E,
      id: "t1",
      crm_lead_id: "l1",
      origem: "gerente",
      responsavel: "equipe",
      status: "Pendente",
      trilha: "G",
      scheduled_at: "2026-11-12T12:00:00Z",
      notes: "x",
      result: null,
      completed_at: null,
    },
  ],
  comercial_cobrancas: [],
  work_orders: [],
  ...x,
});

test("avaliar: sai com 12 dias sem resposta; cada exceção segura o lead", async () => {
  const sai = async (x: Record<string, Linha[]> = {}) =>
    (await avaliarSaida(banco(dados(x)).db, E, tarefa, agora)).saida;
  assert.deepEqual(await sai(), { sai: true, dias: 12 });
  const ficha = (y: Linha) => ({
    comercial_analises: [{ ...dados().comercial_analises[0], ...y }],
  });
  for (const x of [
    ficha({ caixinha: 3 }),
    ficha({ etiquetas: { retorno_prometido_em: "2026-11-20" } }),
    ficha({ etiquetas: { data_evento: "2026-12-01" } }),
    ficha({ rever_motivo: "véspera da data combinada", rever_em: "2026-11-19T03:00:00Z" }),
    // Retorno combinado (trilha C) ou outra tarefa da equipe agendada para depois de amanhã.
    {
      crm_followups: [
        ...dados().crm_followups,
        { ...dados().crm_followups[0], id: "t2", trilha: "C", responsavel: "alice" },
      ],
    },
    {
      crm_followups: [
        ...dados().crm_followups,
        { ...dados().crm_followups[0], id: "t3", scheduled_at: "2026-11-20T12:00:00Z" },
      ],
    },
  ])
    assert.deepEqual(await sai(x), { sai: false, motivo: "data_combinada" });
  assert.deepEqual(
    await sai({
      comercial_cobrancas: [{ empresa_id: E, id: "c1", crm_lead_id: "l1", situacao: "pendente" }],
    }),
    { sai: false, motivo: "acerto_pendente" },
  );
  const comOs = (status: string) => ({
    crm_leads: [{ ...dados().crm_leads[0], linked_work_order_id: "os1" }],
    work_orders: [{ empresa_id: E, id: "os1", status, deleted_at: null }],
  });
  assert.deepEqual(await sai(comOs("Agendada")), { sai: false, motivo: "os_aberta" });
  assert.equal((await sai(comOs("Cancelada"))).sai, true);
  // Orçamento criado no app há 3 dias conta, mesmo sem "orçamento enviado" marcado.
  assert.deepEqual(
    await sai({
      quotes: [{ empresa_id: E, crm_lead_id: "l1", created_at: "2026-11-10T12:00:00Z" }],
    }),
    { sai: false, motivo: "respondeu" },
  );
});

test("saída ligada: a tarefa sai com o resultado gravado e o lead fica guardado", async () => {
  assert.equal(SAIDA_PARA_CAMPANHA_LIGADA, true);
  const d = dados();
  const b = banco(d);
  assert.equal(await mandarParaCampanha(b.db, E, tarefa, agora), true);
  assert.equal(d.crm_followups[0]?.status, "Cancelada");
  assert.equal(d.crm_followups[0]?.result, resultadoCampanha(12));
  assert.equal(
    (d.comercial_analises[0]?.etiquetas as Record<string, unknown>)["guardado_em"],
    agora.toISOString(),
  );
  assert.equal((d.comercial_analises[0]?.etiquetas as Record<string, unknown>)["servico"], "sofá");
  // P1, tarefa que não é de venda e lead com exceção: nada é escrito.
  for (const t of [
    { ...tarefa, prioridade: 1 },
    { ...tarefa, tarefa_tipo: "pos_venda" },
    { ...tarefa, notes: "x [segurada:2026-11-12]" },
  ]) {
    const outro = banco(dados());
    assert.equal(await mandarParaCampanha(outro.db, E, t, agora), false);
    assert.deepEqual(outro.escritas, []);
  }
});

test("segurar na lista: a tarefa volta para hoje com a marca e o lead deixa de estar guardado", async () => {
  const t = {
    ...dados().crm_followups[0],
    status: "Cancelada",
    result: resultadoCampanha(12),
    completed_at: "2026-11-13T01:00:00Z",
  };
  const f = { ...dados().comercial_analises[0], etiquetas: { servico: "sofá", guardado_em: "x" } };
  const b = banco(dados({ crm_followups: [t], comercial_analises: [f] }));
  const saidas = await saidasRecentes(b.db, E, "2026-11-12T21:00:00Z");
  assert.deepEqual(saidas, [
    {
      id: "t1",
      leadId: "l1",
      leadNome: "Ana Souza",
      telefoneFinal: "1234",
      dias: 12,
      saiuEm: "2026-11-13T01:00:00Z",
    },
  ]);
  assert.equal(await segurarNaLista(b.db, E, "t1", agora), true);
  assert.equal(t.status, "Pendente");
  assert.equal(t.result, null);
  assert.equal(t.notes, "x [segurada:2026-11-12]");
  assert.deepEqual(f.etiquetas, { servico: "sofá" });
  // Tarefa que não saiu para a campanha (ou já voltou) não é mexida.
  assert.equal(await segurarNaLista(b.db, E, "t1", agora), false);
  const pulada = { ...dados().crm_followups[0], status: "Cancelada", result: "Pulada" };
  assert.equal(
    await segurarNaLista(banco(dados({ crm_followups: [pulada] })).db, E, "t1", agora),
    false,
  );
  assert.equal(pulada.status, "Cancelada");
});
