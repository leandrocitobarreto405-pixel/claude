// Resposta da Alice em áudio: regras e envio com Google/Chatwoot falsos. Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  custoElevenReais,
  custoReais,
  decidirAudio,
  modeloEleven,
  vozElevenValida,
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

// ---------------------------------------------------------------- ElevenLabs

const ELEVEN: ConfigAudio = {
  ...CFG,
  audio_provedor: "elevenlabs",
  audio_eleven_voz: "BQzELs93jJsUOf5rCb9p",
  audio_eleven_modelo: "eleven_flash_v2_5",
  eleven_usd_por_mil_creditos: 0.22,
};

test("ElevenLabs: custo por modelo (v4 o dobro do Flash) e comparação com o Google", () => {
  // 300 caracteres: Google US$ 0,009; Flash 150 créditos; v4 300 créditos (US$ 0,22 por mil).
  assert.equal(custoReais(300, 5.65), 0.0509);
  assert.equal(custoElevenReais(300, "eleven_flash_v2_5", 0.22, 5.65), 0.1865);
  assert.equal(custoElevenReais(300, "eleven_v4", 0.22, 5.65), 0.3729);
  assert.equal(modeloEleven("qualquer"), "eleven_flash_v2_5");
  assert.equal(vozElevenValida("BQzELs93jJsUOf5rCb9p"), true);
  assert.equal(vozElevenValida("pt-BR-Chirp3-HD-Kore"), false);
});

test("ElevenLabs: decisão usa a voz e o custo da ElevenLabs, com o Google de reserva", () => {
  const d = decidirAudio({ ...entrada(CURTA), cfg: ELEVEN, gastoHojeReais: 0 });
  assert.equal(d.modo, "audio");
  if (d.modo !== "audio") return;
  assert.equal(d.provedor, "elevenlabs");
  assert.equal(d.voz, "BQzELs93jJsUOf5rCb9p");
  assert.equal(d.modelo, "eleven_flash_v2_5");
  assert.equal(d.vozReserva, "pt-BR-Chirp3-HD-Kore");
  assert.ok(d.custo > custoReais(d.caracteres, 5.5));
  // Sem voz da ElevenLabs salva: segue no Google.
  const g = decidirAudio({
    ...entrada(CURTA),
    cfg: { ...ELEVEN, audio_eleven_voz: null },
    gastoHojeReais: 0,
  });
  assert.equal(g.modo === "audio" && g.provedor, "google");
});

test("ElevenLabs recusou (429): aquele áudio sai pelo Google e o motivo fica registrado", async () => {
  const { deps, log } = falsos({
    sintetizarEleven: async () => ({
      erro: "ElevenLabs muitos pedidos seguidos ou limite do plano (429): too_many_concurrent_requests",
    }),
  });
  const r = await responderComAudio({ ...entrada(CURTA), cfg: ELEVEN }, deps);
  assert.equal(r.enviado, true);
  assert.equal(log.sinteses.length, 1, "o Google gerou o áudio");
  const uso = log.usos[0]!;
  assert.equal(uso.provedor, "google");
  assert.equal(uso.voz, "pt-BR-Chirp3-HD-Kore");
  assert.match(uso.aviso ?? "", /ElevenLabs recusou .*\(429\).*foi pelo Google/);
  assert.equal(uso.custo, custoReais(uso.caracteres, 5.5));
});

test("ElevenLabs funcionando: registra provedor, modelo e custo da ElevenLabs", async () => {
  const { deps, log } = falsos({
    sintetizarEleven: async () => ({ bytes: new Uint8Array([9, 9]) }),
  });
  const r = await responderComAudio({ ...entrada(CURTA), cfg: ELEVEN }, deps);
  assert.equal(r.enviado, true);
  assert.equal(log.sinteses.length, 0, "o Google não foi chamado");
  const uso = log.usos[0]!;
  assert.equal(uso.provedor, "elevenlabs");
  assert.equal(uso.modelo, "eleven_flash_v2_5");
  assert.equal(uso.aviso, null);
  assert.ok(uso.custo > custoReais(uso.caracteres, 5.5));
});

// ---------------------------------------------------------------- explicação em áudio e teto em créditos
const VANESSA: ConfigAudio = {
  ...CFG,
  audio_ativo: true,
  audio_provedor: "elevenlabs",
  audio_eleven_voz: "BQzELs93jJsUOf5rCb9p",
  audio_eleven_modelo: "eleven_flash_v2_5",
  audio_limite_diario_reais: 100,
  audio_limite_diario_creditos: 1000,
};
const EXPLICA =
  "Marcos, a higienização tira a sujeira de dentro das fibras, sabe? E o técnico só termina quando tirou o máximo da mancha. Ficou alguma dúvida?";

test("explicação vai em áudio mesmo com o cliente escrevendo", () => {
  const d = decidirAudio({
    cfg: VANESSA,
    ultimaDoClienteEhAudio: false,
    soTexto: false,
    ehFollowup: false,
    gastoHojeReais: 0,
    creditosHoje: 0,
    resposta: "",
    explicacao: EXPLICA,
  });
  assert.equal(d.modo, "audio");
  if (d.modo === "audio") {
    assert.equal(d.provedor, "elevenlabs");
    assert.equal(d.creditos, Math.ceil(EXPLICA.length * 0.5));
    assert.equal(d.texto, "");
  }
});

test("explicação: só texto, follow-up e mais de 700 caracteres ficam em texto", () => {
  const base = {
    cfg: VANESSA,
    ultimaDoClienteEhAudio: false,
    soTexto: false,
    ehFollowup: false,
    gastoHojeReais: 0,
    resposta: "",
  };
  assert.equal(decidirAudio({ ...base, soTexto: true, explicacao: EXPLICA }).modo, "texto");
  assert.equal(decidirAudio({ ...base, ehFollowup: true, explicacao: EXPLICA }).modo, "texto");
  assert.equal(decidirAudio({ ...base, explicacao: "a".repeat(701) }).modo, "texto");
  assert.equal(decidirAudio({ ...base, explicacao: "Oi. ".repeat(170) }).modo, "audio");
});

test("teto diário em créditos: aviso ao passar de 80% e texto ao bater o teto", () => {
  const base = {
    cfg: VANESSA,
    ultimaDoClienteEhAudio: false,
    soTexto: false,
    ehFollowup: false,
    gastoHojeReais: 0,
    resposta: "",
    explicacao: EXPLICA,
  };
  const c = Math.ceil(EXPLICA.length * 0.5);
  const a = decidirAudio({ ...base, creditosHoje: 800 - c + 1 });
  assert.ok(a.modo === "audio" && a.aviso80);
  const b = decidirAudio({ ...base, creditosHoje: 100 });
  assert.ok(b.modo === "audio" && !b.aviso80);
  const t = decidirAudio({ ...base, creditosHoje: 1000 - c + 1 });
  assert.ok(t.modo === "texto" && t.limite);
});
