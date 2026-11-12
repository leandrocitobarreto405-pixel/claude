import { test } from "node:test";
import assert from "node:assert/strict";
import type { Avisador } from "./avisos.server";
import { alarmeDeTransferencias, registrarTransferencia } from "./transferencia.server";
import { avisoForaDoAr } from "./fora-do-ar.server";
import { prazoDaTransferencia } from "./transferencia";
import { horarioDaConfig } from "@/lib/comercial/furos";
import { PREFERENCIAS_PADRAO } from "@/lib/push/notificacoes";

type Linha = Record<string, unknown> & {
  id?: string;
  motivo?: string;
  tipo?: string;
  status?: string;
  situacao?: string;
  pushes?: number;
  fora_do_horario?: boolean;
  respondida_em?: string | null;
  dados?: { segundos?: number };
};

/** Banco de mentira: filtros simples, insert e update de verdade nas linhas. */
function banco(tabelas: Record<string, Linha[]>) {
  let n = 0;
  const from = (tabela: string) => {
    const todas = (tabelas[tabela] ??= []);
    let linhas = todas;
    let patch: Linha | null = null;
    const fim = () => {
      if (patch) for (const l of linhas) Object.assign(l, patch);
      return { data: linhas, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => l[c] === v)), q),
      in: (c: string, vs: unknown[]) => ((linhas = linhas.filter((l) => vs.includes(l[c]))), q),
      is: (c: string, v: unknown) => ((linhas = linhas.filter((l) => (l[c] ?? null) === v)), q),
      gt: (c: string, v: string) => ((linhas = linhas.filter((l) => String(l[c]) > v)), q),
      gte: (c: string, v: string) => ((linhas = linhas.filter((l) => String(l[c]) >= v)), q),
      lte: (c: string, v: string) => ((linhas = linhas.filter((l) => String(l[c]) <= v)), q),
      update: (p: Linha) => ((patch = p), q),
      insert: (l: Linha) => {
        todas.push({ id: `novo${++n}`, respondida_em: null, pushes: 0, ...l });
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve({ data: fim().data[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => ok(fim()),
    };
    return q;
  };
  const tab = (nome: string): Linha[] => (tabelas[nome] ??= []);
  return { db: { from } as never, tab };
}

function avisador(pessoas: Array<{ userId: string; papel: "admin" | "atendente" | "tecnico" }>) {
  const enviados: Array<{
    userId: string;
    tipo: string;
    ref: string;
    titulo: string;
    corpo: string;
  }> = [];
  const a: Avisador = {
    pessoas: async () =>
      pessoas.map((p) => ({ ...p, pref: { ...PREFERENCIAS_PADRAO, cliente_esperando: true } })),
    enviar: async (o) => {
      if (enviados.some((e) => e.userId === o.userId && e.tipo === o.tipo && e.ref === o.ref))
        return 0;
      enviados.push({
        userId: o.userId,
        tipo: o.tipo,
        ref: o.ref,
        titulo: o.titulo,
        corpo: o.corpo,
      });
      return 1;
    },
  };
  return { a, enviados };
}

const E = "emp";
// Segunda a sexta, 8h às 18h (São Paulo).
const horario = horarioDaConfig(
  { dias_uteis: [1, 2, 3, 4, 5], hora_inicio: "08:00", hora_fim: "18:00" },
  [],
);
const horarioDe = async () => horario;
const equipe = [
  { userId: "dono", papel: "admin" as const },
  { userId: "maria", papel: "atendente" as const },
  { userId: "tec", papel: "tecnico" as const },
];
const conversa = (id: string, status = "open") => ({
  id,
  empresa_id: E,
  status,
  encerrada_em: null,
  contato: {
    profile_name: "Carlos Lima",
    nome_confirmado: null,
    display_phone: "+55 11 90000-2210",
  },
});

test("transferência: registra uma em aberto por conversa e o evento da medição", async () => {
  const { db, tab } = banco({});
  const agora = new Date("2026-11-12T17:00:00Z"); // quinta, 14h
  const prazo = prazoDaTransferencia(agora, horario, 10);
  const o = { empresaId: E, conversaId: "c1", leadId: "l1", resumo: "Quer sofá hoje.", prazo };
  await registrarTransferencia(db, { ...o, motivo: "encaixe hoje" });
  await registrarTransferencia(db, { ...o, motivo: "encaixe hoje à tarde" });
  assert.equal(tab("alice_transferencias").length, 1);
  assert.equal(tab("alice_transferencias")[0]!.motivo, "encaixe hoje à tarde");
  assert.equal(tab("alice_transferencias")[0]!.fora_do_horario, false);
  assert.deepEqual(
    tab("alice_eventos").map((e) => e.tipo),
    ["transferencia", "transferencia"],
  );
});

test("alarme: push de 5 em 5 minutos para admin e atendente; para quando a equipe responde", async () => {
  const criada = "2026-11-12T17:00:00Z";
  const { db, tab } = banco({
    alice_transferencias: [
      {
        id: "t1",
        empresa_id: E,
        conversa_id: "c1",
        crm_lead_id: "l1",
        motivo: "encaixe hoje",
        criada_em: criada,
        prazo_em: "2026-11-12T17:10:00Z",
        fora_do_horario: false,
        ultimo_push_em: null,
        pushes: 0,
        respondida_em: null,
      },
    ],
    ia_configuracoes: [{ empresa_id: E, alarme_transferencia: true }],
    conversas: [conversa("c1")],
    whatsapp_messages: [],
  });
  const { a, enviados } = avisador(equipe);
  const rodar = (iso: string) => alarmeDeTransferencias(db, new Date(iso), a, horarioDe);

  // 3 minutos: ainda cedo.
  assert.equal((await rodar("2026-11-12T17:03:00Z")).pushes, 0);
  // 5 minutos: primeiro push, só para quem atende (técnico não recebe).
  assert.equal((await rodar("2026-11-12T17:05:00Z")).pushes, 2);
  assert.deepEqual(enviados.map((e) => e.userId).sort(), ["dono", "maria"]);
  assert.equal(enviados[0]?.titulo, "🔴 Cliente esperando: Carlos (final 2210)");
  assert.match(enviados[0]?.corpo ?? "", /há 5 min/);
  // 7 minutos: nada novo. 10 minutos: segundo push.
  assert.equal((await rodar("2026-11-12T17:07:00Z")).pushes, 0);
  assert.equal((await rodar("2026-11-12T17:10:00Z")).pushes, 2);
  assert.equal(tab("alice_transferencias")[0]!.pushes, 2);

  // A Maria respondeu ao cliente: fecha e não manda mais nada.
  tab("whatsapp_messages").push({
    empresa_id: E,
    conversa_id: "c1",
    direction: "Enviada",
    remetente_tipo: "user",
    privada: false,
    message_timestamp: "2026-11-12T17:12:00Z",
  });
  const r = await rodar("2026-11-12T17:15:00Z");
  assert.deepEqual(r, { abertas: 1, respondidas: 1, pushes: 0 });
  assert.equal(tab("alice_transferencias")[0]!.respondida_em, "2026-11-12T17:12:00Z");
  assert.equal(enviados.length, 4);
  const evento = tab("alice_eventos").at(-1)!;
  assert.equal(evento.tipo, "transferencia_respondida");
  assert.equal(evento.dados?.segundos, 720);
});

test("alarme: chave desligada não manda push; fora do horário espera o atendimento abrir", async () => {
  const base = {
    crm_lead_id: null,
    motivo: "quer desconto",
    ultimo_push_em: null,
    pushes: 0,
    respondida_em: null,
  };
  const { db, tab } = banco({
    alice_transferencias: [
      // Transferida às 22h de quinta: prazo é a abertura de sexta (8h = 11h UTC).
      {
        ...base,
        id: "noite",
        empresa_id: E,
        conversa_id: "c1",
        criada_em: "2026-11-13T01:00:00Z",
        prazo_em: "2026-11-13T11:00:00Z",
        fora_do_horario: true,
      },
      {
        ...base,
        id: "outra",
        empresa_id: "sem-chave",
        conversa_id: "c2",
        criada_em: "2026-11-13T01:00:00Z",
        prazo_em: "2026-11-13T11:00:00Z",
        fora_do_horario: true,
      },
    ],
    ia_configuracoes: [
      { empresa_id: E, alarme_transferencia: true },
      { empresa_id: "sem-chave", alarme_transferencia: false },
    ],
    conversas: [conversa("c1"), { ...conversa("c2"), empresa_id: "sem-chave" }],
    whatsapp_messages: [],
  });
  const { a, enviados } = avisador(equipe);
  // 23h de quinta e 7h de sexta: ninguém é acordado.
  assert.equal(
    (await alarmeDeTransferencias(db, new Date("2026-11-13T02:00:00Z"), a, horarioDe)).pushes,
    0,
  );
  assert.equal(
    (await alarmeDeTransferencias(db, new Date("2026-11-13T10:00:00Z"), a, horarioDe)).pushes,
    0,
  );
  // 8h de sexta: o push sai, só na empresa com a chave ligada.
  assert.equal(
    (await alarmeDeTransferencias(db, new Date("2026-11-13T11:00:00Z"), a, horarioDe)).pushes,
    2,
  );
  assert.ok(enviados.every((e) => e.ref.startsWith("noite:")));
  assert.equal(tab("alice_transferencias")[1]!.pushes, 0);

  // A conversa voltou para a Alice: o alarme fecha sozinho.
  tab("conversas")[0]!.status = "pending";
  await alarmeDeTransferencias(db, new Date("2026-11-13T11:05:00Z"), a, horarioDe);
  assert.ok(tab("alice_transferencias")[0]!.respondida_em);
  assert.equal(tab("alice_eventos").at(-1)!.tipo, "transferencia_encerrada");
});

test("Alice fora do ar: push só para o admin, uma vez a cada 15 minutos, só com a chave ligada", async () => {
  const dados = () => ({
    ia_configuracoes: [
      { empresa_id: E, ativo: true, aviso_fora_do_ar: true },
      { empresa_id: "sem-chave", ativo: true, aviso_fora_do_ar: false },
    ],
    ia_tarefas: [
      {
        empresa_id: E,
        tipo: "responder",
        conversa_id: "c1",
        situacao: "erro",
        executar_apos: "2026-11-12T17:10:00Z",
        created_at: "2026-11-12T17:10:00Z",
      },
      {
        empresa_id: "sem-chave",
        tipo: "responder",
        conversa_id: "c9",
        situacao: "erro",
        executar_apos: "2026-11-12T17:10:00Z",
        created_at: "2026-11-12T17:10:00Z",
      },
    ],
    ia_paradas: [
      { empresa_id: E, provedor: "ia", causa: "credito", conversas: ["c7", "c8"], fim: null },
    ],
    conversas: [conversa("c1", "pending"), conversa("c9", "pending")],
  });
  const { db, tab } = banco(dados());
  const { a, enviados } = avisador(equipe);
  const r = await avisoForaDoAr(db, new Date("2026-11-12T17:31:00Z"), a);
  assert.deepEqual(r, { empresas: 1, pushes: 1 });
  assert.deepEqual(
    enviados.map((e) => e.userId),
    ["dono"],
  );
  assert.equal(enviados[0]?.titulo, "🔴 Alice fora do ar: 3 clientes esperando");
  assert.equal(
    enviados[0]?.corpo,
    "A conta da IA está sem crédito. 1 cliente está sem resposta (o mais antigo há 21 min). 2 conversas foram para a equipe.",
  );
  assert.equal(tab("alice_eventos").length, 1);
  // 5 minutos depois: mesmo intervalo, nada. No intervalo seguinte: de novo.
  assert.equal((await avisoForaDoAr(db, new Date("2026-11-12T17:36:00Z"), a)).pushes, 0);
  assert.equal((await avisoForaDoAr(db, new Date("2026-11-12T17:46:00Z"), a)).pushes, 1);

  // Tudo normal (resposta concluída, nenhuma parada): silêncio.
  const ok = dados();
  ok.ia_tarefas[0]!.situacao = "concluida";
  ok.ia_paradas = [];
  const limpo = avisador(equipe);
  assert.deepEqual(await avisoForaDoAr(banco(ok).db, new Date("2026-11-12T17:31:00Z"), limpo.a), {
    empresas: 0,
    pushes: 0,
  });
  // Tarefa com erro de conversa que a equipe já assumiu: não é cliente esperando a Alice.
  const assumida = dados();
  assumida.ia_paradas = [];
  assumida.conversas[0]!.status = "open";
  assert.equal(
    (await avisoForaDoAr(banco(assumida).db, new Date("2026-11-12T17:31:00Z"), limpo.a)).pushes,
    0,
  );
});
