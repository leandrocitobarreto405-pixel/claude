/**
 * Quem recebe e como sai cada push dos alarmes da Alice (transferência sem resposta, Alice fora do
 * ar). Separado para os alarmes poderem ser testados sem banco e sem rede. Só equipe: nunca cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreferenciasPush, TipoAlarme } from "@/lib/push/notificacoes";

export type PessoaDoAviso = {
  userId: string;
  papel: "admin" | "atendente" | "tecnico";
  pref: PreferenciasPush;
};

export type Avisador = {
  /** Pessoas da empresa com celular inscrito. */
  pessoas(empresaId: string): Promise<PessoaDoAviso[]>;
  /** Manda uma vez por (pessoa, tipo, ref). Devolve em quantos aparelhos chegou (0 = já mandado). */
  enviar(o: {
    empresaId: string;
    userId: string;
    tipo: TipoAlarme;
    ref: string;
    titulo: string;
    corpo: string;
    url: string;
    tag: string;
  }): Promise<number>;
};

export async function avisadorReal(db: SupabaseClient): Promise<Avisador> {
  const { pessoasComCelular, enviarParaPessoa, registrarUmaVez } =
    await import("@/lib/push/notificacoes.server");
  const celulares = new Map<string, Parameters<typeof enviarParaPessoa>[1]>();
  return {
    async pessoas(empresaId) {
      const lista = (await pessoasComCelular(db as never, empresaId)).get(empresaId) ?? [];
      for (const p of lista) celulares.set(`${empresaId}:${p.userId}`, p.celulares);
      return lista.map((p) => ({ userId: p.userId, papel: p.papel, pref: p.pref }));
    },
    async enviar(o) {
      const aparelhos = celulares.get(`${o.empresaId}:${o.userId}`);
      if (!aparelhos?.length) return 0;
      const id = await registrarUmaVez(
        db as never,
        o.empresaId,
        o.userId,
        o.tipo,
        o.ref,
        o.titulo,
      ).catch(() => null);
      if (!id) return 0;
      const r = await enviarParaPessoa(db as never, aparelhos, {
        titulo: o.titulo,
        corpo: o.corpo,
        url: o.url,
        tag: o.tag,
      });
      await db.from("push_envios").update({ enviados: r.enviados }).eq("id", id);
      return r.enviados;
    },
  };
}

/** Evento da medição (alice_eventos). Nunca derruba o fluxo: erro vira aviso no log. */
export async function registrarEvento(
  db: SupabaseClient,
  linha: {
    empresa_id: string;
    tipo: string;
    conversa_id?: string | null;
    crm_lead_id?: string | null;
    quote_id?: string | null;
    dados?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  try {
    const { error } = await db.from("alice_eventos").insert(linha);
    if (error) console.error("Alice: evento da medição não gravado", linha.tipo, error.message);
  } catch (e) {
    console.error(
      "Alice: evento da medição falhou",
      linha.tipo,
      e instanceof Error ? e.message : e,
    );
  }
}
