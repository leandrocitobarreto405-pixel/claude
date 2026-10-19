// Resposta da Alice em áudio: regras e envio com Google/Chatwoot falsos. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  custoReais,
  decidirAudio,
  inicioDoDiaBrasilia,
  paraFala,
  pediuPorEscrito,
  separarResposta,
  temDado,
  vozesDaApi,
  type ConfigAudio,
} from "./voz";
import { responderComAudio, type DepsAudio, type UsoAudio } from "./resposta-audio";

const CFG: ConfigAudio = {
  audio_ativo: true,
  audio_voz: "pt-BR-Chirp3-HD-Kore",
  audio_max_caracteres: 350,
  audio_max_segundos: 25,
  audio_limite_diario_reais: 5,
  audio_cotacao_dolar: 5.5,
};

const CURTA = "Oi! Tudo bem? Recebi seu áudio, vou te ajudar com a limpeza do sofá.";

function falsos(extra: Partial<DepsAudio> = {}) {
  const log = {
    sinteses: [] as string[],
    audios: 0,
    notas: [] as string[],
    usos: [] as UsoAudio[],
    avisos: 0,
  };
  const deps: DepsAudio = {
    gastoHoje: async () => 0,
    sintetizar: async (texto) => {
      log.sinteses.push(texto);
      return { bytes: new Uint8Array([1, 2, 3]) };
    },
    duracao: () => 4.2,
    enviarAudio: async () => {
      log.audios++;
      return { id: 777 };
    },
    enviarNota: async (t) => {
      log.notas.push(t);
    },
    registrar: async (u) => {
      log.usos.push(u);
    },
    avisarLimite: async () => {
      log.avisos++;
    },
    ...extra,
  };
  return { deps, log };
}

const entrada = (resposta: string, extra: Record<string, unknown> = {}) => ({
  cfg: CFG,
  ultimaDoClienteEhAudio: true,
  soTexto: false,
  ehFollowup: false,
  resposta,
  ...extra,
});

// ---------------------------------------------------------------- cenários pedidos

test("cliente mandou texto: só texto, nem consulta o Google", async () => {
  const { deps, log } = falsos();
  const r = await responderComAudio(entrada(CURTA, { ultimaDoClienteEhAudio: false }), deps);
  assert.equal(r.enviado, false);
  assert.equal(log.sinteses.length, 0);
  assert.equal(log.audios, 0);
});

test("cliente mandou áudio e a resposta é curta: áudio, nota com o texto e uso registrado", async () => {
  const { deps, log } = falsos();
  const r = await responderComAudio(entrada(CURTA), deps);
  assert.equal(r.enviado, true);
  assert.equal(r.enviado && r.texto, "");
  assert.equal(log.audios, 1);
  assert.deepEqual(log.notas, [`🔊 Áudio da Alice: ${CURTA}`]);
  assert.equal(log.usos.length, 1);
  const u = log.usos[0]!;
  assert.equal(u.situacao, "enviado");
  assert.equal(u.chatwootMessageId, 777);
  assert.equal(u.segundos, 4.2);
  assert.equal(u.caracteres, CURTA.length);
  assert.equal(u.custo, custoReais(CURTA.length, 5.5));
});

test("resposta com preço: o preço vai em texto (resposta mista = áudio + texto)", async () => {
  const { deps, log } = falsos();
  const resposta = `${CURTA}\n\nO sofá de 3 lugares fica R$ 286,00 no Pix.\n\nPosso agendar?`;
  const r = await responderComAudio(entrada(resposta), deps);
  assert.equal(r.enviado, true);
  assert.deepEqual(log.sinteses, [CURTA]);
  assert.equal(
    r.enviado && r.texto,
    "O sofá de 3 lugares fica R$ 286,00 no Pix.\n\nPosso agendar?",
  );
});

test("resposta só com preço: tudo em texto, sem Google", async () => {
  const { deps, log } = falsos();
  const r = await responderComAudio(entrada("Fica R$ 286,00 à vista."), deps);
  assert.equal(r.enviado, false);
  assert.equal(log.sinteses.length, 0);
});

test("“manda por escrito”: reconhecido, e a conversa só texto não usa áudio", async () => {
  for (const frase of [
    "Pode mandar por escrito?",
    "manda em texto por favor",
    "não consigo ouvir áudio agora",
    "Prefiro mensagem escrita",
    "sem áudio, por favor",
  ])
    assert.ok(pediuPorEscrito(frase), frase);
  for (const frase of ["Quanto fica o sofá?", "Mandei um áudio", "Escrevi meu endereço"])
    assert.ok(!pediuPorEscrito(frase), frase);

  const { deps, log } = falsos();
  const r = await responderComAudio(entrada(CURTA, { soTexto: true }), deps);
  assert.equal(r.enviado, false);
  assert.equal(log.sinteses.length, 0);
});

test("falha do Google (erro ou demora): cai para texto e registra a falha", async () => {
  const { deps, log } = falsos({
    sintetizar: async () => ({ erro: "Text-to-Speech demorou mais de 8 s" }),
  });
  const inicio = Date.now();
  const r = await responderComAudio(entrada(CURTA), deps);
  assert.equal(r.enviado, false);
  assert.ok(Date.now() - inicio < 1000, "não espera de novo");
  assert.equal(log.audios, 0);
  assert.equal(log.notas.length, 0);
  assert.equal(log.usos[0]!.situacao, "falhou");
  assert.match(log.usos[0]!.erro!, /demorou/);
  assert.equal(log.usos[0]!.custo, 0);
});

