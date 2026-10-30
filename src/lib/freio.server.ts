/**
 * Freio do servidor para os trabalhos pesados que não têm pressa (lotes da gerente, noite da
 * Tatiana, transcrição de áudios pendentes). Antes de cada passada e de cada rodada, mede uma
 * consulta simples no banco: acima de 2 s, a passada para e tenta no minuto seguinte. Entre uma
 * rodada e outra há uma pausa curta, para o banco atender as telas no meio.
 */
type Db = {
  from: (t: string) => { select: (c: string) => { limit: (n: number) => PromiseLike<unknown> } };
};

export const LIMITE_LENTO_MS = 2_000;
export const PAUSA_ENTRE_RODADAS_MS = 3_000;

export const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Decide pelo tempo medido (e por erro na consulta). */
export const deveFrear = (ms: number, erro = false) => erro || ms > LIMITE_LENTO_MS;

/** Mede o banco com uma consulta simples; `lento` = frear. */
export async function bancoLento(db: unknown): Promise<{ lento: boolean; ms: number }> {
  const t0 = Date.now();
  let erro = false;
  try {
    const r = (await (db as Db).from("empresas").select("id").limit(1)) as { error?: unknown };
    erro = Boolean(r?.error);
  } catch {
    erro = true;
  }
  const ms = Date.now() - t0;
  return { lento: deveFrear(ms, erro), ms };
}

/**
 * Antes de uma rodada: na primeira só mede; nas seguintes, pausa e mede de novo. `false` = parar a
 * passada aqui (o que faltar fica para a próxima).
 */
export async function podeSeguir(db: unknown, primeiraRodada: boolean): Promise<boolean> {
  if (!primeiraRodada) await pausa(PAUSA_ENTRE_RODADAS_MS);
  const { lento, ms } = await bancoLento(db);
  if (lento) console.warn(`[freio] banco lento (${ms} ms): passada adiada`);
  return !lento;
}
