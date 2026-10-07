import { test } from "node:test";
import assert from "node:assert/strict";
import { comCors } from "./server";

test("chamada de outra origem: o app consegue ler que a resposta vem serializada", async () => {
  const r = comCors(
    new Response('{"t":10}', { status: 200, headers: { "x-tss-serialized": "true" } }),
    "https://app.nexaperformanceos.com.br",
  );
  assert.equal(
    r.headers.get("Access-Control-Allow-Origin"),
    "https://app.nexaperformanceos.com.br",
  );
  const expostos = (r.headers.get("Access-Control-Expose-Headers") ?? "").split(/,\s*/);
  assert.ok(expostos.includes("x-tss-serialized"));
  assert.ok(expostos.includes("x-tss-raw"));
  assert.equal(r.headers.get("x-tss-serialized"), "true");
  assert.equal(await r.text(), '{"t":10}');
});
