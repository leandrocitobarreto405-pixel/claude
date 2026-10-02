/**
 * Avisos da equipe pelo WhatsApp: cliente esperando a equipe (rotina de 1 em 1 minuto) e resumo
 * do dia (rotina das 9h). Os dois só criam linhas em mkt_avisos; quem manda para o WhatsApp é
 * processarAvisosWhatsapp, só para o telefone da equipe e só com a chave ligada.
 * Nada aqui envia mensagem para cliente.
 */
import {
  chaveTelefone,
  esperasParaAvisar,
  numeroDeCliente,
  textoEspera,
  textoResumoDoDia,
  type EsperaConversa,
} from "@/lib/avisos";
import { ultimaPassagem } from "@/lib/conversas";
import { avisar, hojeSP } from "./campanhas.server";
import { dbServico, log, type Db } from "./contexto.server";
import { textosDaEmpresa } from "./textos.server";

/** O número foi marcado pelo admin como contato interno da equipe? */
export async function numeroEhInterno(
  db: Db,
  empresaId: string,
  numero: string | null | undefined,
): Promise<boolean> {
  const chave = chaveTelefone(numero ?? "");
  if (!chave) return false;
  const { data, error } = await db
    .from("contatos_internos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("chave", chave)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

/**
 * O número é de alguém da base de clientes da empresa (clientes com OS ou contatos de marketing)?
 * Contato interno da equipe (marcado pelo admin) não conta como cliente.
 */
export async function numeroEhDeCliente(
  db: Db,
  empresaId: string,
  numero: string | null | undefined,
): Promise<boolean> {
  const digitos = (numero ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return false;
  if (await numeroEhInterno(db, empresaId, numero)) return false;
  const fim = digitos.slice(-8);
  const [contatos, clientes] = await Promise.all([
    db
      .from("mkt_contatos")
      .select("normalized_phone")
      .eq("empresa_id", empresaId)
      .like("normalized_phone", `%${fim}`)
      .limit(50),
    // O telefone do cliente pode estar formatado ("(11) 98888-7777"): busca pelos 4 últimos e
    // confere a chave completa depois.
    db
      .from("customers")
      .select("phone")
      .eq("empresa_id", empresaId)
      .like("phone", `%${fim.slice(-4)}`)
      .limit(500),
  ]);
  if (contatos.error || clientes.error) {
    // Sem conseguir conferir, trata como cliente: melhor não enviar do que enviar errado.
    return true;
  }
  return numeroDeCliente(numero, [
    ...(contatos.data ?? []).map((c) => c.normalized_phone),
    ...(clientes.data ?? []).map((c) => c.phone),
  ]);
}

/** Os avisos são só para a equipe: recusa o número se ele for de um cliente da empresa. */
export async function recusarNumeroDeCliente(db: Db, empresaId: string, numero: string | null) {
  if (!numero) return;
  if (await numeroEhDeCliente(db, empresaId, numero))
    throw new Error(
      "Esse telefone é de um cliente. Os avisos são só para a equipe: use o celular de alguém da equipe.",
    );
}

/** Cria o aviso "cliente esperando" para as esperas que passaram do limite configurado. */
export async function gerarAvisosDeEspera(agora = new Date()) {
  const db = await dbServico();
  const { data: cfgs } = await db
    .from("mkt_configuracoes")
    .select("empresa_id, aviso_espera_minutos")
    .eq("aviso_whatsapp_ligado", true)
    .not("aviso_espera_minutos", "is", null);
  let criados = 0;
  for (const cfg of cfgs ?? []) {
    const minutos = cfg.aviso_espera_minutos ?? 0;
    try {
      const limite = new Date(agora.getTime() - minutos * 60_000).toISOString();
      const desde24h = new Date(agora.getTime() - 24 * 3600_000).toISOString();
      const { data: conversas } = await db
        .from("conversas")
        .select("id, aguardando_desde, whatsapp_contacts ( profile_name, display_phone )")
        .eq("empresa_id", cfg.empresa_id)
        .eq("status", "open")
        .lte("aguardando_desde", limite)
        .gte("aguardando_desde", desde24h)
        .limit(50);
      const lista = (conversas ?? []) as unknown as Array<{
        id: string;
        aguardando_desde: string;
        whatsapp_contacts: { profile_name: string | null; display_phone: string | null } | null;
      }>;
      if (!lista.length) continue;
      // Só quem está esperando de verdade (o cliente falou por último).
      const { esperasReais } = await import("@/lib/conversas-espera.server");
      const reais = new Set(
        (await esperasReais(db, cfg.empresa_id, { desde: desde24h })).map((e) => e.id),
      );
      const ids = lista.filter((c) => reais.has(c.id)).map((c) => c.id);
      if (!ids.length) continue;
      const [{ data: existentes }, { data: execs }] = await Promise.all([
        db
          .from("mkt_avisos")
          .select("conversa_id, created_at")
          .eq("empresa_id", cfg.empresa_id)
          .in("conversa_id", ids)
          .gte("created_at", desde24h),
        db
          .from("ia_execucoes")
          .select("conversa_id, ferramentas")
          .in("conversa_id", ids)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      const esperas: EsperaConversa[] = lista
        .filter((c) => ids.includes(c.id))
        .map((c) => ({
          id: c.id,
          nome:
            c.whatsapp_contacts?.profile_name || c.whatsapp_contacts?.display_phone || "Cliente",
          desde: c.aguardando_desde,
          motivo:
            ultimaPassagem((execs ?? []).filter((e) => e.conversa_id === c.id))?.motivo ?? null,
        }));
      const novas = esperasParaAvisar(
        esperas,
        (existentes ?? []).map((a) => ({ conversaId: a.conversa_id!, criadoEm: a.created_at })),
        minutos,
        agora,
      );
      const textos = novas.length ? await textosDaEmpresa(db, cfg.empresa_id) : {};
      for (const e of novas) {
        const { error } = await db.from("mkt_avisos").insert({
          empresa_id: cfg.empresa_id,
          tipo: "cliente_esperando",
          titulo: "Cliente esperando a equipe",
          mensagem: textoEspera(e, agora, textos["aviso_espera"]),
          conversa_id: e.id,
        });
        if (error) throw error;
        criados++;
      }
    } catch (e) {
      log("WARNING", "aviso_espera.erro", {
        empresa: cfg.empresa_id,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { criados };
}

/** Números do resumo do dia (serviços de hoje, atrasados, sem técnico, clientes esperando). */
export async function contagensDoDia(db: Db, empresaId: string, hoje = hojeSP()) {
  const [servicos, atrasados, semTecnico, esperando] = await Promise.all([
    db
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("scheduled_date", hoje)
      .neq("status", "Cancelado"),
    db
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .lt("scheduled_date", hoje)
      .in("status", ["Agendado", "Em execução", "Reagendado"]),
    db
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .is("technician_id", null)
      .neq("status", "Cancelado"),
    import("@/lib/conversas-espera.server").then(({ esperasReais }) => esperasReais(db, empresaId)),
  ]);
  return {
    servicosHoje: servicos.count ?? 0,
    atrasados: atrasados.count ?? 0,
    semTecnico: semTecnico.count ?? 0,
    esperando: esperando.length,
  };
}

/** Resumo do dia (rotina das 9h): um aviso por dia, se a opção estiver ligada. */
export async function avisoResumoDoDia(db: Db, empresaId: string, hoje = hojeSP()) {
  const textos = await textosDaEmpresa(db, empresaId);
  const texto = textoResumoDoDia(await contagensDoDia(db, empresaId, hoje), textos["aviso_resumo"]);
  await avisar(db, empresaId, "resumo_diario", "Resumo do dia", texto, null, true);
  return texto;
}
