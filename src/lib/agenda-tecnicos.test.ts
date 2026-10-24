import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORPO_MODELO_AGENDA,
  diaCurto,
  diaSeguinte,
  formularioModeloAgenda,
  horaDeEnviar,
  podeAtivarAgenda,
  precisaAvisoNaoAbriu,
  situacaoModeloAgenda,
  textoDaAgenda,
  textoDoModeloAgenda,
  variaveisModeloAgenda,
} from "./agenda-tecnicos";
import { componentesDoFormulario, validarFormulario } from "./modelos-mensagem";

test("modelo agenda_tecnico_dia: texto aprovado, utilidade, botão de resposta rápida", () => {
  const f = formularioModeloAgenda();
  assert.equal(f.nome, "agenda_tecnico_dia");
  assert.equal(f.categoria, "UTILITY");
  assert.equal(f.idioma, "pt_BR");
  assert.equal(f.cabecalho, "");
  assert.equal(
    f.corpo,
    'Olá, {{1}}! Sua agenda de amanhã ({{2}}) está pronta, com {{3}} atendimento(s). Toque em "Ver agenda" para receber os horários e endereços.',
  );
  assert.deepEqual(validarFormulario(f), []);
  assert.deepEqual(componentesDoFormulario(f), [
    {
      type: "BODY",
      text: CORPO_MODELO_AGENDA,
      example: { body_text: [["Josué", "sexta, 24/10", "2"]] },
    },
    { type: "FOOTER", text: "Mensagem automática da agenda" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Ver agenda" }] },
  ]);
});

test("variáveis e texto do modelo", () => {
  assert.equal(diaCurto("2026-10-24"), "sábado, 24/10");
  assert.equal(diaCurto("2026-10-23"), "sexta, 23/10");
  assert.deepEqual(variaveisModeloAgenda("Josué Barreto", "2026-10-23", 2), {
    "1": "Josué",
    "2": "sexta, 23/10",
    "3": "2",
  });
  assert.equal(
    textoDoModeloAgenda("Josué Barreto", "2026-10-23", 2),
    'Olá, Josué! Sua agenda de amanhã (sexta, 23/10) está pronta, com 2 atendimento(s). Toque em "Ver agenda" para receber os horários e endereços.',
  );
  assert.equal(diaSeguinte("2026-12-31"), "2027-01-01");
});

test("texto da agenda = Copiar todas", () => {
  assert.equal(textoDaAgenda(["A", "B"]), "A\n\n———\n\nB");
  assert.equal(textoDaAgenda(["A"]), "A");
});

test("situação do modelo e ativar", () => {
  assert.equal(situacaoModeloAgenda(null), "nao_cadastrado");
  assert.equal(situacaoModeloAgenda({ status: "PENDING", category: "UTILITY" }), "pendente");
  assert.equal(situacaoModeloAgenda({ status: "APPROVED", category: "UTILITY" }), "aprovado");
  assert.equal(situacaoModeloAgenda({ status: "REJECTED", category: "UTILITY" }), "rejeitado");
  // Reclassificado para Marketing: não serve, mesmo aprovado.
  assert.equal(situacaoModeloAgenda({ status: "APPROVED", category: "MARKETING" }), "marketing");
  assert.equal(podeAtivarAgenda("aprovado"), true);
  for (const s of ["pendente", "rejeitado", "marketing", "nao_cadastrado", "sem_conexao"] as const)
    assert.equal(podeAtivarAgenda(s), false);
});

test("horário de envio e aviso das 7h (São Paulo)", () => {
  // 21:00 UTC = 18:00 em São Paulo.
  assert.equal(horaDeEnviar("18:00", new Date("2026-10-23T20:59:00Z")), false);
  assert.equal(horaDeEnviar("18:00:00", new Date("2026-10-23T21:00:00Z")), true);
  const envio = {
    situacao: "aguardando",
    dia_agenda: "2026-10-24",
    aviso_nao_abriu_em: null,
    teste: false,
  };
  assert.equal(precisaAvisoNaoAbriu(envio, new Date("2026-10-24T09:59:00Z")), false);
  assert.equal(precisaAvisoNaoAbriu(envio, new Date("2026-10-24T10:00:00Z")), true);
  assert.equal(
    precisaAvisoNaoAbriu({ ...envio, situacao: "enviado" }, new Date("2026-10-24T12:00:00Z")),
    false,
  );
  assert.equal(
    precisaAvisoNaoAbriu({ ...envio, teste: true }, new Date("2026-10-24T12:00:00Z")),
    false,
  );
  assert.equal(
    precisaAvisoNaoAbriu({ ...envio, aviso_nao_abriu_em: "x" }, new Date("2026-10-24T12:00:00Z")),
    false,
  );
});
