/**
 * Marketing na conversa da Alice: de qual disparo o cliente veio (campanha, grupo, modelo,
 * condição), indicação (quem indicou, crédito) e os descontos que ela pode aplicar.
 *
 * Descontos permitidos além do Pix (regras da empresa, calculados aqui e não pelo modelo):
 *  - campanha: a condição em % da campanha do disparo que o cliente recebeu (até 30 dias), válida
 *    até 7 dias depois da última data de disparo da campanha;
 *  - indicação: o % de quem foi indicado (primeiro serviço) ou o crédito de quem indicou.
 * Nunca os dois juntos (a ferramenta aceita um tipo só).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;
type Ctx = {
  admin: Admin;
  empresaId: string;
  leadId: string | null;
  contatoId: string | null;
  agora: Date;
};

/** Telefone com e sem o 9º dígito (o WhatsApp manda alguns celulares sem ele). */
export function variantesTelefone(fone: string | null | undefined): string[] {
  const d = String(fone ?? "").replace(/\D/g, "");
  if (d.length < 10) return [];
  const n = d.length <= 11 ? `55${d}` : d;
  const ddd = n.slice(2, 4);
  const ult8 = n.slice(-8);
  return [...new Set([n, `55${ddd}${ult8}`, `55${ddd}9${ult8}`])];
}

const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const somarDias = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const hojeSP = (agora: Date) =>
  agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export type Marketing = {
  contato: {
    id: string;
    nome: string | null;
    primeiro_nome: string | null;
    tipo: string;
    grupo_atual: string | null;
    credito_indicacao_pct: number;
    optout_em: string | null;
  } | null;
  envio: {
    grupo: string | null;
    template_nome: string;
    enviado_em: string;
    botao_clicado: string | null;
    campanha: {
      nome: string;
      tema: string | null;
      tipo: string;
      gatilho: string | null;
      condicao_texto: string | null;
      condicao_pct: number | null;
      datas_disparo: string[];
    } | null;
  } | null;
  /** Condição da campanha ainda vale (até esta data). */
  condicaoValidaAte: string | null;
  indicadoPor: { nome: string | null; pct: number } | null;
  linkAvaliacao: string | null;
};

