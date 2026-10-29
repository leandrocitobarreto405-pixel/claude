import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularFatos, conversaEmTexto, type EntradaFatos } from "./fatos";
import { custoUsd, idDoMotivo, lerFicha } from "./ficha";

const base: EntradaFatos = {
  criadoEm: "2026-10-10T12:00:00Z",
  google: true,
  origem: "Google",
  servicoInteresse: "sofá",
  orcamentoEnviadoEm: "2026-10-10T12:30:00Z",
  perdidoEm: null,
  motivoPerda: null,
  desfechoObs: null,
  vendeu: false,
  valorOs: null,
  valorPago: null,
  osCanceladaOuTeste: false,
  mensagens: [
    {
      direcao: "entrada",
      remetente: "contact",
      tipo: "Texto",
      texto: "Oi, quanto custa?",
      transcricao: null,
      em: "2026-10-10T12:01:00Z",
    },
    {
      direcao: "saida",
      remetente: "agent_bot",
      tipo: "Texto",
      texto: "Me manda foto e CEP?",
      transcricao: null,
      em: "2026-10-10T12:03:00Z",
    },
    {
      direcao: "entrada",
      remetente: "contact",
      tipo: "Áudio",
      texto: "",
      transcricao: "é um sofá de 3 lugares",
      em: "2026-10-10T12:10:00Z",
    },
    {
      direcao: "saida",
      remetente: "user",
      tipo: "Áudio",
      texto: "",
      transcricao: null,
      em: "2026-10-10T12:20:00Z",
    },
  ],
  orcamentos: [
    {
      numero: 1,
      total: 450,
      valorPix: 405,
      valorCartao: 450,
      criadoEm: "2026-10-10T12:29:00Z",
      servicos: ["Sofá"],
    },
  ],
  followups: [],
};

test("fatos: 1ª resposta, preço, quem atendeu e resultado", () => {
  const f = calcularFatos(base);
  assert.equal(f.grupo, "google");
  assert.equal(f.primeiraRespostaMin, 2);
  assert.equal(f.primeiraRespostaDe, "alice");
  assert.equal(f.tempoAtePrecoMin, 29);
  assert.equal(f.quemAtendeu, "alice_e_equipe");
  assert.equal(f.resultado, "sem_desfecho");
  assert.equal(f.valorOrcado, 450);
  assert.deepEqual(f.audios, { cliente: 1, alice: 0, equipe: 1, semTranscricao: 1 });
});

test("fatos: vendeu (OS válida) e perdeu", () => {
  assert.equal(calcularFatos({ ...base, vendeu: true, valorOs: 450 }).resultado, "vendeu");
  assert.equal(calcularFatos({ ...base, vendeu: true, valorOs: 450 }).valorVendido, 450);
  assert.equal(
    calcularFatos({ ...base, vendeu: true, osCanceladaOuTeste: true }).resultado,
    "sem_desfecho",
  );
  assert.equal(calcularFatos({ ...base, perdidoEm: "2026-10-12T12:00:00Z" }).resultado, "perdeu");
  assert.equal(
    calcularFatos({ ...base, orcamentos: [], orcamentoEnviadoEm: null }).resultado,
    "sem_orcamento",
  );
});

test("conversa em texto: áudio transcrito, sem transcrição e horário de SP", () => {
  const t = conversaEmTexto(base.mensagens);
  assert.match(t, /^\[10\/10 09:01\] Cliente: Oi, quanto custa\?/);
  assert.match(t, /Cliente: \(áudio\) é um sofá de 3 lugares/);
  assert.match(t, /Equipe: \(áudio sem transcrição\)/);
});

test("custo do Sonnet com cache", () => {
  assert.equal(
    custoUsd({
      input_tokens: 10_000,
      output_tokens: 2_000,
      cache_read_input_tokens: 3_000,
      cache_creation_input_tokens: 0,
    }),
    0.0406,
  );
});

test("ficha: nota limitada a 0–10 e motivo pelo nome", () => {
  const f = lerFicha(
    JSON.stringify({
      regras: [{ regra: "pix", situacao: "seguiu", quem: "alice", evidencia: "" }, { regra: "x" }],
      nota: 14,
      erros: [],
    }),
  );
  assert.equal(f.nota, 10);
  assert.equal(f.regras.length, 1);
  assert.equal(idDoMotivo(" só cotando ", [{ id: "a", nome: "Só cotando" }]), "a");
  assert.equal(idDoMotivo("", [{ id: "a", nome: "Só cotando" }]), null);
});

