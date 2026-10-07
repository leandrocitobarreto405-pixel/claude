/**
 * Qualidade do número na Meta antes de disparar (campanha, promoção e lembretes saem do mesmo
 * número que recebe os leads). Saiu do verde (amarelo ou vermelho): pausa tudo o que está para
 * sair e avisa a equipe. Conferida no máximo a cada 15 minutos por empresa. Sem conexão com a
 * Meta configurada, ou se a Meta não responder, não bloqueia (a trava de opt-out continua).
 */
import { avisar } from "./campanhas.server";
import { log, rpc, type Db } from "./contexto.server";

const INTERVALO_MS = 15 * 60_000;
const cache = new Map<string, { em: number; ruim: string | null }>();

/** Primeiro número fora do verde ("+55 11 ... : YELLOW"), ou null se todos verdes. */
export function numeroForaDoVerde(
  numeros: Array<{ display_phone_number?: string; quality_rating?: string }>,
): string | null {
  const ruim = numeros.find((n) =>
    ["YELLOW", "RED"].includes(String(n.quality_rating).toUpperCase()),
  );
  return ruim
    ? `${ruim.display_phone_number ?? "número"} está ${nomeQualidade(ruim.quality_rating)}`
    : null;
}

function nomeQualidade(q: string | undefined) {
  const v = String(q ?? "").toUpperCase();
  return v === "RED" ? "com qualidade vermelha (baixa)" : "com qualidade amarela (média)";
}

/** null = pode disparar. Texto = motivo para não disparar (qualidade fora do verde). */
export async function qualidadeImpede(db: Db, empresaId: string, agora = Date.now()) {
  const guardado = cache.get(empresaId);
  if (guardado && agora - guardado.em < INTERVALO_MS) return guardado.ruim;
  let ruim: string | null = null;
  try {
    const { conexaoDaEmpresa } = await import("@/lib/meta/modelos.server");
    const cx = await conexaoDaEmpresa(db as never, empresaId);
    if (cx) {
      const { numerosDaConta } = await import("@/lib/meta/graph.server");
      ruim = numeroForaDoVerde(await numerosDaConta(cx));
    }
  } catch (e) {
    log("WARNING", "qualidade.falha", {
      empresa: empresaId,
      erro: e instanceof Error ? e.message : String(e),
    });
  }
  cache.set(empresaId, { em: agora, ruim });
  return ruim;
}

/** Pausa todas as campanhas da empresa com algo para sair e avisa (uma vez por dia). */
export async function pausarPorQualidade(db: Db, empresaId: string, motivo: string) {
  const { data: lotes } = await db
    .from("mkt_lotes")
    .select("campanha_id")
    .eq("empresa_id", empresaId)
    .in("status", ["aprovado", "enviando"]);
  const campanhas = [...new Set((lotes ?? []).map((l) => l.campanha_id as string))];
  for (const id of campanhas)
    await rpc(db, "mkt_pausar", {
      _campanha: id,
      _lote: null,
      _motivo: `pausa automática: ${motivo}`,
    });
  await avisar(
    db,
    empresaId,
    "qualidade_numero",
    "Envio pausado: qualidade do número",
    `O ${motivo} na Meta. Pausei ${campanhas.length} campanha(s)/lembrete(s) para proteger o número que recebe os leads. Confira a qualidade no Gerenciador do WhatsApp e toque em "Retomar" quando voltar ao verde.`,
    null,
    true,
  );
  log("ERROR", "campanha.pausada_qualidade", { empresa: empresaId, motivo, campanhas });
  return campanhas.length;
}
