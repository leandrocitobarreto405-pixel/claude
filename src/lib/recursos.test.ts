// Recursos por plano: tela de cada recurso, cadeado, plano que tem o recurso e limite de usuários.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planoQueTem,
  recursoDaRota,
  situacaoUsuarios,
  temRecurso,
  type PlanoDaEmpresa,
} from "./recursos";

const planos = [
  {
    codigo: "essencial",
    nome: "Essencial",
    preco_mensal: 97,
    recursos: { cupons: false, alice: false },
  },
  {
    codigo: "profissional",
    nome: "Profissional",
    preco_mensal: 247,
    recursos: { cupons: true, alice: false },
  },
  {
    codigo: "profissional_alice",
    nome: "Profissional + Alice",
    preco_mensal: 497,
    recursos: { cupons: true, alice: true },
  },
];
const essencial: PlanoDaEmpresa = {
  plano: "essencial",
  plano_nome: "Essencial",
  recursos: { cupons: false, alice: false },
  limite_usuarios: 3,
  usuarios_extras: 0,
  usuarios_em_uso: 3,
  planos,
};

test("telas de cada recurso; o resto é do Essencial", () => {
  assert.equal(recursoDaRota("/conversas/abc"), "caixa_entrada");
  assert.equal(recursoDaRota("/crm/funil"), "crm");
  assert.equal(recursoDaRota("/indicadores"), "crm");
  assert.equal(recursoDaRota("/rotas"), "deslocamento_rotas");
  assert.equal(recursoDaRota("/dre"), "dre_comissoes");
  assert.equal(recursoDaRota("/oss"), null);
  assert.equal(recursoDaRota("/notas"), null);
  assert.equal(recursoDaRota("/exportacoes"), null);
  assert.equal(recursoDaRota("/agenda"), null);
});

test("cadeado e plano que tem o recurso", () => {
  assert.equal(temRecurso(essencial, "cupons"), false);
  assert.equal(temRecurso(null, "cupons"), true, "sem plano carregado não trava (não pisca)");
  assert.equal(planoQueTem(essencial, "cupons")?.nome, "Profissional");
  assert.equal(planoQueTem(essencial, "alice")?.nome, "Profissional + Alice");
});

test("limite de usuários", () => {
  assert.deepEqual(situacaoUsuarios(essencial), { limite: 3, emUso: 3, noLimite: true });
  assert.equal(situacaoUsuarios({ ...essencial, limite_usuarios: null }).noLimite, false);
});
