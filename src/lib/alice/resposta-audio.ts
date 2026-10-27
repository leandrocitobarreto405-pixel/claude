/**
 * Envio da resposta com áudio: gera a fala (Google, ou ElevenLabs quando a empresa escolheu),
 * manda o .ogg pelo Chatwoot, deixa a nota privada com o texto falado e registra o uso. Se a
 * ElevenLabs recusar (ex.: 429, muitos pedidos seguidos), aquele áudio sai pelo Google e o motivo
 * fica registrado. Qualquer outra falha devolve "não enviado" para o motor mandar o texto na hora.
 * As dependências vêm de fora (testes).
 */
import {
  custoReais,
  decidirAudio,
  segundosEstimados,
  type ConfigAudio,
  type Decisao,
  type ModeloEleven,
  type Provedor,
} from "./voz";

export type UsoAudio = {
  situacao: "enviado" | "falhou";
  provedor: Provedor;
  modelo: ModeloEleven | null;
  /** Ex.: a ElevenLabs recusou e o áudio saiu pelo Google. */
  aviso: string | null;
  voz: string;
  caracteres: number;
  segundos: number | null;
  custo: number;
  /** Créditos da ElevenLabs (0 quando saiu pelo Google). */
  creditos: number;
  texto: string;
  chatwootMessageId: number | null;
  erro: string | null;
};

export type DepsAudio = {
  gastoHoje: () => Promise<number>;
  /** Créditos da ElevenLabs já usados hoje pela empresa (teto diário em créditos). */
  creditosHoje?: () => Promise<number>;
  sintetizar: (texto: string, voz: string) => Promise<{ bytes: Uint8Array } | { erro: string }>;
  sintetizarEleven?: (
    texto: string,
    voz: string,
    modelo: ModeloEleven,
  ) => Promise<{ bytes: Uint8Array } | { erro: string }>;
  duracao: (bytes: Uint8Array) => number | null;
  enviarAudio: (bytes: Uint8Array) => Promise<{ id: number }>;
  enviarNota: (texto: string) => Promise<void>;
  registrar: (uso: UsoAudio) => Promise<void>;
  /** Aviso só no app (sininho), uma vez por dia. */
  avisarLimite: () => Promise<void>;
  /** Aviso só no app quando o dia passa de 80% do teto em créditos (uma vez por dia). */
  avisar80?: () => Promise<void>;
};

export type ResultadoAudio =
  | { enviado: false; decisao: Decisao; erro?: string }
  /** texto: parte escrita que ainda precisa sair (depois do áudio). */
  | { enviado: true; texto: string; decisao: Decisao };

export async function responderComAudio(
  e: {
    cfg: ConfigAudio;
    ultimaDoClienteEhAudio: boolean;
    soTexto: boolean;
    ehFollowup: boolean;
    resposta: string;
    /** Texto escrito para falar (enviar_audio): vai em áudio mesmo com o cliente escrevendo. */
    explicacao?: string | undefined;
  },
  deps: DepsAudio,
): Promise<ResultadoAudio> {
  // Barato primeiro: sem áudio ligado ou cliente escrevendo, nem consulta o gasto do dia.
  const previa = decidirAudio({ ...e, gastoHojeReais: 0 });
  if (previa.modo === "texto") return { enviado: false, decisao: previa };

  const [gastoHojeReais, creditosHoje] = await Promise.all([
    deps.gastoHoje(),
    deps.creditosHoje ? deps.creditosHoje() : Promise.resolve(0),
  ]);
  const decisao = decidirAudio({ ...e, gastoHojeReais, creditosHoje });
  if (decisao.modo === "texto") {
    if (decisao.limite) await deps.avisarLimite().catch(() => undefined);
    return { enviado: false, decisao };
  }

  // Provedor, voz e custo de fato (mudam se a ElevenLabs recusar e o Google assumir).
  let provedor: Provedor = decisao.provedor;
  let voz = decisao.voz;
  let custoFeito = decisao.custo;
  let creditosFeitos = decisao.creditos;
  let aviso: string | null = null;

  const falhou = async (erro: string, custo: number, segundos: number | null) => {
    console.warn("Alice: áudio não enviado, vai em texto:", erro);
    await deps
      .registrar({
        situacao: "falhou",
        provedor,
        modelo: provedor === "elevenlabs" ? decisao.modelo : null,
        aviso,
        voz,
        caracteres: decisao.caracteres,
        segundos,
        custo,
        creditos: custo ? creditosFeitos : 0,
        texto: decisao.fala,
        chatwootMessageId: null,
        erro: erro.slice(0, 500),
      })
      .catch(() => undefined);
    return { enviado: false as const, decisao, erro };
  };

  let sintese: { bytes: Uint8Array } | { erro: string };
  if (decisao.provedor === "elevenlabs" && decisao.modelo && deps.sintetizarEleven) {
    sintese = await deps.sintetizarEleven(decisao.fala, decisao.voz, decisao.modelo);
    if ("erro" in sintese && decisao.vozReserva) {
      aviso = `ElevenLabs recusou (${sintese.erro.slice(0, 160)}); foi pelo Google`;
      console.warn("Alice:", aviso);
      provedor = "google";
      voz = decisao.vozReserva;
      custoFeito = custoReais(decisao.caracteres, Number(e.cfg.audio_cotacao_dolar));
      creditosFeitos = 0;
      sintese = await deps.sintetizar(decisao.fala, voz);
    }
  } else {
    provedor = "google";
    sintese = await deps.sintetizar(decisao.fala, voz);
  }
  if ("erro" in sintese) return falhou(sintese.erro, 0, null);
  const segundos = deps.duracao(sintese.bytes) ?? segundosEstimados(decisao.caracteres);

  let id: number;
  try {
    id = (await deps.enviarAudio(sintese.bytes)).id;
  } catch (err) {
    // O provedor cobrou a síntese mesmo sem o envio.
    return falhou(
      `envio pelo Chatwoot: ${err instanceof Error ? err.message : String(err)}`,
      custoFeito,
      segundos,
    );
  }
  await deps.enviarNota(`🔊 Áudio da Alice: ${decisao.fala}`).catch(() => undefined);
  await deps
    .registrar({
      situacao: "enviado",
      provedor,
      modelo: provedor === "elevenlabs" ? decisao.modelo : null,
      aviso,
      voz,
      caracteres: decisao.caracteres,
      segundos,
      custo: custoFeito,
      creditos: creditosFeitos,
      texto: decisao.fala,
      chatwootMessageId: id ?? null,
      erro: null,
    })
    .catch((err) => console.error("Alice: uso do áudio não registrado", err));
  if (decisao.aviso80 && creditosFeitos && deps.avisar80)
    await deps.avisar80().catch(() => undefined);
  return { enviado: true, texto: decisao.texto, decisao };
}
