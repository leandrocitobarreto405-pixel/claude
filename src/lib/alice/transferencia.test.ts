import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoriaDoMotivo,
  fraseDaTransferencia,
  fraseParaOCliente,
  tempoDeEspera,
  horaDoAlarme,
  minutosEsperando,
  motivoDaTarefaDaManha,
  prazoDaTransferencia,
  respostaDaEquipe,
  textoDoAlarme,
} from "./transferencia";

// Segunda a sábado, das 8h às 19h. 12/11/2026 é quinta; 14/11 é sábado; 15/11 é domingo.
const horario = { dias: [1, 2, 3, 4, 5, 6], inicio: "08:00", fim: "19:00" };
const sp = (dia: string, hm: string) => new Date(`${dia}T${hm}:00-03:00`);

test("prazo: 10 minutos no horário; fora dele, logo cedo no próximo dia de atendimento", () => {
  const noHorario = prazoDaTransferencia(sp("2026-11-12", "14:00"), horario, 10);
  assert.deepEqual(noHorario, {
    foraDoHorario: false,
    prazoEm: sp("2026-11-12", "14:10").toISOString(),
    frase: "em até 10 minutos",
  });
  const noite = prazoDaTransferencia(sp("2026-11-12", "21:30"), horario, 10);
  assert.deepEqual(noite, {
    foraDoHorario: true,
    prazoEm: sp("2026-11-13", "08:00").toISOString(),
    frase: "logo cedo amanhã",
  });
  // Madrugada: o atendimento abre no mesmo dia.
  assert.equal(
    prazoDaTransferencia(sp("2026-11-13", "06:30"), horario, 10).frase,
    "hoje logo cedo",
  );
  // Sábado à noite: domingo não tem atendimento, abre na segunda.
  const sabado = prazoDaTransferencia(sp("2026-11-14", "20:00"), horario, 10);
  assert.equal(sabado.frase, "logo cedo na segunda-feira");
  assert.equal(sabado.prazoEm, sp("2026-11-16", "08:00").toISOString());
  // Feriado bloqueado conta como dia sem atendimento.
  const feriado = prazoDaTransferencia(
    sp("2026-11-19", "20:00"),
    { ...horario, bloqueados: ["2026-11-20"] },
    10,
  );
  assert.equal(feriado.prazoEm, sp("2026-11-21", "08:00").toISOString());
  assert.equal(feriado.frase, "logo cedo no sábado");
});

test("frase da transferência: com o nome da atendente e o prazo", () => {
  const prazo = prazoDaTransferencia(sp("2026-11-12", "14:00"), horario, 10);
  assert.equal(
    fraseDaTransferencia("Maria", prazo),
    "Vou chamar a Maria, nossa especialista, e ela te responde em até 10 minutos, tá bom? Ela já está com todas as informações aqui 💙",
  );
  const noite = prazoDaTransferencia(sp("2026-11-12", "21:30"), horario, 10);
  assert.equal(
    fraseDaTransferencia(null, noite),
    "Vou chamar a nossa especialista e ela te responde logo cedo amanhã, tá bom? Ela já está com todas as informações aqui 💙",
  );
});

test("resposta da equipe: só mensagem de pessoa da equipe para o cliente, depois da transferência", () => {
  const criada = "2026-11-12T17:00:00Z";
  const m = (em: string, x: Partial<Parameters<typeof respostaDaEquipe>[0][number]> = {}) => ({
    direction: "Enviada",
    remetente_tipo: "user",
    privada: false,
    message_timestamp: em,
    ...x,
  });
  assert.equal(respostaDaEquipe([], criada), null);
  // Antes da transferência, nota interna, a própria Alice, campanha e o cliente não contam.
  assert.equal(
    respostaDaEquipe(
      [
        m("2026-11-12T16:59:00Z"),
        m("2026-11-12T17:01:00Z", { privada: true }),
        m("2026-11-12T17:02:00Z", { remetente_tipo: "agent_bot" }),
        m("2026-11-12T17:03:00Z", { remetente_tipo: "campanha" }),
        m("2026-11-12T17:04:00Z", { direction: "Recebida", remetente_tipo: "contact" }),
      ],
      criada,
    ),
    null,
  );
  assert.equal(
    respostaDaEquipe([m("2026-11-12T17:09:00Z"), m("2026-11-12T17:06:00Z")], criada),
    "2026-11-12T17:06:00Z",
  );
});

