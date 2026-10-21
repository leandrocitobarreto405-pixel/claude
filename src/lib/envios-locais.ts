// Envios de anexo (áudio, foto, documento) com balão otimista: assim que a pessoa solta o botão
// de gravar ou escolhe o arquivo, o balão aparece na conversa como "enviando" (com player ou
// miniatura local) e vira "enviada" quando o Chatwoot confirma; se falhar, "falhou" com
// "tentar de novo". O envio começa na hora, sem esperar nada da tela, e a barra continua livre.
import { useSyncExternalStore } from "react";
import type { TipoAnexo } from "@/lib/caixa";

export type EstadoEnvio = "enviando" | "enviada" | "falhou";

export type EnvioLocal = {
  id: string;
  conversaId: string;
  tipo: TipoAnexo;
  nome: string;
  /** URL local (blob:) do arquivo, para a miniatura. */
  url: string;
  /** O arquivo em si (o player decodifica a partir dele). */
  arquivo: File;
  em: string;
  estado: EstadoEnvio;
  erro?: string | undefined;
  /** Id da mensagem no Chatwoot quando confirmada (casa com a mensagem que o servidor devolve). */
  chatwootId?: number;
  /** Segundos entre soltar o botão e a confirmação do Chatwoot. */
  segundos?: number;
  /** Tempos por etapa no servidor (para medir onde o envio demora). */
  tempos?: TemposEnvio;
};

export type TemposEnvio = {
  /** Conversão/normalização do áudio no servidor (ou 0 para foto e documento). */
  preparoMs: number;
  /** Subida ao Chatwoot até a confirmação. */
  chatwootMs: number;
  /** Registro na nossa tabela (em paralelo com a reabertura da conversa). */
  registroMs: number;
  /** Total no servidor. */
  totalMs: number;
  bytes: number;
  /** "opus-recorder" (gravado já em OGG/Opus), "ffmpeg" (convertido) ou "original". */
  via: string;
};

type Resultado = { chatwootMessageId: number; tempos?: TemposEnvio };

/** Prepara o arquivo (ex.: HEIC → JPG) e manda ao servidor. */
type Enviador = (arquivo: File) => Promise<Resultado>;

let lista: EnvioLocal[] = [];
const porConversa = new Map<string, EnvioLocal[]>();
const enviadores = new Map<
  string,
  { arquivo: File; enviar: Enviador; aoTerminar?: (() => void) | undefined }
>();
const ouvintes = new Set<() => void>();
let seq = 0;

function avisar() {
  porConversa.clear();
  for (const f of ouvintes) f();
}

function assinar(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

const VAZIA: EnvioLocal[] = [];

function daConversa(conversaId: string): EnvioLocal[] {
  let r = porConversa.get(conversaId);
  if (!r) {
    r = lista.filter((e) => e.conversaId === conversaId);
    if (!r.length) r = VAZIA;
    porConversa.set(conversaId, r);
  }
  return r;
}

export function useEnviosLocais(conversaId: string): EnvioLocal[] {
  return useSyncExternalStore(
    assinar,
    () => daConversa(conversaId),
    () => VAZIA,
  );
}

function atualizar(id: string, patch: Partial<EnvioLocal>) {
  lista = lista.map((e) => (e.id === id ? { ...e, ...patch } : e));
  avisar();
}

async function rodar(id: string) {
  const r = enviadores.get(id);
  if (!r) return;
  const inicio = performance.now();
  atualizar(id, { estado: "enviando", erro: undefined });
  try {
    const res = await r.enviar(r.arquivo);
    const segundos = Math.round((performance.now() - inicio) / 100) / 10;
    atualizar(id, {
      estado: "enviada",
      chatwootId: res.chatwootMessageId,
      segundos,
      ...(res.tempos ? { tempos: res.tempos } : {}),
    });
    if (res.tempos)
      console.info("[caixa] anexo enviado", {
        tipo: lista.find((e) => e.id === id)?.tipo,
        totalNoAparelhoMs: Math.round(performance.now() - inicio),
        ...res.tempos,
      });
  } catch (e) {
    atualizar(id, {
      estado: "falhou",
      erro: e instanceof Error ? e.message : "Não foi possível enviar.",
    });
  } finally {
    r.aoTerminar?.();
  }
}

/** Cria o balão e começa o envio imediatamente. Devolve o id local. */
export function iniciarEnvio(dados: {
  conversaId: string;
  tipo: TipoAnexo;
  arquivo: File;
  enviar: Enviador;
  aoTerminar?: (() => void) | undefined;
}): string {
  const id = `local-${Date.now()}-${++seq}`;
  lista = [
    ...lista,
    {
      id,
      conversaId: dados.conversaId,
      tipo: dados.tipo,
      nome: dados.arquivo.name,
      url: URL.createObjectURL(dados.arquivo),
      arquivo: dados.arquivo,
      em: new Date().toISOString(),
      estado: "enviando",
    },
  ];
  enviadores.set(id, {
    arquivo: dados.arquivo,
    enviar: dados.enviar,
    aoTerminar: dados.aoTerminar,
  });
  avisar();
  void rodar(id);
  return id;
}

export function tentarDeNovo(id: string) {
  void rodar(id);
}

/** Tira o balão (após falha) e libera a URL local. */
export function descartarEnvio(id: string) {
  const e = lista.find((x) => x.id === id);
  if (e) URL.revokeObjectURL(e.url);
  lista = lista.filter((x) => x.id !== id);
  enviadores.delete(id);
  avisar();
}

/**
 * Separa os envios locais entre os que já aparecem na lista do servidor (pelo id do Chatwoot:
 * a mídia local vai dentro daquele balão) e os que ainda não (balões próprios no fim).
 */
export function casarEnvios(
  locais: EnvioLocal[],
  idsNoServidor: Iterable<number | null | undefined>,
): { porChatwootId: Map<number, EnvioLocal>; soltos: EnvioLocal[] } {
  const ids = new Set<number>();
  for (const id of idsNoServidor) if (id != null) ids.add(id);
  const porChatwootId = new Map<number, EnvioLocal>();
  const soltos: EnvioLocal[] = [];
  for (const e of locais) {
    if (e.chatwootId != null && ids.has(e.chatwootId)) porChatwootId.set(e.chatwootId, e);
    else soltos.push(e);
  }
  return { porChatwootId, soltos };
}
