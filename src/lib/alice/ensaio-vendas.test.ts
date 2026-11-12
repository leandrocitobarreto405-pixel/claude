import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { conferirConversa, diasCitados, type TurnoEnsaio } from "./ensaio-vendas.server";
import {
  MODULOS_FASE2,
  NUCLEO_FASE2,
  aplicarTrocas,
  modulosComFase2,
  vezesDosTrechos,
} from "./textos-fase2";

const turno = (o: Partial<TurnoEnsaio> & { alice: string[] }): TurnoEnsaio => ({
  cliente: "x",
  foto: false,
  atalho: false,
  travado: false,
  retidos: [],
  ferramentas: [],
  refeita: false,
  ...o,
});
const f = (nome: string, entrada: unknown = {}) => ({ nome, entrada: JSON.stringify(entrada) });

test("textos da fase 2: cada trecho troca uma vez, na ordem do SQL", () => {
  const texto = ["topo", ...NUCLEO_FASE2.map((t) => t.antes), "fim"].join("\nXX\n");
  assert.deepEqual(
    vezesDosTrechos(texto, NUCLEO_FASE2),
    NUCLEO_FASE2.map(() => 1),
  );
  const novo = aplicarTrocas(texto, NUCLEO_FASE2);
  for (const t of NUCLEO_FASE2) if (t.depois) assert.ok(novo.includes(t.depois), t.titulo);
  assert.equal(novo.includes("Oferecer ou calcular combo"), false);
  // Mesmo texto de ensaio montado no Python do SQL: mesmo md5 (conferido também no Postgres).
  const md5 = createHash("md5").update(novo, "utf8").digest("hex");
  assert.equal(md5, createHash("md5").update(aplicarTrocas(texto, NUCLEO_FASE2)).digest("hex"));
  const mods = modulosComFase2([
    { chave: "sofa", texto: `a ${MODULOS_FASE2["sofa"]![0]!.antes} b` },
    { chave: "cadeiras", texto: "igual" },
  ]);
  assert.match(String(mods[0]!.texto), /uma vez só/);
  assert.equal(mods[1]!.texto, "igual");
});

test("dias citados: dias diferentes", () => {
  assert.equal(diasCitados("Tenho sexta, entre 14h e 15h, ou sábado, entre 9h e 10h."), 2);
  assert.equal(diasCitados("Tenho sexta às 14h ou às 16h"), 1);
  assert.equal(diasCitados("Dia 16/11 ou 17/11?"), 2);
});

test("conferência do apressado", () => {
  const bom = [
    turno({
      atalho: true,
      alice: ["Oi, Eduardo!", "Enquanto você assiste...", "🎬 [vídeo]", "*Total:* R$ 310,00"],
      ferramentas: [f("enviar_video"), f("criar_orcamento")],
    }),
    turno({
      alice: ["Tenho sexta, entre 14h e 15h, ou sábado, entre 9h e 10h. Qual é melhor?"],
      ferramentas: [f("consultar_agenda")],
    }),
  ];
  assert.deepEqual(conferirConversa("apressado", bom), { passou: true, problemas: [] });
  const ruim = [
    turno({
      atalho: true,
      alice: ["O que mais te incomoda no seu sofá?"],
      ferramentas: [f("falar_em_audio")],
    }),
  ];
  const r = conferirConversa("apressado", ruim);
  assert.equal(r.passou, false);
  assert.ok(r.problemas.includes("a primeira resposta saiu sem o valor"));
  assert.ok(r.problemas.includes("não mandou o vídeo junto"));
  assert.ok(r.problemas.includes("tentou mandar áudio no atalho"));
  assert.ok(r.problemas.includes("não chegou ao orçamento"));
});

test("conferência do combo e da foto", () => {
  const combo = [
    turno({ alice: ["Me manda uma foto e o CEP?"] }),
    turno({ alice: ["Consegue me mandar uma foto?"] }),
    turno({
      alice: ["Valor cheio R$ 780,00 / Combo R$ 702,00"],
      ferramentas: [f("criar_orcamento", { servico: "higienizacao", itens: [], combo: false })],
    }),
  ];
  const r = conferirConversa("combo", combo);
  assert.ok(r.problemas.includes("orçou sem o combo"));
  assert.ok(
    r.problemas.includes("pediu a foto de novo depois de o cliente dizer que não conseguia"),
  );
  const foto = [
    turno({ foto: true, alice: ["Que sofá lindo! Me passa o seu CEP?"] }),
    turno({ alice: ["O que mais te incomoda no seu sofá hoje?"] }),
    turno({
      atalho: true,
      alice: ["🎬 [vídeo]", "*Total:* R$ 379,90"],
      ferramentas: [f("enviar_video"), f("criar_orcamento")],
    }),
    turno({ alice: ["O que mais te incomoda?", "Tenho sexta ou sábado"] }),
  ];
  const r2 = conferirConversa("foto", foto);
  assert.deepEqual(r2.problemas, ["repetiu a pergunta do motivo"]);
});