async function telefoneDaConversa(ctx: Ctx) {
  if (ctx.contatoId) {
    const { data } = await ctx.admin
      .from("whatsapp_contacts")
      .select("normalized_phone")
      .eq("id", ctx.contatoId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();
    if (data?.normalized_phone) return data.normalized_phone;
  }
  if (ctx.leadId) {
    const { data } = await ctx.admin
      .from("crm_leads")
      .select("normalized_phone")
      .eq("id", ctx.leadId)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();
    return data?.normalized_phone ?? null;
  }
  return null;
}

export async function lerMarketing(ctx: Ctx): Promise<Marketing> {
  const vazio: Marketing = {
    contato: null,
    envio: null,
    condicaoValidaAte: null,
    indicadoPor: null,
    linkAvaliacao: null,
  };
  const fones = variantesTelefone(await telefoneDaConversa(ctx));
  const { data: cfg } = await ctx.admin
    .from("mkt_configuracoes")
    .select("link_avaliacao_google")
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  vazio.linkAvaliacao = cfg?.link_avaliacao_google ?? null;
  if (!fones.length) return vazio;

  const [{ data: contato }, { data: ind }] = await Promise.all([
    ctx.admin
      .from("mkt_contatos")
      .select("id, nome, primeiro_nome, tipo, grupo_atual, credito_indicacao_pct, optout_em")
      .eq("empresa_id", ctx.empresaId)
      .in("normalized_phone", fones)
      .limit(1)
      .maybeSingle(),
    ctx.admin
      .from("indicacoes")
      .select("desconto_indicado_pct, mkt_contatos!indicacoes_indicador_contato_id_fkey(nome)")
      .eq("empresa_id", ctx.empresaId)
      .in("indicado_phone", fones)
      .is("indicado_usou_em", null)
      .order("criada_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const m: Marketing = { ...vazio };
  if (ind) {
    const indicador = ind.mkt_contatos as unknown as { nome: string | null } | null;
    m.indicadoPor = { nome: indicador?.nome ?? null, pct: Number(ind.desconto_indicado_pct) };
  }
  if (!contato) return m;
  m.contato = { ...contato, credito_indicacao_pct: Number(contato.credito_indicacao_pct) };

  const desde = new Date(ctx.agora.getTime() - 30 * 86400_000).toISOString();
  const { data: envio } = await ctx.admin
    .from("mkt_envios")
    .select(
      "grupo, template_nome, enviado_em, botao_clicado, mkt_campanhas(nome, tema, tipo, gatilho, condicao_texto, condicao_pct, datas_disparo)",
    )
    .eq("empresa_id", ctx.empresaId)
    .eq("contato_id", contato.id)
    .eq("status", "enviado")
    .gte("enviado_em", desde)
    .order("enviado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (envio?.enviado_em) {
    const campanha = envio.mkt_campanhas as unknown as NonNullable<Marketing["envio"]>["campanha"];
    m.envio = {
      grupo: envio.grupo,
      template_nome: envio.template_nome,
      enviado_em: envio.enviado_em,
      botao_clicado: envio.botao_clicado,
      campanha,
    };
    if (campanha && (campanha.condicao_texto || campanha.condicao_pct)) {
      const ultima =
        campanha.tipo === "calendario" && campanha.datas_disparo?.length
          ? [...campanha.datas_disparo].sort().at(-1)!
          : envio.enviado_em.slice(0, 10);
      const ate = somarDias(ultima, 7);
      if (hojeSP(ctx.agora) <= ate) m.condicaoValidaAte = ate;
    }
  }
  return m;
}

/** Linhas para o consultar_cliente. */
export function textoMarketing(m: Marketing): string[] {
  const l: string[] = [];
  if (m.contato) {
    l.push(
      `Base de marketing: ${m.contato.tipo === "comprador" ? "comprador" : "não comprador"}${
        m.contato.grupo_atual ? `, grupo ${m.contato.grupo_atual}` : ""
      }${m.contato.optout_em ? "; pediu para não receber ofertas" : ""}.`,
    );
  }
  if (m.envio) {
    const k = m.envio.campanha;
    l.push(
      `Veio de disparo de marketing: ${
        k?.tipo === "gatilho" ? `mensagem automática ${k.gatilho}` : `campanha "${k?.nome ?? "-"}"`
      }${k?.tema ? ` (tema: ${k.tema})` : ""}, grupo ${m.envio.grupo ?? "-"}, modelo ${m.envio.template_nome}, enviada em ${dia(
        m.envio.enviado_em,
      )}${m.envio.botao_clicado ? `; botão clicado: "${m.envio.botao_clicado}"` : ""}.`,
    );
    if (k?.condicao_texto || k?.condicao_pct) {
      const cond = [k.condicao_texto, k.condicao_pct ? `${k.condicao_pct}%` : null]
        .filter(Boolean)
        .join(" — ");
      l.push(
        m.condicaoValidaAte
          ? `Condição da campanha: ${cond} (vale até ${dia(m.condicaoValidaAte)}; no orçamento use desconto "campanha").`
          : `Condição da campanha: ${cond} (já venceu; não ofereça).`,
      );
    } else if (k) {
      l.push("Campanha sem condição especial (só o desconto do Pix).");
    }
  }
  if (m.indicadoPor) {
    l.push(
      `Foi indicado por ${m.indicadoPor.nome ?? "um cliente"}: ${m.indicadoPor.pct}% no primeiro serviço (no orçamento use desconto "indicacao").`,
    );
  }
  if (m.contato && m.contato.credito_indicacao_pct > 0) {
    l.push(
      `Crédito de indicação: ${m.contato.credito_indicacao_pct}% no próximo serviço (no orçamento use desconto "indicacao").`,
    );
  }
  if (m.linkAvaliacao)
    l.push(`Link da avaliação no Google (use no lugar de [link]): ${m.linkAvaliacao}`);
  return l;
}

export type Desconto = { pct: number; rotulo: string } | { erro: string };

export function descontoPermitido(m: Marketing, tipo: "campanha" | "indicacao"): Desconto {
  if (tipo === "campanha") {
    const k = m.envio?.campanha;
    if (!k)
      return {
        erro: "Este cliente não veio de um disparo de marketing recente: sem desconto de campanha.",
      };
    if (!k.condicao_pct)
      return {
        erro: k.condicao_texto
          ? `A condição da campanha não é um percentual ("${k.condicao_texto}"): não entra no orçamento. Transfira se o cliente pedir.`
          : "A campanha não tem condição especial: só o desconto do Pix.",
      };
    if (!m.condicaoValidaAte) return { erro: "A condição da campanha já venceu." };
    return { pct: Number(k.condicao_pct), rotulo: `Condição da campanha ${k.nome}` };
  }
  if (m.indicadoPor)
    return { pct: m.indicadoPor.pct, rotulo: "Desconto de indicação (primeiro serviço)" };
  if (m.contato && m.contato.credito_indicacao_pct > 0)
    return { pct: m.contato.credito_indicacao_pct, rotulo: "Crédito de indicação" };
  return { erro: "Este cliente não tem desconto de indicação." };
}

/** Indicação feita pelo cliente da conversa: grava e pré-cadastra o indicado na base. */
export async function registrarIndicacao(
  ctx: Ctx,
  input: { nome: string; telefone: string },
): Promise<{ erro: boolean; texto: string }> {
  const foneConversa = await telefoneDaConversa(ctx);
  const doIndicador = variantesTelefone(foneConversa);
  const doIndicado = variantesTelefone(input.telefone);
  if (!doIndicado.length)
    return { erro: true, texto: "Telefone do indicado inválido: peça com DDD." };
  if (!doIndicador.length)
    return { erro: true, texto: "Não sei o telefone de quem está indicando." };
  if (doIndicado.some((f) => doIndicador.includes(f)))
    return { erro: true, texto: "O cliente não pode indicar o próprio telefone." };

  const { data: lead } = ctx.leadId
    ? await ctx.admin
        .from("crm_leads")
        .select("lead_name, customer_id")
        .eq("id", ctx.leadId)
        .eq("empresa_id", ctx.empresaId)
        .maybeSingle()
    : { data: null };
  const rpc = ctx.admin.rpc as unknown as (
    n: string,
    a: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  // Garante os dois na base de marketing (comprador continua comprador).
  const hoje = hojeSP(ctx.agora);
  const { error: e1 } = await rpc.call(ctx.admin, "mkt_importar_contatos", {
    _emp: ctx.empresaId,
    _linhas: [
      {
        telefone: foneConversa,
        nome: lead?.lead_name ?? null,
        tipo: lead?.customer_id ? "comprador" : "nao_comprador",
      },
      { telefone: input.telefone, nome: input.nome, tipo: "nao_comprador", entrada_em: hoje },
    ],
    _origem: "indicação (Alice)",
  });
  if (e1) throw new Error(e1.message);
  const [{ data: indicador }, { data: indicado }] = await Promise.all([
    ctx.admin
      .from("mkt_contatos")
      .select("id")
      .eq("empresa_id", ctx.empresaId)
      .in("normalized_phone", doIndicador)
      .limit(1)
      .maybeSingle(),
    ctx.admin
      .from("mkt_contatos")
      .select("id, tipo, indicado_por_contato_id")
      .eq("empresa_id", ctx.empresaId)
      .in("normalized_phone", doIndicado)
      .limit(1)
      .maybeSingle(),
  ]);
  if (!indicador || !indicado) throw new Error("contato não ficou na base de marketing");
  const { data: jaExiste } = await ctx.admin
    .from("indicacoes")
    .select("id, indicador_contato_id")
    .eq("empresa_id", ctx.empresaId)
    .in("indicado_phone", doIndicado)
    .limit(1)
    .maybeSingle();
  if (jaExiste) {
    return {
      erro: false,
      texto:
        jaExiste.indicador_contato_id === indicador.id
          ? `${input.nome} já estava indicado por este cliente. Nada a fazer.`
          : `${input.nome} já tinha sido indicado por outra pessoa; a indicação continua com quem indicou primeiro.`,
    };
  }
  if (indicado.tipo === "comprador") {
    return {
      erro: false,
      texto: `${input.nome} já é cliente da empresa: não entra como indicação nova. Agradeça mesmo assim.`,
    };
  }
  const { error: e2 } = await ctx.admin.from("indicacoes").insert({
    empresa_id: ctx.empresaId,
    indicador_contato_id: indicador.id,
    indicado_contato_id: indicado.id,
    indicado_nome: input.nome,
    indicado_phone: doIndicado[0]!,
  });
  if (e2) throw new Error(e2.message);
  if (!indicado.indicado_por_contato_id) {
    await ctx.admin
      .from("mkt_contatos")
      .update({ indicado_por_contato_id: indicador.id })
      .eq("id", indicado.id);
  }
  return {
    erro: false,
    texto: `Indicação registrada: ${input.nome} ganha 15% no primeiro serviço e o cliente ganha 15% no próximo quando ${input.nome} fechar. Agradeça ao cliente.`,
  };
}
