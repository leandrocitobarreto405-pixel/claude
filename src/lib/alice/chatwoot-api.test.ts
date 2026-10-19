// Anexo de áudio como mensagem de voz: o Chatwoot só manda "voice": true ao WhatsApp quando recebe
// is_voice_message no envio. Sem rede: fetch falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enviarAnexo } from "./chatwoot-api.server";

async function campos(vozGravada: boolean) {
  const original = globalThis.fetch;
  let form: FormData | null = null;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    form = init.body as FormData;
    return new Response(JSON.stringify({ id: 1 }), { status: 200 });
  }) as typeof fetch;
  try {
    await enviarAnexo(
      { baseUrl: "https://chatwoot.exemplo", accountId: 1 },
      "token-ficticio",
      10,
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
      "audio.ogg",
      "",
      vozGravada,
    );
  } finally {
    globalThis.fetch = original;
  }
  return form!;
}

test("áudio da Alice vai marcado como mensagem de voz", async () => {
  const f = await campos(true);
  assert.equal(f.get("is_voice_message"), "true");
  const arquivo = f.get("attachments[]") as File;
  assert.equal(arquivo.type, "audio/ogg");
  assert.equal(arquivo.name, "audio.ogg");
});

test("vídeo e áudio padrão continuam sem a marca", async () => {
  const f = await campos(false);
  assert.equal(f.get("is_voice_message"), null);
});