test("resumo: conversão, perdas em R$ e serviço principal", async () => {
  const { conversaoPor, perdasPorMotivo, servicoPrincipal, funil } = await import("./resumo");
  const f = (
    resultado: "vendeu" | "perdeu" | "sem_desfecho" | "sem_orcamento",
    valor: number,
    motivo: string | null = null,
  ) => ({
    grupo: "google" as const,
    status: "ok" as const,
    servico: "sofa: 3 lugares",
    origem: "Google",
    resultado,
    valorOrcado: valor,
    valorVendido: resultado === "vendeu" ? valor : null,
    nota: 7,
    motivoSugerido: motivo,
    motivoRegistrado: null,
    quemAtendeu: "alice",
    custoUsd: 0.05,
    ficha: null,
    fatos: null,
  });
  const fichas = [
    f("vendeu", 400),
    f("perdeu", 300, "Preço"),
    f("sem_desfecho", 500, "Preço"),
    f("sem_orcamento", 0),
  ];
  const c = conversaoPor(fichas, (x) => servicoPrincipal(x.servico));
  assert.equal(c[0]!.chave, "Sofa");
  assert.equal(c[0]!.vendas, 1);
  assert.equal(c[0]!.conversao, 0.25);
  assert.deepEqual(perdasPorMotivo(fichas), [{ motivo: "Preço", n: 2, valor: 800 }]);
  assert.equal(funil(fichas)[2]!.n, 3);
});

test("nome do cliente vira [nome] fora da mensagem sugerida", async () => {
  const { mascararNome } = await import("./ficha");
  const f = mascararNome(
    {
      evidencia: "No áudio: 'você tem alguma dúvida Márcia'",
      mensagem_sugerida: "Oi, Márcia!",
      lista: ["MARCIA disse"],
    },
    "Márcia Fictícia",
    ["mensagem_sugerida"],
  );
  assert.equal(f.evidencia, "No áudio: 'você tem alguma dúvida [nome]'");
  assert.equal(f.mensagem_sugerida, "Oi, Márcia!");
  assert.deepEqual(f.lista, ["[nome] disse"]);
});

test("mensagem sugerida: expressões proibidas", async () => {
  const { mensagemProibida } = await import("./ficha");
  assert.equal(mensagemProibida("Oi! Passando para saber se deu certo"), "Passando para saber");
  assert.equal(mensagemProibida("Ficou com alguma dúvida?"), "Ficou com alguma dúvida");
  assert.equal(mensagemProibida("Está aí?"), "Está aí?");
  assert.equal(
    mensagemProibida("Separei um resumo para você mostrar ao seu marido. Posso mandar?"),
    null,
  );
});

test("relatório: defeitos da Alice antes e depois de 28/10", async () => {
  const { defeitosAntesDepois } = await import("./relatorio");
  const ficha = (defeitos: string[], em: string) => ({
    grupo: "google" as const,
    status: "ok" as const,
    servico: null,
    origem: null,
    resultado: "sem_desfecho" as const,
    valorOrcado: null,
    valorVendido: null,
    nota: null,
    motivoSugerido: null,
    motivoRegistrado: null,
    quemAtendeu: null,
    custoUsd: 0,
    ficha: { defeitos_alice: defeitos } as never,
    fatos: { primeiraMensagemCliente: em } as never,
  });
  const r = defeitosAntesDepois([
    ficha(["pediu_cep_de_novo", "ficou_com_duvida"], "2026-10-10T12:00:00Z"),
    ficha(["pediu_cep_de_novo"], "2026-10-29T12:00:00Z"),
    ficha(["ficou_com_duvida", "ficou_com_duvida"], "2026-10-27T12:00:00Z"),
  ]);
  const cep = r.find((x) => x.defeito === "pediu_cep_de_novo")!;
  const duvida = r.find((x) => x.defeito === "ficou_com_duvida")!;
  assert.deepEqual([cep.antes, cep.depois], [1, 1]);
  assert.deepEqual([duvida.antes, duvida.depois, duvida.total], [2, 0, 2]);
});
