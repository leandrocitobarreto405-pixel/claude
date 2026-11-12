import { test } from "node:test";
import assert from "node:assert/strict";
import { separarSemNovidade, type LeadDaNoite } from "./sem-novidade.server";

type Linha = Record<string, unknown>;
type Tabelas = Record<string, Linha[]>;

/** Banco de mentira: aplica eq, in, gt, gte e limit; conta as escritas (não pode haver nenhuma). */
function banco(tabelas: Tabelas, o: { falha?: string } = {}) {
  const escritas: string[] = [];
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    let limite = Infinity;
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      or: () => q,
      eq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => l[c] === v)), q),
      in: (c: string, vs: unknown[]) => (
        (linhas = linhas.filter((l) => vs.map(String).includes(String(l[c])))),
        q
      ),
      gt: (c: string, v: string) => ((linhas = linhas.filter((l) => String(l[c]) > v)), q),
      gte: (c: string, v: string) => ((linhas = linhas.filter((l) => String(l[c]) >= v)), q),
      limit: (n: number) => ((limite = n), q),
      maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
      insert: () => (escritas.push(`insert ${tabela}`), q),
      update: () => (escritas.push(`update ${tabela}`), q),
      delete: () => (escritas.push(`delete ${tabela}`), q),
      then: (ok: (r: { data: Linha[] | null; error: unknown }) => unknown) =>
        ok(
          o.falha === tabela
            ? { data: null, error: { message: "falhou" } }
            : { data: linhas.slice(0, limite), error: null },
        ),
    };
    return q;
  };
  return { db: { from } as never, escritas };
}

const E = "emp";
const agora = new Date("2026-11-13T00:30:00Z"); // 12/11 às 21h30 em São Paulo
const LIDA = "2026-11-12T00:40:00Z"; // noite de 11/11
const lead = (id: string, x: Partial<LeadDaNoite> = {}): LeadDaNoite => ({
  id,
  linked_work_order_id: null,
  normalized_phone: "5511900001234",
  os_criada_em: null,
  orcamento_enviado_em: null,
  agendado_em: null,
  realizado_em: null,
  esquecido: false,
  ...x,
});
const decisao = (id: string, criado_em = LIDA, noite_id = "n1") => ({
  empresa_id: E,
  crm_lead_id: id,
  noite_id,
  criado_em,
});
const ficha = (id: string, x: Linha = {}) => ({
  empresa_id: E,
  crm_lead_id: id,
  caixinha: 5,
  resumo_dia: null,
  resumo_ate: null,
  leitura_completa_em: null,
  rever_em: null,
  rever_motivo: null,
  etiquetas: null,
  ...x,
});
const tarefa = (id: string, x: Linha = {}) => ({
  empresa_id: E,
  crm_lead_id: id,
  status: "Pendente",
  origem: "gerente",
  responsavel: "equipe",
  result: null,
  notes: null,
  created_at: "2026-11-12T00:39:00Z",
  completed_at: null,
  updated_at: "2026-11-12T00:39:00Z",
  adiamentos: 0,
  trilha: "G",
  scheduled_at: "2026-11-12T12:00:00Z",
  ...x,
});
const msg = (id: string, em: string, chatwoot: number | null = null) => ({
  empresa_id: E,
  crm_lead_id: id,
  privada: false,
  message_timestamp: em,
  chatwoot_message_id: chatwoot,
});

