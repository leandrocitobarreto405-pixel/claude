/**
 * Levanta os fatos de uma empresa para o checklist de implantação (só servidor, com o cliente de
 * serviço; quem chama já conferiu que é o admin da empresa ou a Nexa). Nada de token sai daqui.
 */
import type { Db } from "@/lib/mkt/contexto.server";
import type { ChaveEtapa, Fatos, Marcacao } from "@/lib/implantacao";

const BASES_DA_FINALIDADE = [
  "posvenda",
  "oferta",
  "reativacao",
  "orcamento",
  "higienizacao_6m",
  "imper_13m",
  "promocao",
];

/** Modelos usados pela empresa: os que faltam na Meta e os que não estão aprovados. */
async function situacaoDosModelos(db: Db, empresaId: string): Promise<Fatos["modelos"]> {
  const { listarParaTela } = await import("@/lib/meta/modelos.server");
  const lista = await listarParaTela(db, empresaId);
  if (lista.fonte === "nenhuma") return null;
  const usados = new Set(BASES_DA_FINALIDADE.map((k) => lista.nomes[k]).filter(Boolean));
  const naoAprovados = lista.modelos
    .filter((m) => usados.has(m.nome) && m.status !== "APPROVED")
    .map((m) => m.nome);
  return {
    faltando: lista.faltando.map((f) => f.nome),
    naoAprovados: [...new Set(naoAprovados)],
  };
}

const cheio = (t: string | null | undefined) => Boolean(t && t.trim());

export async function fatosDaEmpresa(
  db: Db,
  empresaId: string,
  opcoes: { conferirModelos: boolean } = { conferirModelos: true },
): Promise<{ fatos: Fatos; liberadaEm: string | null; nome: string }> {
  const contar = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const head = { count: "exact" as const, head: true };
  const [
    { data: empresa },
    { data: papeis },
    convites,
    precos,
    taxas,
    { data: textos },
    tecnicos,
    horarios,
    caixas,
    { data: alice },
    { data: meta },
    { data: veiculos },
    { data: google },
    contatos,
    campanhas,
    celulares,
    { data: marcadas },
  ] = await Promise.all([
    db
      .from("empresas")
      .select("nome, cnpj, telefone, cidade, estado, created_at, implantacao_liberada_em")
      .eq("id", empresaId)
      .single(),
    db.from("usuarios_empresa").select("papel").eq("empresa_id", empresaId),
    contar(
      db
        .from("convites_empresa")
        .select("id", head)
        .eq("empresa_id", empresaId)
        .is("aceito_em", null),
    ),
    contar(
      db
        .from("tabela_precos_itens")
        .select("id", head)
        .eq("empresa_id", empresaId)
        .eq("ativo", true),
    ),
    contar(
      db.from("payment_rates").select("id", head).eq("empresa_id", empresaId).eq("active", true),
    ),
    db
      .from("app_settings")
      .select("key, updated_at")
      .eq("empresa_id", empresaId)
      .in("key", ["message_template", "invoice_message_template"]),
    contar(
      db.from("technicians").select("id", head).eq("empresa_id", empresaId).eq("active", true),
    ),
    contar(db.from("agenda_horarios_base").select("id", head).eq("empresa_id", empresaId)),
    contar(
      db.from("chatwoot_inboxes").select("id", head).eq("empresa_id", empresaId).eq("ativo", true),
    ),
    db
      .from("ia_configuracoes")
      .select(
        "nome, descricao_negocio, instrucoes, perguntas_frequentes, hora_inicio, hora_fim, raio_km",
      )
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    db.from("meta_conexoes").select("waba_id").eq("empresa_id", empresaId).maybeSingle(),
    db.from("veiculos").select("dia_rodizio").eq("empresa_id", empresaId),
    db.from("google_conexoes").select("situacao").eq("empresa_id", empresaId).maybeSingle(),
    contar(db.from("mkt_contatos").select("id", head).eq("empresa_id", empresaId)),
    contar(
      db
        .from("mkt_campanhas")
        .select("id", head)
        .eq("empresa_id", empresaId)
        .eq("tipo", "calendario"),
    ),
    contar(db.from("push_inscricoes").select("id", head).eq("empresa_id", empresaId)),
    db.from("implantacao_etapas").select("etapa, situacao").eq("empresa_id", empresaId),
  ]);
  if (!empresa) throw new Error("Empresa não encontrada.");

  // Textos copiados no cadastro têm a data do cadastro; salvos depois = a empresa mexeu.
  const criada = Date.parse(empresa.created_at) + 5 * 60_000;
  const textosSalvos = (textos ?? []).some((t) => Date.parse(t.updated_at) > criada);
  const n = (p: string) => (papeis ?? []).filter((x) => x.papel === p).length;

  let modelos: Fatos["modelos"] = null;
  if (opcoes.conferirModelos) {
    try {
      modelos = await situacaoDosModelos(db, empresaId);
    } catch {
      modelos = null;
    }
  }

  const fatos: Fatos = {
    empresa: {
      nome: empresa.nome,
      cnpj: empresa.cnpj,
      telefone: empresa.telefone,
      cidade: empresa.cidade,
      estado: empresa.estado,
    },
    usuarios: {
      admin: n("admin"),
      atendente: n("atendente"),
      tecnico: n("tecnico"),
      convitesPendentes: convites,
    },
    precos,
    taxas,
    textosSalvos,
    tecnicosAtivos: tecnicos,
    horariosBase: horarios,
    whatsapp: { caixasChatwoot: caixas },
    modelos,
    alice: alice
      ? {
          nome: cheio(alice.nome),
          descricao: cheio(alice.descricao_negocio),
          instrucoes: cheio(alice.instrucoes),
          perguntas: cheio(alice.perguntas_frequentes),
          horario: alice.hora_inicio != null && alice.hora_fim != null,
          area: alice.raio_km != null && Number(alice.raio_km) > 0,
        }
      : null,
    tokenMeta: Boolean(meta?.waba_id),
    veiculos: {
      total: (veiculos ?? []).length,
      comRodizio: (veiculos ?? []).filter((v) => v.dia_rodizio != null).length,
    },
    google: google?.situacao === "conectada",
    marketing: { contatos, campanhas },
    notificacoes: celulares,
    marcadas: Object.fromEntries(
      (marcadas ?? [])
        .filter((m) => m.situacao !== "pendente")
        .map((m) => [m.etapa as ChaveEtapa, m.situacao as Marcacao]),
    ),
  };
  return { fatos, liberadaEm: empresa.implantacao_liberada_em, nome: empresa.nome };
}
