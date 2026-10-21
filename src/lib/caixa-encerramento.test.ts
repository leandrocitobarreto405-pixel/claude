import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarRegra1,
  configEncerramento,
  encerradaDe,
  horaDeRodar,
  limiteParada,
  paraSalvar,
  situacoesAlcancadas,
} from "./caixa-encerramento";

test("encerramento automático: padrão ligado, 24 h, equipe e Alice; cada empresa ajusta", () => {
  assert.deepEqual(configEncerramento(null), { ligado: true, horas: 24, incluirAlice: true });
  assert.deepEqual(configEncerramento({}).ligado, true, "empresa sem configuração herda o padrão");
  assert.deepEqual(configEncerramento({ encerramento_horas: 0 }).horas, 24);
  assert.deepEqual(configEncerramento({ encerramento_horas: 9999 }).horas, 24);
  const c = configEncerramento({
    encerramento_automatico: false,
    encerramento_horas: "48",
    encerramento_inclui_alice: false,
  });
  assert.deepEqual(c, { ligado: false, horas: 48, incluirAlice: false });
  assert.deepEqual(situacoesAlcancadas(c), ["open"]);
  assert.deepEqual(situacoesAlcancadas({ ...c, incluirAlice: true }), ["open", "pending"]);
  assert.equal(limiteParada(c, new Date("2026-10-21T12:00:00Z")), "2026-10-19T12:00:00.000Z");
  assert.deepEqual(paraSalvar(c), {
    encerramento_automatico: false,
    encerramento_horas: 48,
    encerramento_inclui_alice: false,
  });
});

test("roda de hora em hora por empresa", () => {
  const agora = new Date("2026-10-21T12:00:00Z");
  assert.equal(horaDeRodar(undefined, agora), true, "nunca rodou");
  assert.equal(horaDeRodar("lixo", agora), true);
  assert.equal(horaDeRodar("2026-10-21T11:30:00Z", agora), false, "rodou há 30 min");
  assert.equal(horaDeRodar("2026-10-21T11:04:00Z", agora), true, "rodou há 56 min");
  assert.equal(
    horaDeRodar("2026-10-21T11:55:00Z", agora, { lotada: true }),
    true,
    "rodada anterior encheu o lote: continua na próxima varredura",
  );
  assert.equal(horaDeRodar("2026-10-21T11:55:00Z", agora, { lotada: false }), false);
});

test("regra 1: follow-up, lembrete/pós-venda/campanha ou tarefa pendente protegem a conversa", () => {
  const c = (id: string, extra: Partial<Parameters<typeof aplicarRegra1>[0][number]> = {}) => ({
    id,
    status: "open",
    crm_lead_id: null,
    chatwoot_conversation_id: Number(id.slice(1)),
    normalized_phone: `55119700000${id.slice(1)}`,
    ...extra,
  });
  const candidatas = [
    c("c1"),
    c("c2", { crm_lead_id: "lead-2" }),
    c("c3"),
    c("c4"),
    c("c5", { status: "pending" }),
    c("c6", { crm_lead_id: "lead-6", normalized_phone: null }),
  ];
  const sel = aplicarRegra1(candidatas, {
    clientePorUltimo: [],
    followups: [
      { conversa_id: "c1", crm_lead_id: "lead-x" },
      { conversa_id: null, crm_lead_id: "lead-2" },
    ],
    envios: [
      { normalized_phone: "551197000003", chatwoot_conversation_id: null },
      { normalized_phone: null, chatwoot_conversation_id: "4" },
    ],
    tarefas: [{ conversa_id: "c5" }],
  });
  assert.deepEqual(
    sel.encerrar.map((x) => x.id),
    ["c6"],
  );
  assert.deepEqual(sel.protegidas, { total: 5, cliente: 0, followup: 2, envio: 2, tarefa: 1 });
  assert.equal(sel.lotada, false);
  // Lote cheio conta pelas candidatas, não pelas que sobraram para encerrar (21/10: 250
  // candidatas, 2 protegidas, 248 encerradas e a rodada parou por 55 min sem precisar).
  const cheio = aplicarRegra1(
    candidatas,
    { clientePorUltimo: [], followups: [], envios: [], tarefas: [] },
    6,
  );
  assert.equal(cheio.lotada, true);
});

test("regra 2: quem estava com a conversa", () => {
  assert.equal(encerradaDe("pending"), "alice");
  assert.equal(encerradaDe("open"), "equipe");
  assert.equal(encerradaDe(null), "equipe");
});

test("regra 0: cliente por último nunca encerra; empresa por último encerra após o prazo", () => {
  const c = (id: string, status = "open") => ({
    id,
    status,
    crm_lead_id: null,
    chatwoot_conversation_id: 1,
    normalized_phone: null,
  });
  // As candidatas já passaram do prazo (consulta por ultima_atividade_em < limite).
  const sel = aplicarRegra1(
    [
      c("cliente-equipe"),
      c("cliente-alice", "pending"),
      c("empresa-equipe"),
      c("empresa-alice", "pending"),
    ],
    {
      clientePorUltimo: ["cliente-equipe", "cliente-alice"],
      followups: [],
      envios: [],
      tarefas: [],
    },
  );
  assert.deepEqual(
    sel.encerrar.map((x) => x.id),
    ["empresa-equipe", "empresa-alice"],
    "só quem teve a empresa falando por último",
  );
  assert.deepEqual(sel.protegidas, { total: 2, cliente: 2, followup: 0, envio: 0, tarefa: 0 });
  // Dentro do prazo nada é candidata: o limite é pela hora da última atividade.
  assert.equal(
    limiteParada({ ligado: true, horas: 24, incluirAlice: true }, new Date("2026-10-21T12:00:00Z")),
    "2026-10-20T12:00:00.000Z",
  );
});
