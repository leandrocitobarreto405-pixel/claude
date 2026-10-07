/**
 * Transcrição dos áudios do cliente, gravada na própria mensagem (whatsapp_messages.transcricao).
 *
 * Roda em dois momentos: quando a Alice vai responder (motor) e na varredura periódica, para
 * todo áudio recebido — mesmo em conversa que está com a equipe ou com a Alice fora. Toda falha
 * fica em transcricao_erro (antes, áudio sem anexo encontrado saía sem registro nenhum).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;
type Anexo = { file_type?: string; data_url?: string };

/** Dias para trás que a varredura ainda transcreve. */
const DIAS_PENDENTES = 15;

/** Transcreve as mensagens de áudio indicadas. Devolve id → texto das que deram certo. */
export async function transcreverMensagens(
  db: Admin,
  empresaId: string,
  mensagens: Array<{ id: string; raw_event_reference: string | null }>,
): Promise<Map<string, string>> {
  const textos = new Map<string, string>();
  if (!mensagens.length) return textos;
  const refs = mensagens.map((m) => m.raw_event_reference).filter((r): r is string => !!r);
  const anexos = new Map<string, Anexo[]>();
  if (refs.length) {
    const { data: evs } = await db
      .from("integracao_eventos")
      .select("id, payload")
      .eq("empresa_id", empresaId)
      .in("id", refs);
    for (const ev of evs ?? [])
      anexos.set(ev.id, ((ev.payload as { attachments?: Anexo[] })?.attachments ?? []) as Anexo[]);
  }
  const { transcreverAudio } = await import("./transcricao.server");
  const gravar = (id: string, campos: { transcricao?: string; transcricao_erro?: string }) =>
    db.from("whatsapp_messages").update(campos).eq("id", id).eq("empresa_id", empresaId);

  await Promise.all(
    mensagens.map(async (m) => {
      const audio = (anexos.get(m.raw_event_reference ?? "") ?? []).find(
        (a) => a.file_type === "audio" && a.data_url,
      );
      if (!audio) {
        await gravar(m.id, { transcricao_erro: "anexo de áudio não encontrado no evento" });
        return;
      }
      const r = await transcreverAudio(audio.data_url!);
      if ("texto" in r) {
        textos.set(m.id, r.texto);
        await gravar(m.id, { transcricao: r.texto });
      } else {
        console.warn("Alice: transcrição falhou", m.id, r.erro);
        await gravar(m.id, { transcricao_erro: r.erro.slice(0, 500) });
      }
    }),
  );
  return textos;
}

/** Varredura: áudios recebidos ainda sem transcrição (nem erro), nas empresas com ela ligada. */
export async function transcreverPendentes(
  db: Admin,
  limitePorEmpresa = 10,
): Promise<{ tentados: number; transcritos: number }> {
  const { data: cfgs } = await db
    .from("ia_configuracoes")
    .select("empresa_id")
    .eq("transcrever_audio", true);
  const desde = new Date(Date.now() - DIAS_PENDENTES * 86_400_000).toISOString();
  let tentados = 0;
  let transcritos = 0;
  for (const { empresa_id } of cfgs ?? []) {
    const { data } = await db
      .from("whatsapp_messages")
      .select("id, raw_event_reference")
      .eq("empresa_id", empresa_id)
      .eq("direction", "Recebida")
      .eq("message_type", "Áudio")
      .is("transcricao", null)
      .is("transcricao_erro", null)
      .gte("message_timestamp", desde)
      .order("message_timestamp", { ascending: false })
      .limit(limitePorEmpresa);
    const lista = data ?? [];
    tentados += lista.length;
    transcritos += (await transcreverMensagens(db, empresa_id, lista)).size;
  }
  return { tentados, transcritos };
}
