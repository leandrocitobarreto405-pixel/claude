import { test } from "node:test";
import assert from "node:assert/strict";
import { virouDoAviso } from "./avisos-tatiana.functions";

test("aviso: aguardando, revisado sem sugestão e sugestão com a decisão do dono", () => {
  const rels = new Map([
    [
      "r1",
      {
        sugestoes: [{ sugestao: "Pedir só o nome na 1ª resposta" }, { sugestao: "Outra" }],
        decisoes: { "0": { decisao: "aprovada" as const } },
      },
    ],
  ]);
  const base = { relatorio_id: null, sugestao_indice: null, revisado_em: null };
  assert.deepEqual(virouDoAviso(base, rels), { situacao: "aguardando" });
  assert.deepEqual(virouDoAviso({ ...base, revisado_em: "2026-11-02T00:00:00Z" }, rels), {
    situacao: "sem_sugestao",
  });
  assert.deepEqual(virouDoAviso({ ...base, relatorio_id: "r1", sugestao_indice: 0 }, rels), {
    situacao: "sugestao",
    sugestao: "Pedir só o nome na 1ª resposta",
    decisao: "aprovada",
  });
  assert.equal(
    (virouDoAviso({ ...base, relatorio_id: "r1", sugestao_indice: 1 }, rels) as { decisao: string })
      .decisao,
    "pendente",
  );
});
