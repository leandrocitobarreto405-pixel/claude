// Faturas da assinatura pelo Asaas (Fase B, item 3). Só a Nexa gera fatura; o banco recusa fatura
// sem valor ou para assinatura sem mensalidade, e aqui a conferência vem antes de chamar o Asaas.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { competenciaDoMes, descricaoFatura, motivoSemFatura } from "@/lib/asaas";

async function exigirNexa(supabase: { rpc: (fn: never) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("sou_admin_nexa" as never);
  if (data !== true) throw new Error("Só a Nexa gera faturas.");
}

/** Asaas ligado? (sem mostrar a chave) */
export const situacaoAsaasFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirNexa(context.supabase);
    const { asaasConfigurado, ambienteAtual } = await import("@/lib/asaas.server");
    return {
      configurado: asaasConfigurado(),
      webhook: Boolean(process.env["ASAAS_WEBHOOK_TOKEN"]),
      ambiente: ambienteAtual(),
    };
  });

/** Gera a fatura de um mês para a assinatura vigente da empresa. */
export const gerarFaturaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { empresaId: string; mes: string; vencimento: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(i.empresaId))) throw new Error("Empresa inválida.");
    const competencia = competenciaDoMes(String(i.mes));
    if (!competencia) throw new Error("Mês inválido.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(i.vencimento))) throw new Error("Vencimento inválido.");
    return { empresaId: String(i.empresaId), competencia, vencimento: String(i.vencimento) };
  })
  .handler(async ({ data, context }) => {
    await exigirNexa(context.supabase);
    const { dbServico } = await import("@/lib/mkt/contexto.server");
    const db = await dbServico();

    const { data: a, error } = await db
      .from("assinaturas")
      .select("id, plano_id, status, valor_mensal, gateway_cliente_id")
      .eq("empresa_id", data.empresaId)
      .is("vigencia_fim", null)
      .maybeSingle();
    if (error) throw new Error("Não foi possível ler a assinatura.");
    const [{ data: plano }, { data: empresa }] = await Promise.all([
      db
        .from("planos")
        .select("nome, preco_mensal")
        .eq("id", a?.plano_id ?? "")
        .maybeSingle(),
      db.from("empresas").select("nome, cnpj").eq("id", data.empresaId).maybeSingle(),
    ]);
    const valor =
      a?.valor_mensal !== null && a?.valor_mensal !== undefined
        ? Number(a.valor_mensal)
        : plano?.preco_mensal === null || plano?.preco_mensal === undefined
          ? null
          : Number(plano.preco_mensal);
    const motivo = motivoSemFatura(valor, a?.status);
    if (motivo || !a || valor === null) throw new Error(motivo ?? "Sem assinatura.");

    const { count } = await db
      .from("faturas")
      .select("id", { count: "exact", head: true })
      .eq("assinatura_id", a.id)
      .eq("competencia", data.competencia)
      .not("status", "in", "(cancelada,estornada)");
    if ((count ?? 0) > 0) throw new Error("Já existe fatura deste mês.");

    const asaas = await import("@/lib/asaas.server");
    if (!asaas.asaasConfigurado())
      throw new Error("Asaas ainda não configurado: falta ligar a chave no Cloud Run.");

    let clienteId = a.gateway_cliente_id;
    if (!clienteId) {
      clienteId = await asaas.criarClienteAsaas({
        nome: empresa?.nome ?? "Empresa",
        cnpj: empresa?.cnpj ?? null,
        empresaId: data.empresaId,
      });
      await db
        .from("assinaturas")
        .update({ gateway: "asaas", gateway_cliente_id: clienteId })
        .eq("id", a.id);
    }

    const faturaId = crypto.randomUUID();
    const cobranca = await asaas.criarCobrancaAsaas({
      clienteId,
      valor,
      vencimento: data.vencimento,
      descricao: descricaoFatura(plano?.nome ?? "Assinatura", data.competencia),
      faturaId,
    });
    const { error: erroFatura } = await db.from("faturas").insert({
      id: faturaId,
      empresa_id: data.empresaId,
      assinatura_id: a.id,
      competencia: data.competencia,
      valor,
      vencimento: data.vencimento,
      gateway_cobranca_id: cobranca.id,
      link_pagamento: cobranca.invoiceUrl,
      boleto_url: cobranca.bankSlipUrl,
      created_by: context.userId,
    });
    if (erroFatura) {
      // Não deixa cobrança solta no Asaas sem fatura aqui.
      await asaas.apagarCobrancaAsaas(cobranca.id).catch(() => undefined);
      throw new Error(`O banco recusou a fatura: ${erroFatura.message}`);
    }
    return { faturaId, link: cobranca.invoiceUrl };
  });
