/**
 * Cadastro Incorporado (Embedded Signup) do app "Nexa OS" na Meta, lado do navegador.
 * O SDK JavaScript da Meta abre a janela; ao terminar, a Meta manda um postMessage com o waba_id e o
 * phone_number_id, e o FB.login devolve um "code". O app manda os três para a Edge Function
 * nexa-meta-cadastro, que troca o code pelo token no servidor (o token nunca passa pelo navegador).
 */

export type ResultadoCadastro =
  | { tipo: "concluido"; wabaId: string; phoneNumberId: string }
  | { tipo: "so_waba"; wabaId: string }
  | { tipo: "cancelado"; etapa: string | null }
  | { tipo: "erro"; mensagem: string };

const ORIGEM_META = /^https:\/\/([a-z0-9-]+\.)*facebook\.com$/;

/**
 * Lê o postMessage do Cadastro Incorporado. Devolve null para mensagens que não são dele (outras
 * janelas, outras origens). Aceita o dado em texto JSON ou já como objeto.
 */
export function lerMensagemCadastro(origem: string, dado: unknown): ResultadoCadastro | null {
  if (!ORIGEM_META.test(origem)) return null;
  let m: unknown = dado;
  if (typeof dado === "string") {
    try {
      m = JSON.parse(dado);
    } catch {
      return null;
    }
  }
  const msg = m as { type?: string; event?: string; data?: Record<string, unknown> } | null;
  if (!msg || msg.type !== "WA_EMBEDDED_SIGNUP") return null;
  const d = msg.data ?? {};
  const id = (v: unknown) => (typeof v === "string" && /^[0-9]{5,25}$/.test(v) ? v : null);
  const waba = id(d["waba_id"]);
  const phone = id(d["phone_number_id"]);
  switch (msg.event) {
    case "FINISH":
    case "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING":
      return waba && phone
        ? { tipo: "concluido", wabaId: waba, phoneNumberId: phone }
        : { tipo: "erro", mensagem: "A Meta não devolveu o número conectado." };
    case "FINISH_ONLY_WABA":
      return waba
        ? { tipo: "so_waba", wabaId: waba }
        : { tipo: "erro", mensagem: "Conta sem número." };
    case "CANCEL":
      return { tipo: "cancelado", etapa: (d["current_step"] as string | undefined) ?? null };
    case "ERROR":
      return {
        tipo: "erro",
        mensagem: String(d["error_message"] ?? "Erro no cadastro da Meta.").slice(0, 300),
      };
    default:
      return null;
  }
}

type FB = {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void,
    o: Record<string, unknown>,
  ): void;
};

declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

let carregando: Promise<FB> | null = null;

/** Carrega o SDK JavaScript da Meta uma vez (só nesta tela). */
export function carregarSdkMeta(appId: string, versao: string): Promise<FB> {
  if (carregando) return carregando;
  carregando = new Promise<FB>((ok, falha) => {
    if (window.FB) {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: versao });
      return ok(window.FB);
    }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: versao });
      ok(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => {
      carregando = null;
      falha(new Error("Não foi possível carregar o SDK da Meta."));
    };
    document.body.appendChild(s);
  });
  return carregando;
}

/** Abre o Cadastro Incorporado. Resolve com o code (ou null se a pessoa fechou a janela). */
export function abrirCadastro(fb: FB, configId: string): Promise<string | null> {
  return new Promise((ok) => {
    fb.login((r) => ok(r.authResponse?.code ?? null), {
      config_id: configId,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "", sessionInfoVersion: "3", version: "v3" },
    });
  });
}

export const ROTULO_SITUACAO: Record<string, string> = {
  liberado: "Não conectado",
  pendente: "Pendente",
  conectado: "Conectado",
  erro: "Erro",
  desautorizado: "Desautorizado",
};
