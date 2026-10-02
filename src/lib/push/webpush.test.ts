import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createHmac, verify, createPublicKey } from "node:crypto";
import { autorizacaoVapid, chavesVapid, cifrar, endpointPermitido } from "./webpush.server";

const d = (s: string) => Buffer.from(s, "base64url");

test("criptografia igual ao exemplo da RFC 8291", () => {
  const corpo = cifrar(
    d("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    "BTBZMqHH6r4Tts7J_aSIgg",
    {
      sal: d("DGv6ra1nlYgDCS1FRnbzlw"),
      asPrivada: d("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    },
  );
  const cabecalho = d(
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  );
  const cifrado = d(
    "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  );
  assert.equal(cabecalho.length, 86);
  assert.ok(corpo.equals(Buffer.concat([cabecalho, cifrado])));
});

test("celular consegue abrir a mensagem (ida e volta)", () => {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  const msg = Buffer.from(JSON.stringify({ titulo: "Teste", corpo: "Olá", url: "/avisos" }));
  const c = cifrar(msg, ua.getPublicKey().toString("base64url"), auth.toString("base64url"));
  // Lado do celular (RFC 8291).
  const sal = c.subarray(0, 16);
  const asPub = c.subarray(21, 86);
  const dados = c.subarray(86);
  const h = (k: Buffer, v: Buffer) => createHmac("sha256", k).update(v).digest();
  const ikm = h(
    h(auth, ua.computeSecret(asPub)),
    Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub, Buffer.from([1])]),
  );
  const prk = h(sal, ikm);
  const cek = h(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = h(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const dec = createDecipheriv("aes-128-gcm", cek, nonce);
  dec.setAuthTag(dados.subarray(dados.length - 16));
  const claro = Buffer.concat([dec.update(dados.subarray(0, dados.length - 16)), dec.final()]);
  assert.equal(claro[claro.length - 1], 2);
  assert.deepEqual(JSON.parse(claro.subarray(0, -1).toString()), {
    titulo: "Teste",
    corpo: "Olá",
    url: "/avisos",
  });
});

test("VAPID: mesma chave para o mesmo segredo e assinatura válida", () => {
  const a = chavesVapid("segredo-de-teste-com-mais-de-16");
  const b = chavesVapid("segredo-de-teste-com-mais-de-16");
  assert.equal(a.publica, b.publica);
  assert.notEqual(a.publica, chavesVapid("outro-segredo-com-mais-de-16").publica);
  assert.equal(d(a.publica).length, 65);
  const h = autorizacaoVapid("https://web.push.apple.com/abc", a, 1_700_000_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
  const dados = JSON.parse(d(m[2]!).toString());
  assert.equal(dados.aud, "https://web.push.apple.com");
  assert.equal(dados.exp, 1_700_000_000 + 12 * 3600);
  const pub = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: d(m[4]!).subarray(1, 33).toString("base64url"),
      y: d(m[4]!).subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${m[1]}.${m[2]}`),
      { key: pub, dsaEncoding: "ieee-p1363" },
      d(m[3]!),
    ),
  );
});

test("só serviços de push conhecidos", () => {
  assert.ok(endpointPermitido("https://web.push.apple.com/QK2x"));
  assert.ok(endpointPermitido("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(endpointPermitido("https://updates.push.services.mozilla.com/wpush/v2/x"));
  assert.equal(endpointPermitido("http://fcm.googleapis.com/x"), false);
  assert.equal(endpointPermitido("https://meusite.com/push"), false);
  assert.equal(endpointPermitido("https://googleapis.com.evil.com/x"), false);
});
