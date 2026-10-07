/**
 * Fila de fotos e vídeos da OS no celular. Cada arquivo vai direto ao Google Drive (pasta da OS),
 * em pedaços de 8 MB, sem passar pelo servidor: o servidor só abre o envio e, no fim, registra o
 * arquivo na OS. A fila continua enquanto o app estiver aberto (fechar a conclusão não para o
 * envio). Se a internet cai, tenta de novo sozinha e continua de onde parou; depois de 3
 * tentativas, fica o motivo e o botão "Tentar de novo".
 */
import { PEDACO_ENVIO, motivoDoDrive, tamanhoLegivel, validarMidia } from "@/lib/midia-os";

export type DestinoMidia = "Antes" | "Depois" | "Vídeos" | "Controle interno";
export type EstadoEnvio = "na_fila" | "enviando" | "registrando" | "pronto" | "erro";

export type Envio = {
  id: string;
  workOrderId: string;
  destino: DestinoMidia;
  nome: string;
  tamanho: number;
  tipo: string;
  enviados: number;
  estado: EstadoEnvio;
  motivo: string | null;
  arquivo: File;
  sessao: string | null;
};

export type RespostaPedaco = { status: number; corpo: string };

/** O que a fila usa de fora (servidor, Google e navegador); trocado nos testes. */
export type Dependencias = {
  abrir: (e: Envio) => Promise<string>;
  situacao: (
    sessao: string,
    tamanho: number,
  ) => Promise<{ recebidos: number; fileId: string | null }>;
  registrar: (e: Envio, fileId: string) => Promise<void>;
  /** Envio pelo servidor (até 20 MB), se o envio direto ao Google não funcionar. */
  reserva: (e: Envio) => Promise<void>;
  pedaco: (
    sessao: string,
    parte: Blob,
    inicio: number,
    total: number,
    progresso: (bytes: number) => void,
  ) => Promise<RespostaPedaco>;
  online: () => boolean;
  esperar: (ms: number) => Promise<void>;
  guardar: (chave: string, sessao: string | null) => void;
  lembrar: (chave: string) => string | null;
};

export class ErroConexao extends Error {}
class ErroEnvio extends Error {
  constructor(
    message: string,
    readonly recomecar = false,
  ) {
    super(message);
  }
}

/** Um pedaço do arquivo para o endereço do envio no Google (com o progresso do pedaço). */
export const pedacoPorXhr: Dependencias["pedaco"] = (sessao, parte, inicio, total, progresso) =>
  new Promise((ok, falha) => {
    const x = new XMLHttpRequest();
    x.open("PUT", sessao);
    x.setRequestHeader("Content-Range", `bytes ${inicio}-${inicio + parte.size - 1}/${total}`);
    x.timeout = 180_000;
    x.upload.onprogress = (ev) => progresso(ev.loaded);
    x.onload = () => ok({ status: x.status, corpo: x.responseText });
    x.onerror = () => falha(new ErroConexao("rede"));
    x.ontimeout = () => falha(new ErroConexao("tempo"));
    x.send(parte);
  });

const LIMITE_RESERVA = 20 * 1024 * 1024;
const ESPERAS = [2000, 5000, 10000];

/** Identidade do arquivo para continuar um envio depois de recarregar a página. */
export function chaveDoArquivo(workOrderId: string, destino: string, f: File) {
  return `nexa-envio|${workOrderId}|${destino}|${f.name}|${f.size}|${f.lastModified}`;
}