test("separa quem não tem novidade, sem escrever nada no banco", async () => {
  const leads = [
    lead("parado"), // lido ontem, tarefa na lista, nada novo
    lead("respondeu"), // mensagem nova
    lead("novo"), // nunca lido
    lead("campanha"), // só recebeu disparo de campanha
    lead("feita"), // a equipe deu desfecho à tarefa
    lead("orcou"), // orçamento novo no app
    lead("visita", { linked_work_order_id: "os1" }), // visita mexida
    lead("combinou"), // follow-up de retorno combinado para amanhã
    lead("prometeu"), // o cliente prometeu voltar hoje
    lead("semana"), // releitura completa
    lead("conferencia"), // só tem decisão de noite de conferência: não foi lido de verdade
  ];
  const { db, escritas } = banco({
    comercial_noites: [{ id: "nc", empresa_id: E, modo: "conferencia", iniciada_em: LIDA }],
    comercial_analises: [
      ficha("parado", {
        rever_em: "2026-11-12T03:00:00Z",
        rever_motivo: "ver se respondeu à tarefa",
      }),
      ficha("prometeu", { etiquetas: { retorno_prometido_em: "2026-11-12" } }),
      ficha("semana", {
        resumo_dia: "Quer sofá.",
        resumo_ate: "2026-11-05T18:00:00Z",
        leitura_completa_em: "2026-11-06T00:40:00Z",
      }),
    ],
    comercial_decisoes: [
      ...[
        "parado",
        "respondeu",
        "campanha",
        "feita",
        "orcou",
        "visita",
        "combinou",
        "prometeu",
        "semana",
      ].map((id) => decisao(id)),
      decisao("conferencia", LIDA, "nc"),
    ],
    crm_followups: [
      tarefa("parado", { adiamentos: 1 }),
      // Retorno combinado de verdade (trilha C), criado antes da última leitura.
      tarefa("combinou", {
        origem: "ia",
        responsavel: "alice",
        trilha: "C",
        scheduled_at: "2026-11-13T15:00:00Z",
        created_at: "2026-11-10T12:00:00Z",
      }),
      tarefa("feita", {
        status: "Concluída",
        result: "Feito",
        completed_at: "2026-11-12T14:00:00Z",
      }),
      // Cancelada pela própria noite e adiada pela lista: não são novidade.
      tarefa("campanha", {
        status: "Cancelada",
        notes: "substituída pela Tatiana",
        updated_at: "2026-11-12T20:00:00Z",
      }),
    ],
    whatsapp_messages: [
      msg("respondeu", "2026-11-12T13:00:00Z"),
      msg("campanha", "2026-11-12T12:00:00Z", 77),
      msg("parado", "2026-11-11T20:00:00Z"),
    ],
    mkt_envios: [{ empresa_id: E, chatwoot_message_id: 77 }],
    quotes: [{ empresa_id: E, crm_lead_id: "orcou", updated_at: "2026-11-12T16:00:00Z" }],
    work_orders: [{ empresa_id: E, id: "os1", updated_at: "2026-11-10T10:00:00Z" }],
    visits: [{ empresa_id: E, work_order_id: "os1", updated_at: "2026-11-12T11:00:00Z" }],
    payments: [],
  });
  const r = await separarSemNovidade(db, E, leads, { agora, hoje: "2026-11-12" });
  assert.deepEqual([...r.pulados].sort(), ["campanha", "parado"]);
  assert.deepEqual(r.comTarefa, ["parado"]);
  assert.deepEqual(r.relidos, ["semana"]);
  assert.deepEqual(r.relatorio.lidos, {
    mensagem_nova: 1,
    lead_novo: 2,
    novidade_no_app: 3,
    retorno_combinado: 2,
    releitura_semanal: 1,
  });
  assert.equal(r.relatorio.total, 2);
  assert.deepEqual(r.relatorio.porSituacao, {
    tarefa_na_lista: 1,
    esperando_data: 0,
    sem_pendencia: 1,
  });
  const ex = r.relatorio.exemplos.find((e) => e.lead === "parado");
  assert.deepEqual(ex?.tarefa, { criadaEm: "2026-11-12T00:39:00Z", adiamentos: 1 });
  assert.equal(ex?.final, "1234");
  assert.equal(ex?.ultimaMensagemEm, "2026-11-11T20:00:00Z");
  assert.deepEqual(escritas, []);
});

test("consulta que falha: na dúvida, todo mundo passa pela IA", async () => {
  const tabelas: Tabelas = {
    comercial_decisoes: [decisao("parado")],
    crm_followups: [tarefa("parado")],
  };
  for (const falha of ["crm_followups", "whatsapp_messages", "quotes", "comercial_analises"]) {
    const { db } = banco(tabelas, { falha });
    const r = await separarSemNovidade(db, E, [lead("parado")], { agora, hoje: "2026-11-12" });
    assert.equal(r.pulados.size, 0, falha);
    assert.equal(r.relatorio.total, 0, falha);
  }
  // Sem falha, o mesmo lead fica como está.
  const { db } = banco(tabelas);
  const r = await separarSemNovidade(db, E, [lead("parado")], { agora, hoje: "2026-11-12" });
  assert.deepEqual([...r.pulados], ["parado"]);
});

test("resposta cortada no limite da API: na dúvida, passa", async () => {
  const muitas = Array.from({ length: 1000 }, (_, i) =>
    msg("outro", `2026-11-12T10:${String(i % 60).padStart(2, "0")}:00Z`),
  );
  const { db } = banco({
    comercial_decisoes: [decisao("parado"), decisao("outro")],
    whatsapp_messages: muitas,
  });
  const r = await separarSemNovidade(db, E, [lead("parado"), lead("outro")], {
    agora,
    hoje: "2026-11-12",
  });
  assert.equal(r.pulados.size, 0);
  assert.deepEqual(r.relatorio.lidos, { na_duvida: 1, mensagem_nova: 1 });
});
