/**
 * Web Push (notificação no celular) sem biblioteca externa: assinatura VAPID (RFC 8292) e
 * criptografia da mensagem aes128gcm (RFC 8291), com o crypto do Node. Só servidor.
 *
 * A chave VAPID é derivada de um segredo que o servidor já tem (NEXA_TAREFAS_SEGREDO): não precisa
 * configurar nada novo no Google Cloud. Se esse segredo mudar, cada celular precisa ativar de novo.
 */
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const deB64u = (s: string) => Buffer.from(s, "base64url");

// Ordem do grupo P-256: a chave privada precisa ficar entre 1 e n-1.
const ORDEM_P256 = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

export type ChavesVapid = { publica: string; privada: KeyObject };

function chaveDoEscalar(d: Buffer): ChavesVapid {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // 65 bytes, 0x04 || x || y
  const privada = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64u(d),
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  return { publica: b64u(pub), privada };
}

/** Chaves VAPID derivadas do segredo (sempre as mesmas para o mesmo segredo). */
export function chavesVapid(segredo: string): ChavesVapid {
  if (!segredo || segredo.length < 16)
    throw new Error("segredo do servidor ausente para as notificações");
  for (let i = 0; i < 10; i++) {
    const d = createHmac("sha256", segredo).update(`nexa-web-push-vapid-v1:${i}`).digest();
    const n = BigInt(`0x${d.toString("hex")}`);
    if (n > 0n && n < ORDEM_P256) return chaveDoEscalar(d);
  }
  throw new Error("não foi possível derivar a chave das notificações");
}

let cache: { segredo: string; chaves: ChavesVapid } | null = null;
export function chavesDoServidor(): ChavesVapid {
  const segredo = process.env["NEXA_TAREFAS_SEGREDO"] ?? "";
  if (cache?.segredo !== segredo) cache = { segredo, chaves: chavesVapid(segredo) };
  return cache.chaves;
}

const hmac = (chave: Buffer, dados: Buffer) => createHmac("sha256", chave).update(dados).digest();

/**
 * Criptografa o conteúdo para um celular (RFC 8291, um registro só). `fixo` só para o teste com
 * os valores do exemplo da RFC.
 */
export function cifrar(
  conteudo: Buffer,
  uaPublica: string,
  auth: string,
  fixo?: { sal: Buffer; asPrivada: Buffer },
): Buffer {
  const ua = deB64u(uaPublica);
  const segredoAuth = deB64u(auth);
  if (ua.length !== 65 || segredoAuth.length < 16) throw new Error("inscrição inválida");
  const as = createECDH("prime256v1");
  if (fixo) as.setPrivateKey(fixo.asPrivada);
  else as.generateKeys();
  const asPublica = as.getPublicKey();
  const compartilhado = as.computeSecret(ua);
  const prkChave = hmac(segredoAuth, compartilhado);
  const infoChave = Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPublica]);
  const ikm = hmac(prkChave, Buffer.concat([infoChave, Buffer.from([1])]));
  const sal = fixo?.sal ?? randomBytes(16);
  const prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const cifra = createCipheriv("aes-128-gcm", cek, nonce);
  const corpo = Buffer.concat([
    cifra.update(Buffer.concat([conteudo, Buffer.from([2])])),
    cifra.final(),
    cifra.getAuthTag(),
  ]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([asPublica.length]), asPublica, corpo]);
}

/** Cabeçalho Authorization VAPID para o serviço de push do celular. */
export function autorizacaoVapid(endpoint: string, chaves: ChavesVapid, agora = Date.now()) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const dados = b64u(
    Buffer.from(
      JSON.stringify({
        aud,
        exp: Math.floor(agora / 1000) + 12 * 3600,
        sub: "mailto:contato@nexaos.com.br",
      }),
    ),
  );
  const assinatura = sign("sha256", Buffer.from(`${cab}.${dados}`), {
    key: chaves.privada,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${cab}.${dados}.${b64u(assinatura)}, k=${chaves.publica}`;
}

export type Inscricao = { endpoint: string; p256dh: string; auth: string };
export type Notificacao = { titulo: string; corpo: string; url: string; tag?: string };

/** Endereços dos serviços de push conhecidos (Apple, Google, Mozilla, Microsoft). */
export function endpointPermitido(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    // Só no teste ponta a ponta: serviço de push falso na máquina local.
    if (process.env["MKT_TESTE"] === "1" && u.origin === "http://127.0.0.1:3994") return true;
    if (u.protocol !== "https:") return false;
    return /(^|\.)(push\.apple\.com|googleapis\.com|mozilla\.com|notify\.windows\.com|mozaws\.net)$/.test(
      u.hostname,
    );
  } catch {
    return false;
  }
}

/** Envia uma notificação. `expirada`: o celular cancelou (apagar a inscrição). */
export async function enviarPush(
  insc: Inscricao,
  n: Notificacao,
  chaves = chavesDoServidor(),
): Promise<{ ok: boolean; status: number; expirada: boolean }> {
  const corpo = cifrar(Buffer.from(JSON.stringify(n)), insc.p256dh, insc.auth);
  const r = await fetch(insc.endpoint, {
    method: "POST",
    headers: {
      Authorization: autorizacaoVapid(insc.endpoint, chaves),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body: new Uint8Array(corpo),
    signal: AbortSignal.timeout(15_000),
  });
  await r.arrayBuffer().catch(() => null);
  return { ok: r.ok, status: r.status, expirada: r.status === 404 || r.status === 410 };
}
