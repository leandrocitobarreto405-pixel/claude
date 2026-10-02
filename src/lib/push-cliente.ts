/**
 * Notificações no celular, lado do navegador: suporte, permissão, ativar e desativar.
 * No iPhone só funciona com a Nexa instalada pela Tela de Início (iOS 16.4 ou mais novo).
 */

export function ehIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function ehAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/** Aberta pelo ícone (instalada), não pela aba do navegador. */
export function instalada(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function suportaPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function permissao(): NotificationPermission | "indisponivel" {
  return typeof window !== "undefined" && "Notification" in window
    ? Notification.permission
    : "indisponivel";
}

export function nomeDoAparelho(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  const aparelho = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Computador";
  const nav = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return [aparelho, nav].filter(Boolean).join(" · ");
}

function chaveEmBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registro(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function inscricaoAtual(): Promise<PushSubscription | null> {
  if (!suportaPush()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Pede a permissão (precisa vir de um toque) e inscreve este celular. */
export async function ativarNesteCelular(chavePublica: string) {
  // Primeiro a permissão, ainda dentro do toque (exigência do iPhone).
  const perm = await Notification.requestPermission();
  if (perm !== "granted")
    throw new Error(
      perm === "denied"
        ? "As notificações estão bloqueadas para a Nexa neste celular. Veja abaixo como liberar."
        : "Permissão não concedida.",
    );
  const reg = await registro();
  const chave = chaveEmBytes(chavePublica);
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Inscrição feita com outra chave: refaz.
    const atual = sub.options?.applicationServerKey;
    const igual =
      atual &&
      new Uint8Array(atual).length === chave.length &&
      new Uint8Array(atual).every((b, i) => b === chave[i]);
    if (!igual) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.["p256dh"] ?? "",
    auth: json.keys?.["auth"] ?? "",
  };
}

export async function desativarNesteCelular(): Promise<string | null> {
  const sub = await inscricaoAtual();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
