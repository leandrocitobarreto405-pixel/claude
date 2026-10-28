/**
 * Alarme de crédito da IA: grava o período no banco (ia_registrar_parada), avisa a Nexa por push
 * (nexa_admin, todos os aparelhos) no primeiro erro e de 2 em 2 horas, testa a conta antes de repetir
 * e fecha o período na primeira resposta que der certo. O sininho das empresas é o banco que grava.
 * Nunca registra chave nem corpo de resposta da conta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Notificacao } from "@/lib/push/notificacoes";
import {
  causaDaParadaIa,
  corpoParadaNexa,
  duracaoDaParada,
  tituloParadaNexa,
  type CausaParada,
  type ProvedorParada,
} from "./parada-ia";

type Db = SupabaseClient<Database>;

/** Erro da chamada à IA que é falta de crédito ou chave recusada (motor → processarTarefa). */
export class ParadaIa extends Error {
  constructor(
    readonly causa: CausaParada,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ParadaIa";
  }
}

/** Chamada à IA: erro de crédito/chave vira ParadaIa (o resto segue como erro comum). */
export async function chamarIa<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const causa = causaDaParadaIa(e);
    if (causa) throw new ParadaIa(causa, e instanceof Error ? e.message.slice(0, 300) : String(e));
    throw e;
  }
}

/** Push para quem é nexa_admin (todos os aparelhos ativados, em qualquer empresa). */
export async function avisarNexa(db: Db, n: Notificacao): Promise<number> {
  const { data: admins } = await db
    .from("plataforma_usuarios")
    .select("user_id")
    .eq("papel", "nexa_admin")
    .eq("ativo", true);
  const ids = [...new Set(((admins ?? []) as Array<{ user_id: string }>).map((a) => a.user_id))];
  if (!ids.length) return 0;
  const { data: inscricoes } = await db
    .from("push_inscricoes")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", ids);
  const vistos = new Set<string>();
  const celulares = (
    (inscricoes ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>
  ).filter((c) => !vistos.has(c.endpoint) && vistos.add(c.endpoint));
  if (!celulares.length) return 0;
  const { enviarParaPessoa } = await import("@/lib/push/notificacoes.server");
  const r = await enviarParaPessoa(db, celulares, n);
  return r.enviados;
}

/** Erro de crédito/chave: abre ou soma o período da empresa e, se for a hora, avisa a Nexa. */
export async function registrarParada(
  db: Db,
  empresaId: string,
  provedor: ProvedorParada,
  causa: CausaParada,
  conversaId: string | null,
): Promise<void> {
  try {
    const { data, error } = await db.rpc("ia_registrar_parada", {
      _emp: empresaId,
      _provedor: provedor,
      _causa: causa,
      _conversa: conversaId,
    });
    if (error) throw new Error(error.message);
    const r = (Array.isArray(data) ? data[0] : data) as
      { avisar_nexa: boolean; desde: string | null } | undefined;
    if (!r?.avisar_nexa) return;
    const { empresas, conversas } = await resumoAberto(db, provedor);
    await avisarNexa(db, {
      titulo: tituloParadaNexa(provedor, causa, new Date(r.desde ?? Date.now())),
      corpo: corpoParadaNexa(provedor, empresas, conversas, causa),
      url: "/nexa/consumo",
      tag: `parada-${provedor}`,
    });
  } catch (e) {
    console.error("Alarme da IA: falha ao registrar a parada", e instanceof Error ? e.message : e);
  }
}

async function resumoAberto(db: Db, provedor: ProvedorParada) {
  const { data } = await db
    .from("ia_paradas")
    .select("empresa_id, conversas")
    .eq("provedor", provedor)
    .is("fim", null);
  const linhas = (data ?? []) as Array<{ conversas: string[] | null }>;
  return {
    empresas: linhas.length,
    conversas: linhas.reduce((s, l) => s + (l.conversas?.length ?? 0), 0),
  };
}

/** Resposta (ou teste da conta) que deu certo: fecha os períodos do provedor e avisa a Nexa. */
export async function encerrarParadas(db: Db, provedor: ProvedorParada): Promise<void> {
  try {
    const { data, error } = await db.rpc("ia_encerrar_paradas", { _provedor: provedor });
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as Array<{ inicio: string; fim: string; conversas: number }>;
    if (!linhas.length) return;
    const inicio = new Date(Math.min(...linhas.map((l) => Date.parse(l.inicio))));
    const fim = new Date(Math.max(...linhas.map((l) => Date.parse(l.fim))));
    const conversas = linhas.reduce((s, l) => s + Number(l.conversas || 0), 0);
    const quem = provedor === "ia" ? "A Alice voltou a responder" : "O áudio da Alice voltou";
    await avisarNexa(db, {
      titulo: `${quem} (parada de ${duracaoDaParada(inicio, fim)})`,
      corpo:
        provedor === "ia"
          ? `${conversas === 1 ? "1 conversa foi" : `${conversas} conversas foram`} para a equipe durante a parada.`
          : "A conta de voz voltou a responder.",
      url: "/nexa/consumo",
      tag: `parada-${provedor}`,
    });
  } catch (e) {
    console.error("Alarme da IA: falha ao fechar a parada", e instanceof Error ? e.message : e);
  }
}

/** Teste mínimo da conta da IA (1 token): null = respondeu; senão, a causa (ou "outro"). */
async function testarContaIa(): Promise<CausaParada | "outro" | null> {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    await chamarIa(() =>
      new Anthropic().messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "ok" }],
      }),
    );
    return null;
  } catch (e) {
    return e instanceof ParadaIa ? e.causa : "outro";
  }
}