test("falha no envio pelo Chatwoot: cai para texto e registra (com o custo da síntese)", async () => {
  const { deps, log } = falsos({
    enviarAudio: async () => {
      throw new Error("Chatwoot POST falhou (422)");
    },
  });
  const r = await responderComAudio(entrada(CURTA), deps);
  assert.equal(r.enviado, false);
  assert.equal(log.usos[0]!.situacao, "falhou");
  assert.match(log.usos[0]!.erro!, /Chatwoot/);
  assert.ok(log.usos[0]!.custo > 0);
});

test("limite diário estourado: texto e aviso no sininho", async () => {
  const { deps, log } = falsos({ gastoHoje: async () => 4.999 });
  const r = await responderComAudio(entrada(CURTA), deps);
  assert.equal(r.enviado, false);
  assert.equal(r.decisao.modo === "texto" && r.decisao.motivo, "limite diário");
  assert.equal(log.sinteses.length, 0);
  assert.equal(log.avisos, 1);
});

// ---------------------------------------------------------------- regras

test("desligado, sem voz ou follow-up: nunca áudio", () => {
  const base = { ultimaDoClienteEhAudio: true, soTexto: false, gastoHojeReais: 0, resposta: CURTA };
  assert.equal(
    decidirAudio({ ...base, cfg: { ...CFG, audio_ativo: false }, ehFollowup: false }).modo,
    "texto",
  );
  assert.equal(
    decidirAudio({ ...base, cfg: { ...CFG, audio_voz: null }, ehFollowup: false }).modo,
    "texto",
  );
  assert.equal(decidirAudio({ ...base, cfg: CFG, ehFollowup: true }).modo, "texto");
});

test("resposta longa (caracteres ou segundos): texto", () => {
  const longa = "Pode deixar que eu cuido de tudo pra você. ".repeat(10);
  const base = {
    ultimaDoClienteEhAudio: true,
    soTexto: false,
    gastoHojeReais: 0,
    ehFollowup: false,
  };
  assert.equal(decidirAudio({ ...base, cfg: CFG, resposta: longa }).modo, "texto");
  assert.equal(
    decidirAudio({ ...base, cfg: { ...CFG, audio_max_segundos: 3 }, resposta: CURTA }).modo,
    "texto",
  );
});

test("dados que ficam escritos", () => {
  for (const t of [
    "Fica R$ 300",
    "Dá 15% de desconto",
    "O orçamento segue abaixo",
    "Chave Pix: exemplo",
    "https://exemplo.com.br",
    "CEP 01000-000",
    "Rua das Flores Fictícias, 10",
    "Agendado para 22/10",
    "Às 14h ou às 14:30",
    "Pode ser quinta de manhã?",
    "- Sofá\n- Poltrona",
  ])
    assert.ok(temDado(t), t);
  assert.ok(!temDado(CURTA));
  assert.ok(!temDado("Que bom! Vou ver aqui com a equipe e já te falo."));
});

test("separação: só o começo conversado vai falado", () => {
  assert.deepEqual(separarResposta("Oi!\n\nTudo certo.\n\nFica R$ 10.\n\nBeleza?"), {
    fala: "Oi!\n\nTudo certo.",
    texto: "Fica R$ 10.\n\nBeleza?",
  });
});

test("texto para fala: sem emojis e marcação, abreviações por extenso", () => {
  assert.equal(
    paraFala("Oi! 😊 *Claro*, vc pode mandar 2 fotos 👍🏽"),
    "Oi! Claro, você pode mandar 2 fotos",
  );
  assert.equal(paraFala("_Pode_ deixar, tbm faço ~isso~ 🙌"), "Pode deixar, também faço isso");
});

test("custo: US$ 30 por milhão de caracteres na cotação", () => {
  assert.equal(custoReais(1_000_000, 5.5), 165);
  assert.equal(custoReais(375, 5.5), 0.0619);
});

test("vozes da API: só Chirp 3 HD pt-BR, femininas primeiro", () => {
  const v = vozesDaApi([
    { name: "pt-BR-Chirp3-HD-Puck", ssmlGender: "MALE" },
    { name: "pt-BR-Neural2-A", ssmlGender: "FEMALE" },
    { name: "pt-BR-Chirp3-HD-Kore", ssmlGender: "FEMALE" },
    { name: "pt-BR-Chirp3-HD-Aoede", ssmlGender: "FEMALE" },
  ]);
  assert.deepEqual(
    v.map((x) => `${x.rotulo}:${x.genero}`),
    ["Aoede:feminina", "Kore:feminina", "Puck:masculina"],
  );
});

test("dia de Brasília começa às 03:00 UTC", () => {
  assert.equal(inicioDoDiaBrasilia(new Date("2026-10-20T02:30:00Z")), "2026-10-19T03:00:00.000Z");
  assert.equal(inicioDoDiaBrasilia(new Date("2026-10-20T03:30:00Z")), "2026-10-20T03:00:00.000Z");
});
