/**
 * Alice fora do ar (item 11): na varredura, olha as empresas com a chave ligada e, se a Alice
 * parou de responder e há cliente esperando, manda push só para o admin (a cada 15 minutos enquanto
 * durar). Só leitura no banco, fora o registro do push e da medição.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { avisadorReal, registrarEvento, type Avisador } from "./avisos.server";
import {
  ESPERA_MIN,
  JANELA_HORAS,
  causaForaDoAr,
  conversasSemResposta,
  referenciaDoAviso,
  textoForaDoAr,
  type TarefaDaAlice,
} from "./fora-do-ar";

type Db = SupabaseClient;

export async function rodarAvisoForaDoAr(
  agora = new Date(),
): Promise<{ empresas: number; pushes: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  return avisoForaDoAr(db, agora, await avisadorReal(db));
}

/** O aviso em si, com o banco e o envio de push recebidos de fora (testável). */
export async function avisoForaDoAr(
  db: Db,
  agora: Date,
  avisador: Avisador,
): Promise<{ empresas: number; pushes: number }> {
  const saida = { empresas: 0, pushes: 0 };
  const { data: cfgs } = await db
    .from("ia_configuracoes")
    .select("empresa_id, ativo")
    .eq("aviso_fora_do_ar", true);
  const lista = (cfgs ?? []) as Array<{ empresa_id: string; ativo: boolean | null }>;
  if (!lista.length) return saida;
  const desde = new Date(agora.getTime() - JANELA_HORAS * 3_600_000).toISOString();
  const limite = new Date(agora.getTime() - ESPERA_MIN * 60_000).toISOString();
  for (const cfg of lista) {
    const emp = cfg.empresa_id;
    const ligada = Boolean(cfg.ativo);
    const [{ data: tarefas }, { data: paradas }, { data: pendentes }] = await Promise.all([
      db
        .from("ia_tarefas")
        .select("conversa_id, situacao, executar_apos, created_at")
        .eq("empresa_id", emp)
        .eq("tipo", "responder")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("ia_paradas")
        .select("causa, conversas")
        .eq("empresa_id", emp)
        .eq("provedor", "ia")
        .is("fim", null)
        .limit(1),
      // Alice desligada: quem escreveu e continua na fila dela, sem ninguém responder.
      ligada
        ? Promise.resolve({ data: [] })
        : db
            .from("conversas")
            .select("id, aguardando_desde")
            .eq("empresa_id", emp)
            .eq("status", "pending")
            .gte("aguardando_desde", desde)
            .lte("aguardando_desde", limite)
            .limit(100),
    ]);
    const parada = ((paradas ?? []) as Array<{ causa: string; conversas: string[] | null }>)[0];
    const esperando = new Map<string, string>();
    for (const c of conversasSemResposta((tarefas ?? []) as TarefaDaAlice[], agora))
      esperando.set(c.conversaId, c.desde);
    for (const c of (pendentes ?? []) as Array<{ id: string; aguardando_desde: string }>)
      if (!esperando.has(c.id)) esperando.set(c.id, c.aguardando_desde);
    // Tarefa parada de conversa que a equipe já assumiu não é cliente esperando a Alice.
    if (esperando.size) {
      const { data: convs } = await db
        .from("conversas")
        .select("id, status, encerrada_em")
        .in("id", [...esperando.keys()]);
      for (const c of (convs ?? []) as Array<{
        id: string;
        status: string | null;
        encerrada_em: string | null;
      }>)
        if (c.encerrada_em || c.status !== "pending") esperando.delete(c.id);
    }
    const comAEquipe = parada?.conversas?.length ?? 0;
    if (!esperando.size && !comAEquipe) continue;
    saida.empresas++;
    const maisAntigo = [...esperando.values()].sort()[0];
    const texto = textoForaDoAr({
      causa: causaForaDoAr({
        parada:
          parada?.causa === "credito" || parada?.causa === "autenticacao" ? parada.causa : null,
        ligada,
      }),
      esperando: esperando.size,
      minutos: maisAntigo ? Math.floor((agora.getTime() - Date.parse(maisAntigo)) / 60_000) : 0,
      comAEquipe,
    });
    // Só o dono (o primeiro admin da empresa) recebe: pedido do dono em 12/11.
    const dono = await donoDaEmpresa(db, emp);
    const admins = (await avisador.pessoas(emp)).filter(
      (p) => p.papel === "admin" && p.userId === dono,
    );
    let enviados = 0;
    for (const p of admins)
      enviados += await avisador.enviar({
        empresaId: emp,
        userId: p.userId,
        tipo: "alice_fora_do_ar",
        ref: referenciaDoAviso(agora),
        titulo: texto.titulo,
        corpo: texto.corpo,
        url: "/conversas",
        tag: "alice-fora-do-ar",
      });
    if (enviados)
      await registrarEvento(db, {
        empresa_id: emp,
        tipo: "alice_fora_do_ar",
        dados: { esperando: esperando.size, com_a_equipe: comAEquipe, pushes: enviados },
      });
    saida.pushes += enviados;
  }
  return saida;
}

/** O dono da empresa: o primeiro usuário com papel admin (quem criou a conta). */
export async function donoDaEmpresa(db: Db, empresaId: string): Promise<string | null> {
  const { data } = await db
    .from("usuarios_empresa")
    .select("user_id")
    .eq("empresa_id", empresaId)
    .eq("papel", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}
