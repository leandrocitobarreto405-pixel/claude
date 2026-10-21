/**
 * Nome do cliente no banco: lê a situação (nome confirmado x perfil) e grava o nome confirmado no
 * contato e na conversa, com a origem. Ver nome.ts para as regras.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  MAX_PERGUNTAS_NOME,
  limparNome,
  primeiroNomeLimpo,
  type OrigemNome,
  type SituacaoNome,
} from "./nome";

type Db = SupabaseClient<Database>;

/** Origem que pode trocar a outra: o que o cliente disse ou a equipe corrigiu vale mais que o perfil. */
const FORCA: Record<OrigemNome, number> = { perfil: 1, cadastro: 2, cliente: 3, equipe: 4 };

/**
 * Situação do nome nesta conversa. Sem nome confirmado e com cliente cadastrado (OS), o nome do
 * cadastro vale como confirmado (origem "cadastro") e fica gravado no contato.
 */
export async function situacaoDoNome(
  db: Db,
  empresaId: string,
  conversaId: string,
  contatoId: string | null,
  clienteIdDoLead: string | null,
): Promise<SituacaoNome> {
  const [{ data: conv }, { data: contato }] = await Promise.all([
    db
      .from("conversas")
      .select("nome_confirmado, nome_confirmado_origem, nome_perguntas")
      .eq("id", conversaId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    contatoId
      ? db
          .from("whatsapp_contacts")
          .select("profile_name, nome_confirmado, nome_confirmado_origem, current_customer_id")
          .eq("id", contatoId)
          .eq("empresa_id", empresaId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const perfil = contato?.profile_name ?? null;
  const perguntas = Number(conv?.nome_perguntas ?? 0);
  if (conv?.nome_confirmado)
    return {
      confirmado: conv.nome_confirmado,
      origem: conv.nome_confirmado_origem as OrigemNome,
      perfil,
      perguntas,
    };
  if (contato?.nome_confirmado)
    return {
      confirmado: contato.nome_confirmado,
      origem: contato.nome_confirmado_origem as OrigemNome,
      perfil,
      perguntas,
    };
  const clienteId = clienteIdDoLead ?? contato?.current_customer_id ?? null;
  if (clienteId) {
    const { data: cli } = await db
      .from("customers")
      .select("full_name")
      .eq("id", clienteId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    const nome = limparNome(cli?.full_name);
    if (nome) {
      if (contatoId)
        await gravarNoContato(db, empresaId, contatoId, nome, "cadastro").catch(() => undefined);
      return { confirmado: nome, origem: "cadastro", perfil, perguntas };
    }
  }
  return { confirmado: null, origem: null, perfil, perguntas };
}

async function gravarNoContato(
  db: Db,
  empresaId: string,
  contatoId: string,
  nome: string,
  origem: OrigemNome,
): Promise<boolean> {
  const { data: atual } = await db
    .from("whatsapp_contacts")
    .select("nome_confirmado, nome_confirmado_origem")
    .eq("id", contatoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const antes = atual?.nome_confirmado_origem as OrigemNome | null | undefined;
  if (atual?.nome_confirmado && antes && FORCA[antes] > FORCA[origem]) return false;
  const { error } = await db
    .from("whatsapp_contacts")
    .update({
      nome_confirmado: nome,
      nome_confirmado_origem: origem,
      nome_confirmado_em: new Date().toISOString(),
    })
    .eq("id", contatoId)
    .eq("empresa_id", empresaId);
  if (error) throw error;
  return true;
}

export type AcaoNome = "aceitei_perfil" | "cliente_informou" | "perguntei";

/**
 * Ferramenta registrar_nome_cliente. Grava contato e conversa; o nome do lead no CRM só muda
 * quando ainda é o nome automático (o do perfil), nunca um nome digitado pela equipe.
 */
export async function registrarNomeCliente(
  db: Db,
  ids: { empresaId: string; conversaId: string; contatoId: string | null; leadId: string | null },
  acao: AcaoNome,
  nomeInformado?: string,
): Promise<{ erro: boolean; texto: string }> {
  if (acao === "perguntei") {
    const { data: conv } = await db
      .from("conversas")
      .select("nome_perguntas")
      .eq("id", ids.conversaId)
      .eq("empresa_id", ids.empresaId)
      .maybeSingle();
    const n = Math.min(Number(conv?.nome_perguntas ?? 0) + 1, 10);
    await db
      .from("conversas")
      .update({ nome_perguntas: n })
      .eq("id", ids.conversaId)
      .eq("empresa_id", ids.empresaId);
    return {
      erro: false,
      texto:
        n >= MAX_PERGUNTAS_NOME
          ? "Registrado. Se o cliente não disser o nome, não pergunte mais: siga sem nome."
          : "Registrado. Se o cliente não disser o nome, pergunte só mais uma vez, adiante (antes do orçamento ou da OS).",
    };
  }
  const nome = limparNome(nomeInformado);
  if (!nome) return { erro: true, texto: "Nome inválido: mande só o nome da pessoa." };
  const origem: OrigemNome = acao === "aceitei_perfil" ? "perfil" : "cliente";
  const { data: conv } = await db
    .from("conversas")
    .select("nome_confirmado_origem")
    .eq("id", ids.conversaId)
    .eq("empresa_id", ids.empresaId)
    .maybeSingle();
  const antesConv = conv?.nome_confirmado_origem as OrigemNome | null | undefined;
  if (!(antesConv && FORCA[antesConv] > FORCA[origem]))
    await db
      .from("conversas")
      .update({ nome_confirmado: nome, nome_confirmado_origem: origem })
      .eq("id", ids.conversaId)
      .eq("empresa_id", ids.empresaId);
  let perfil: string | null = null;
  if (ids.contatoId) {
    await gravarNoContato(db, ids.empresaId, ids.contatoId, nome, origem);
    const { data: c } = await db
      .from("whatsapp_contacts")
      .select("profile_name")
      .eq("id", ids.contatoId)
      .maybeSingle();
    perfil = c?.profile_name ?? null;
  }
  if (ids.leadId) {
    const { data: lead } = await db
      .from("crm_leads")
      .select("lead_name")
      .eq("id", ids.leadId)
      .eq("empresa_id", ids.empresaId)
      .maybeSingle();
    const atual = (lead?.lead_name ?? "").trim();
    if (!atual || atual === (perfil ?? "").trim() || atual === "Cliente do WhatsApp")
      await db
        .from("crm_leads")
        .update({ lead_name: nome })
        .eq("id", ids.leadId)
        .eq("empresa_id", ids.empresaId);
  }
  return {
    erro: false,
    texto: `Nome registrado: ${nome}. Chame de ${primeiroNomeLimpo(nome)}.`,
  };
}

/** Nome confirmado da conversa (ou do contato), para orçamento, OS e modelos; null se não houver. */
export async function nomeConfirmado(
  db: Db,
  empresaId: string,
  conversaId: string | null,
  contatoId: string | null,
): Promise<string | null> {
  if (conversaId) {
    const { data } = await db
      .from("conversas")
      .select("nome_confirmado, whatsapp_contact_id")
      .eq("id", conversaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (data?.nome_confirmado) return data.nome_confirmado;
    contatoId = contatoId ?? data?.whatsapp_contact_id ?? null;
  }
  if (!contatoId) return null;
  const { data: c } = await db
    .from("whatsapp_contacts")
    .select("nome_confirmado")
    .eq("id", contatoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return c?.nome_confirmado ?? null;
}

/** Depois da OS: o nome completo que o cliente deu vale como confirmado, se ainda não houver. */
export async function nomeDaOs(
  db: Db,
  ids: { empresaId: string; conversaId: string; contatoId: string | null; leadId: string | null },
  nomeCompleto: string,
): Promise<void> {
  const ja = await nomeConfirmado(db, ids.empresaId, ids.conversaId, ids.contatoId);
  if (ja) return;
  await registrarNomeCliente(db, ids, "cliente_informou", nomeCompleto);
}