export function criarFila(deps: Dependencias) {
  let envios: Envio[] = [];
  const ouvintes = new Set<() => void>();
  let rodando = false;
  let seq = 0;

  const avisar = () => {
    envios = [...envios];
    for (const o of ouvintes) o();
  };
  const mudar = (e: Envio, m: Partial<Envio>) => {
    Object.assign(e, m);
    const i = envios.findIndex((x) => x.id === e.id);
    if (i >= 0) envios[i] = { ...e };
    avisar();
  };

  async function enviarDireto(e: Envio) {
    const chave = chaveDoArquivo(e.workOrderId, e.destino, e.arquivo);
    if (!e.sessao) {
      const lembrada = deps.lembrar(chave);
      if (lembrada) e.sessao = lembrada;
    }
    if (e.sessao) {
      // Continua de onde o Google parou (internet caiu ou página recarregada).
      try {
        const s = await deps.situacao(e.sessao, e.tamanho);
        if (s.fileId) return s.fileId;
        mudar(e, { enviados: s.recebidos });
      } catch (err) {
        if (err instanceof ErroConexao) throw err;
        deps.guardar(chave, null);
        mudar(e, { sessao: null, enviados: 0 });
      }
    }
    if (!e.sessao) {
      mudar(e, { sessao: await deps.abrir(e), enviados: 0 });
      deps.guardar(chave, e.sessao);
    }
    while (e.enviados < e.tamanho) {
      const inicio = e.enviados;
      const fim = Math.min(inicio + PEDACO_ENVIO, e.tamanho);
      const r = await deps.pedaco(e.sessao!, e.arquivo.slice(inicio, fim), inicio, e.tamanho, (b) =>
        mudar(e, { enviados: Math.min(inicio + b, fim) }),
      );
      if (r.status === 200 || r.status === 201) {
        deps.guardar(chave, null);
        const id = (JSON.parse(r.corpo || "{}") as { id?: string }).id;
        if (!id) throw new ErroEnvio("O Google Drive não devolveu o arquivo. Tente de novo.");
        return id;
      }
      if (r.status === 308) {
        mudar(e, { enviados: fim });
        if (fim >= e.tamanho) {
          const s = await deps.situacao(e.sessao!, e.tamanho);
          if (s.fileId) return s.fileId;
          mudar(e, { enviados: s.recebidos });
        }
        continue;
      }
      if (r.status === 404 || r.status === 410) {
        deps.guardar(chave, null);
        mudar(e, { sessao: null, enviados: 0 });
        throw new ErroEnvio(motivoDoDrive(404), true);
      }
      throw new ErroEnvio(motivoDoDrive(r.status, r.corpo));
    }
    const s = await deps.situacao(e.sessao!, e.tamanho);
    if (s.fileId) return s.fileId;
    throw new ErroEnvio("O envio não terminou no Google Drive. Tente de novo.");
  }

  async function processar(e: Envio) {
    mudar(e, { estado: "enviando", motivo: null });
    for (let tentativa = 0; ; tentativa++) {
      try {
        const fileId = await enviarDireto(e);
        mudar(e, { estado: "registrando", enviados: e.tamanho });
        await deps.registrar(e, fileId);
        mudar(e, { estado: "pronto", motivo: null });
        return;
      } catch (err) {
        if (err instanceof ErroConexao) {
          // Nada chegou ao Google e o aparelho tem internet: o envio direto foi recusado.
          // Arquivo pequeno vai pelo servidor, como antes.
          if (e.enviados === 0 && deps.online() && e.tamanho <= LIMITE_RESERVA && tentativa >= 1) {
            try {
              await deps.reserva(e);
              mudar(e, { estado: "pronto", motivo: null, enviados: e.tamanho });
            } catch (x) {
              mudar(e, { estado: "erro", motivo: x instanceof Error ? x.message : String(x) });
            }
            return;
          }
          if (tentativa < ESPERAS.length) {
            await deps.esperar(ESPERAS[tentativa]!);
            continue;
          }
          const pct = Math.floor((e.enviados / e.tamanho) * 100);
          mudar(e, {
            estado: "erro",
            motivo: deps.online()
              ? `A conexão caiu durante o envio (${pct}% enviado). Toque em "Tentar de novo" para continuar de onde parou.`
              : `Sem internet (${pct}% enviado). Quando a internet voltar, toque em "Tentar de novo".`,
          });
          return;
        }
        if (err instanceof ErroEnvio && err.recomecar && tentativa === 0) continue;
        mudar(e, {
          estado: "erro",
          motivo: err instanceof Error && err.message ? err.message : "Não foi possível enviar.",
        });
        return;
      }
    }
  }

  async function rodar() {
    if (rodando) return;
    rodando = true;
    try {
      for (;;) {
        const proximo = envios.find((e) => e.estado === "na_fila");
        if (!proximo) break;
        await processar(proximo);
      }
    } finally {
      rodando = false;
    }
  }

  return {
    lista: () => envios,
    ouvir(fn: () => void) {
      ouvintes.add(fn);
      return () => void ouvintes.delete(fn);
    },
    /** Põe os arquivos na fila. Arquivo com formato ou tamanho fora do aceito já fica com o motivo. */
    adicionar(workOrderId: string, destino: DestinoMidia, arquivos: File[]) {
      for (const f of arquivos) {
        const v = validarMidia(f.name, f.type, f.size);
        envios.push({
          id: `envio-${++seq}`,
          workOrderId,
          destino,
          nome: f.name,
          tamanho: f.size,
          tipo: v.ok ? v.tipo : f.type,
          enviados: 0,
          estado: v.ok ? "na_fila" : "erro",
          motivo: v.ok ? null : v.motivo,
          arquivo: f,
          sessao: null,
        });
      }
      avisar();
      void rodar();
    },
    tentarDeNovo(id: string) {
      const e = envios.find((x) => x.id === id);
      if (!e || e.estado !== "erro") return;
      if (!validarMidia(e.nome, e.tipo, e.tamanho).ok) return;
      mudar(e, { estado: "na_fila", motivo: null });
      void rodar();
    },
    remover(id: string) {
      envios = envios.filter(
        (x) => x.id !== id || x.estado === "enviando" || x.estado === "registrando",
      );
      avisar();
    },
    /** Tira da lista os que já terminaram. */
    limparProntos(workOrderId?: string) {
      envios = envios.filter(
        (x) =>
          x.estado !== "pronto" || (workOrderId !== undefined && x.workOrderId !== workOrderId),
      );
      avisar();
    },
    emAndamento: () =>
      envios.some(
        (e) => e.estado === "na_fila" || e.estado === "enviando" || e.estado === "registrando",
      ),
    rodar,
  };
}

export type Fila = ReturnType<typeof criarFila>;

/** Texto curto do estado de um envio para a tela. */
export function textoDoEnvio(e: Envio): string {
  const pct = e.tamanho ? Math.floor((e.enviados / e.tamanho) * 100) : 0;
  if (e.estado === "na_fila") return "Na fila";
  if (e.estado === "enviando")
    return `Enviando ${pct}% (${tamanhoLegivel(e.enviados || 1)} de ${tamanhoLegivel(e.tamanho)})`;
  if (e.estado === "registrando") return "Finalizando…";
  if (e.estado === "pronto") return "Enviado";
  return e.motivo ?? "Não foi possível enviar.";
}
