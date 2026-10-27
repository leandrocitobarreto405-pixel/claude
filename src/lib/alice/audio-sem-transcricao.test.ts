import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXTO_AUDIO_SEM_TRANSCRICAO, ultimaEhAudioSemTranscricao } from "./regras";

test("áudio do cliente sem transcrição por último: a Alice responde o texto padrão", () => {
  assert.equal(
    ultimaEhAudioSemTranscricao([
      { direcao: "Enviada", tipo: "Texto" },
      { direcao: "Recebida", tipo: "Áudio", transcricao: null },
    ]),
    true,
  );
  // Com transcrição: responde normalmente.
  assert.equal(
    ultimaEhAudioSemTranscricao([
      { direcao: "Recebida", tipo: "Áudio", transcricao: "quero orçamento" },
    ]),
    false,
  );
  // A última do cliente é texto (o áudio ficou para trás).
  assert.equal(
    ultimaEhAudioSemTranscricao([
      { direcao: "Recebida", tipo: "Áudio", transcricao: null },
      { direcao: "Recebida", tipo: "Texto" },
      { direcao: "Enviada", tipo: "Texto" },
    ]),
    false,
  );
  assert.match(TEXTO_AUDIO_SEM_TRANSCRICAO, /por escrito/);
});