test("alarme: de 5 em 5 minutos, só no horário; fora dele, quando o atendimento abre", () => {
  const t = {
    criadaEm: sp("2026-11-12", "14:00").toISOString(),
    prazoEm: sp("2026-11-12", "14:10").toISOString(),
    foraDoHorario: false,
    ultimoPushEm: null as string | null,
  };
  assert.equal(horaDoAlarme(t, sp("2026-11-12", "14:03"), horario), false);
  assert.equal(horaDoAlarme(t, sp("2026-11-12", "14:05"), horario), true);
  const avisado = { ...t, ultimoPushEm: sp("2026-11-12", "14:05").toISOString() };
  assert.equal(horaDoAlarme(avisado, sp("2026-11-12", "14:08"), horario), false);
  assert.equal(horaDoAlarme(avisado, sp("2026-11-12", "14:10"), horario), true);
  // Depois das 19h o alarme para e volta às 8h do dia seguinte.
  assert.equal(horaDoAlarme(avisado, sp("2026-11-12", "19:30"), horario), false);
  assert.equal(horaDoAlarme(avisado, sp("2026-11-13", "08:00"), horario), true);
  // Transferida à noite: nada até abrir; às 8h sai o primeiro.
  const noite = {
    criadaEm: sp("2026-11-12", "21:30").toISOString(),
    prazoEm: sp("2026-11-13", "08:00").toISOString(),
    foraDoHorario: true,
    ultimoPushEm: null,
  };
  assert.equal(horaDoAlarme(noite, sp("2026-11-12", "21:40"), horario), false);
  assert.equal(horaDoAlarme(noite, sp("2026-11-13", "08:00"), horario), true);
  assert.equal(minutosEsperando(noite, sp("2026-11-13", "08:12")), 12);
  assert.equal(minutosEsperando(t, sp("2026-11-12", "14:17")), 17);
});

test("textos: push do alarme, tarefa da manhã e categoria para a medição", () => {
  assert.deepEqual(
    textoDoAlarme({
      nome: "Carlos",
      final: "2210",
      motivo: "encaixe",
      minutos: 5,
      foraDoHorario: false,
    }),
    {
      titulo: "🔴 Cliente esperando: Carlos (final 2210)",
      corpo: "A Alice transferiu há 5 min (encaixe). Ninguém respondeu ainda.",
    },
  );
  assert.match(
    textoDoAlarme({ nome: "", final: "", motivo: "desconto", minutos: 0, foraDoHorario: true })
      .corpo,
    /^A Alice transferiu fora do horário \(desconto\)/,
  );
  assert.equal(
    motivoDaTarefaDaManha("encaixe", null),
    "A Alice transferiu fora do horário (encaixe) e disse ao cliente que a resposta vem logo cedo. Responder primeiro.",
  );
  assert.match(motivoDaTarefaDaManha("desconto", 435), /Valor sugerido: R\$\s435,00\./);
  assert.ok(motivoDaTarefaDaManha("x".repeat(400), null).length <= 300);
  for (const [motivo, categoria] of [
    ["encaixe na agenda", "encaixe"],
    ["concorrência", "concorrencia"],
    ["desconto", "desconto"],
    ["CEP fora da área", "fora_da_area"],
    ["item fora da tabela", "item_fora_da_tabela"],
    ["reservar horário", "agenda"],
    ["⚠️ PRIORIDADE (problema no pós-venda): mancha", "pos_venda"],
    ["cliente pediu uma pessoa", "pediu_pessoa"],
    ["outra coisa", "outro"],
  ] as const)
    assert.equal(categoriaDoMotivo(motivo), categoria, motivo);
});

test("encaixe: a Alice promete voltar no prazo, sem chamar a atendente", () => {
  const prazo = prazoDaTransferencia(sp("2026-11-12", "14:00"), horario, 10);
  assert.equal(
    fraseParaOCliente("encaixe na agenda", "Maria", prazo),
    "Vou ver agora com a equipe se consigo um encaixe pra você e te retorno em até 10 minutos, tá bom? 💙",
  );
  const noite = prazoDaTransferencia(sp("2026-11-12", "22:00"), horario, 10);
  assert.equal(
    fraseParaOCliente("Encaixe: quer hoje ainda", "Maria", noite),
    "Vou ver com a equipe se consigo um encaixe pra você e te retorno logo cedo amanhã, tá bom? 💙",
  );
  assert.match(fraseParaOCliente("quer desconto", "Maria", prazo), /^Vou chamar a Maria/);
});

test("tempo de espera: minutos até 59, depois horas", () => {
  assert.deepEqual([0, 8, 59, 60, 65, 344].map(tempoDeEspera), [
    "0 min",
    "8 min",
    "59 min",
    "1h",
    "1h05",
    "5h44",
  ]);
});
