/** Textos editados na tela "Modelos de mensagem" (sem linha = texto padrão do app). */
import type { Db } from "./contexto.server";

export async function textosDaEmpresa(db: Db, empresaId: string): Promise<Record<string, string>> {
  const { data } = await db
    .from("mensagens_textos")
    .select("chave, texto")
    .eq("empresa_id", empresaId);
  return Object.fromEntries((data ?? []).map((t) => [t.chave, t.texto]));
}
