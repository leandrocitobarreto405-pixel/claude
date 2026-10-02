/**
 * Clientes esperando a equipe "de verdade": conversa aberta com a equipe, marcada como aguardando
 * no Chatwoot e com a última mensagem (não privada) vinda do cliente. Usado na contagem do Início,
 * da aba Conversas, dos Avisos, do resumo do dia e das notificações.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ultimaDirecaoPorConversa } from "@/lib/conversas";

type Db = SupabaseClient<Database>;

export type EsperaReal = { id: string; aguardandoDesde: string };

export async function esperasReais(
  db: Db,
  empresaId: string,
  opcoes: { desde?: string } = {},
): Promise<EsperaReal[]> {
  let q = db
    .from("conversas")
    .select("id, aguardando_desde")
    .eq("empresa_id", empresaId)
    .eq("status", "open")
    .not("aguardando_desde", "is", null)
    .order("aguardando_desde")
    .limit(300);
  if (opcoes.desde) q = q.gte("aguardando_desde", opcoes.desde);
  const { data: conversas } = await q;
  const lista = (conversas ?? []).filter((c): c is { id: string; aguardando_desde: string } =>
    Boolean(c.aguardando_desde),
  );
  if (!lista.length) return [];
  // A mensagem do cliente que abriu a espera é de depois do "aguardando desde" (com folga).
  const inicio = new Date(Date.parse(lista[0]!.aguardando_desde) - 3600_000).toISOString();
  const { data: msgs } = await db
    .from("whatsapp_messages")
    .select("conversa_id, direction")
    .in(
      "conversa_id",
      lista.map((c) => c.id),
    )
    .eq("privada", false)
    .gte("created_at", inicio)
    .order("created_at", { ascending: false })
    .limit(5000);
  const ultima = ultimaDirecaoPorConversa(msgs ?? []);
  return lista
    .filter((c) => ultima.get(c.id) === "Recebida")
    .map((c) => ({ id: c.id, aguardandoDesde: c.aguardando_desde }));
}
