/**
 * Mensagem de erro para a tela, em português. As mensagens que o próprio app escreve (servidor,
 * regras do banco em português) aparecem como estão; erro técnico (banco, rede, código) vira um
 * texto padrão em português e o detalhe vai só para o log do navegador.
 */

export const TENTE_DE_NOVO = "Tente de novo em instantes; se continuar, avise o suporte.";

/** Trechos que denunciam erro técnico (PostgREST/Postgres, rede, JavaScript). */
const TECNICO =
  /could not|relationship|violates|permission denied|row-level security|duplicate key|does not exist|invalid input|syntax|jwt|token|failed to fetch|fetch failed|load failed|networkerror|network|timeout|timed out|status code|undefined|null value|cannot read|is not a function|unexpected|internal server|pgrst|schema cache|constraint|upstream|econn|socket/i;

/** Parece texto em português escrito para o usuário. */
const PORTUGUES =
  /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]|\b(nao|informe|use|esta|este|sem|para|com|ja|ainda|apenas|selecione)\b/i;

function textoDoErro(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: unknown }).message);
  return typeof e === "string" ? e : "";
}

export function ehErroTecnico(mensagem: string): boolean {
  const m = mensagem.trim();
  return !m || TECNICO.test(m) || !PORTUGUES.test(m);
}

/**
 * Texto para mostrar ao usuário. `padrao` é a frase da tela (ex.: "Não deu para carregar os
 * números agora."); o "Tente de novo…" é acrescentado. `onde` identifica o ponto no log.
 */
export function mensagemDeErro(e: unknown, padrao: string, onde?: string): string {
  const msg = textoDoErro(e);
  if (!ehErroTecnico(msg)) return msg;
  console.error(`[erro${onde ? ` ${onde}` : ""}]`, e);
  return `${padrao.trim()} ${TENTE_DE_NOVO}`;
}