/** Nível de aviso (30 ou 10) que o saldo restante cruzou e ainda não foi avisado; null = nenhum. */
export function nivelDeSaldo(restante: number, avisados: string[]): 30 | 10 | null {
  if (restante <= 0.1 && !avisados.includes("10")) return 10;
  if (restante <= 0.3 && !avisados.includes("30") && !avisados.includes("10")) return 30;
  return null;
}

/** Saldo estimado da conta da IA (a cada 10 min): aviso à Nexa em 30% e 10%. */
async function avisarSaldoIa(db: Db): Promise<number> {
  const { data, error } = await db.rpc("ia_saldo_hora_de_avisar");
  if (error) {
    if (/PGRST202|42883|could not find the function/i.test(`${error.code} ${error.message}`))
      return 0;
    throw new Error(error.message);
  }
  const r = (Array.isArray(data) ? data[0] : data) as
    { nivel: number; restante_usd: number } | undefined;
  if (!r?.nivel) return 0;
  return avisarNexa(db, {
    titulo: `Crédito da IA acabando: restam ~US$ ${Number(r.restante_usd).toFixed(2)} (${r.nivel}%)`,
    corpo:
      "Saldo estimado pelo consumo medido desde a última carga. Recarregue a conta da IA para a Alice não parar.",
    url: "/nexa/consumo",
    tag: "saldo-ia",
  });
}

/** Saldo da ElevenLabs (a cada 30 min): aviso à Nexa em 30% e 10% de créditos restantes no ciclo. */
async function avisarSaldoEleven(db: Db): Promise<number> {
  const { saldoEleven } = await import("./eleven.server");
  const s = await saldoEleven();
  if (!s || !s.limite) return 0;
  const ciclo = s.renovaEm ?? "sem-ciclo";
  const { data: atual } = await db
    .from("configuracoes_plataforma")
    .select("valor")
    .eq("chave", "eleven_saldo_avisos")
    .maybeSingle();
  const anteriores = (atual?.valor ?? {}) as Record<string, string>;
  const marcas: Record<string, string> = anteriores["ciclo"] === ciclo ? anteriores : { ciclo };
  const nivel = nivelDeSaldo(s.restante, Object.keys(marcas));
  if (!nivel) return 0;
  await db.from("configuracoes_plataforma").upsert({
    chave: "eleven_saldo_avisos",
    valor: { ...marcas, [String(nivel)]: new Date().toISOString() },
    descricao: "Avisos de saldo baixo da ElevenLabs já mandados (por ciclo do plano)",
    updated_at: new Date().toISOString(),
  });
  const restam = Math.max(0, s.limite - s.usados).toLocaleString("pt-BR");
  return avisarNexa(db, {
    titulo: `ElevenLabs acabando: restam ${restam} créditos (${nivel}%)`,
    corpo: `Ao acabar, o áudio da Alice sai pela voz do Google.${s.renovaEm ? ` O plano renova em ${new Date(s.renovaEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : ""}`,
    url: "/nexa/consumo",
    tag: "saldo-eleven",
  });
}

/**
 * Rotina de cada minuto: com parada aberta há 2 horas sem aviso, testa a conta; se já respondeu,
 * fecha (avisa que voltou); se não, avisa a Nexa de novo. A cada 10 min, o saldo estimado da IA; a
 * cada 30 min, o saldo da ElevenLabs.
 */
export async function rotinaAlarmeIa(db: Db, agora = new Date()): Promise<{ avisos: number }> {
  let avisos = 0;
  const minuto = agora.getUTCMinutes();
  if (minuto % 10 === 0) avisos += await avisarSaldoIa(db);
  if (minuto % 30 === 0)
    avisos += await avisarSaldoEleven(db).catch((e) => {
      console.warn("Saldo da ElevenLabs não consultado:", e instanceof Error ? e.message : e);
      return 0;
    });
  for (const provedor of ["ia", "voz"] as const) {
    const { data, error } = await db.rpc("ia_parada_hora_de_avisar", { _provedor: provedor });
    // Antes da migração (função ainda não existe no banco): nada a fazer, sem marcar a rotina com erro.
    if (
      error &&
      /PGRST202|42883|could not find the function/i.test(`${error.code} ${error.message}`)
    )
      return { avisos };
    if (error) throw new Error(error.message);
    const r = (Array.isArray(data) ? data[0] : data) as
      { desde: string; causa: CausaParada; empresas: number; conversas: number } | undefined;
    if (!r?.desde) continue;
    const teste =
      provedor === "ia"
        ? await testarContaIa()
        : await (await import("./eleven.server")).testarContaEleven();
    if (teste === null) {
      await encerrarParadas(db, provedor);
      continue;
    }
    avisos += await avisarNexa(db, {
      titulo: tituloParadaNexa(provedor, teste === "outro" ? r.causa : teste, new Date(r.desde)),
      corpo: corpoParadaNexa(
        provedor,
        r.empresas,
        r.conversas,
        teste === "outro" ? r.causa : teste,
      ),
      url: "/nexa/consumo",
      tag: `parada-${provedor}`,
    });
  }
  return { avisos };
}
