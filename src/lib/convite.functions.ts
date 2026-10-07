/**
 * Convite por e-mail. Pessoa sem conta: convite do Supabase (modelo "Invite user", com a empresa e
 * o papel) com link para criar a senha e entrar. Pessoa que já tem conta: aviso pelo Resend (se a
 * chave estiver no servidor) ou mensagem na tela; a empresa aparece no próximo login. Em todos os
 * casos o convite fica registrado em convites_empresa, como antes, e o WhatsApp/copiar continuam.
 * A chave do Resend nunca aparece em log, erro ou tela.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa } from "@/lib/empresa.middleware";
import type { Papel } from "@/lib/tenant";
import { enderecoDoApp } from "@/lib/enderecos";

const PAPEIS: Record<Papel, string> = {
  admin: "Administrador",
  atendente: "Atendente",
  tecnico: "Técnico",
};

export type ResultadoConvite = {
  /** e-mail do convite saiu; aviso de acesso saiu; já tem conta e não deu para avisar por e-mail. */
  envio: "convite_enviado" | "aviso_enviado" | "ja_tem_conta" | "falhou";
  /** Motivo, quando o e-mail não saiu (sem dados sensíveis). */
  detalhe: string | null;
  /** Técnico criado/ligado no convite (para subir a foto em seguida). */
  tecnicoId?: string | null;
};

/** Dados da equipe no próprio convite: vendedora (atendente) ou técnico. */
export type EquipeNoConvite = { nome: string; comissao?: number | null; endereco?: string | null };

/** O Supabase recusou porque o e-mail já tem conta? */
function jaTemConta(e: { message?: string; code?: string; status?: number } | null): boolean {
  if (!e) return false;
  return (
    e.code === "email_exists" ||
    e.status === 422 ||
    /already (been )?registered|already exists/i.test(e.message ?? "")
  );
}

async function avisoPorResend(para: string, empresa: string, papel: string): Promise<boolean> {
  const chave = process.env["RESEND_API_KEY"];
  if (!chave) return false;
  const link = `${enderecoDoApp()}/auth`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env["EMAIL_REMETENTE"] || "Nexa OS <nao-responda@nexaperformanceos.com.br>",
      to: [para],
      subject: `Você recebeu acesso à empresa ${empresa} no Nexa OS`,
      text: [
        `Olá! Você recebeu acesso à empresa ${empresa} no Nexa OS como ${papel}.`,
        "",
        `Entre com o seu e-mail e a senha de sempre: ${link}`,
        "A empresa aparece na lista de empresas depois de entrar.",
        "",
        "Se você não esperava este e-mail, pode ignorar.",
      ].join("\n"),
      html: `<p>Olá! Você recebeu acesso à empresa <b>${escapar(empresa)}</b> no Nexa OS como <b>${escapar(papel)}</b>.</p>
<p><a href="${link}">Entrar no Nexa OS</a> com o seu e-mail e a senha de sempre. A empresa aparece na lista de empresas depois de entrar.</p>
<p style="color:#666">Se você não esperava este e-mail, pode ignorar.</p>`,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/**
 * Liga (pelo e-mail ou pelo mesmo nome, sem login) ou cria a vendedora/técnico do convite.
 * Usa o cliente da pessoa logada: o banco só aceita na empresa ativa, e só o admin chega aqui.
 */
async function prepararEquipe(
  supabase: unknown,
  email: string,
  papel: Papel,
  e: { nome: string; comissao: number | null; endereco: string | null },
): Promise<string | null> {
  const db = supabase as import("@supabase/supabase-js").SupabaseClient;
  const tabela = papel === "atendente" ? "salespeople" : "technicians";
  const { data: existentes, error } = await db.from(tabela).select("id, name, email, user_id");
  if (error) throw new Error("Não foi possível conferir a equipe.");
  const lista = (existentes ?? []) as Array<{
    id: string;
    name: string;
    email: string | null;
    user_id: string | null;
  }>;
  const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // Mesmo e-mail (com ou sem login) é a mesma pessoa; mesmo nome só se ainda não tem login.
  const achado =
    lista.find((x) => x.email && igual(x.email, email)) ??
    lista.find((x) => !x.user_id && igual(x.name, e.nome));
  const campos: Record<string, unknown> = { name: e.nome, email, active: true };
  if (papel === "atendente" && e.comissao !== null) campos["commission_percentage"] = e.comissao;
  if (papel === "tecnico" && e.endereco) campos["base_address"] = e.endereco;
  if (achado) {
    const { error: e2 } = await db.from(tabela).update(campos).eq("id", achado.id);
    if (e2) throw new Error("Não foi possível atualizar a equipe.");
    return papel === "tecnico" ? achado.id : null;
  }
  const { data: criado, error: e3 } = await db.from(tabela).insert(campos).select("id").single();
  if (e3) throw new Error("Não foi possível cadastrar na equipe.");
  return papel === "tecnico" ? (criado as { id: string }).id : null;
}

const escapar = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const convidarPorEmailFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (i: { email: string; papel: Papel; reenviar?: boolean; equipe?: EquipeNoConvite | null }) => {
      const email = String(i.email ?? "")
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
        throw new Error("Informe um e-mail válido.");
      if (!(i.papel in PAPEIS)) throw new Error("Papel inválido.");
      const nome = String(i.equipe?.nome ?? "")
        .trim()
        .slice(0, 80);
      const comissao =
        i.equipe?.comissao === null || i.equipe?.comissao === undefined
          ? null
          : Number(i.equipe.comissao);
      if (comissao !== null && (!Number.isFinite(comissao) || comissao < 0 || comissao > 100))
        throw new Error("A comissão vai de 0% a 100%.");
      const equipe =
        (i.papel === "atendente" || i.papel === "tecnico") && nome
          ? {
              nome,
              comissao,
              endereco:
                String(i.equipe?.endereco ?? "")
                  .trim()
                  .slice(0, 300) || null,
            }
          : null;
      return { email, papel: i.papel, reenviar: Boolean(i.reenviar), equipe };
    },
  )
  .handler(async ({ data, context }): Promise<ResultadoConvite> => {
    // 0. Vendedora/técnico com o nome e a comissão/endereço do convite, ligado pelo e-mail. Vem
    //    antes do convite: quando a pessoa entra na empresa, o banco liga este cadastro (não cria outro).
    let tecnicoId: string | null = null;
    if (!data.reenviar && data.equipe) {
      tecnicoId = await prepararEquipe(context.supabase, data.email, data.papel, data.equipe);
    }
    // 1. Registra o convite como hoje (o banco confere que quem pede é admin da empresa).
    if (!data.reenviar) {
      const { error } = await context.supabase.rpc(
        "convidar_usuario" as never,
        { _email: data.email, _papel: data.papel } as never,
      );
      if (error) throw new Error("Não foi possível registrar o convite.");
    }
    const { data: emp } = await context.supabase
      .from("empresas")
      .select("nome")
      .eq("id", context.empresaId)
      .maybeSingle();
    const empresa = emp?.nome ?? "sua empresa";
    const papel = PAPEIS[data.papel];

    // 2. E-mail de convite do Supabase (modelo "Invite user" com {{ .Data.empresa }} e {{ .Data.papel }}).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { empresa, papel },
      redirectTo: `${enderecoDoApp()}/redefinir-senha`,
    });
    if (!error) return { envio: "convite_enviado", detalhe: null, tecnicoId };
    if (!jaTemConta(error as never))
      return {
        envio: "falhou",
        detalhe: "O servidor de e-mail não aceitou o convite agora.",
        tecnicoId,
      };

    // 3. Já tem conta: aviso pelo Resend, se a chave estiver no servidor.
    if (await avisoPorResend(data.email, empresa, papel))
      return { envio: "aviso_enviado", detalhe: null, tecnicoId };
    return { envio: "ja_tem_conta", detalhe: null, tecnicoId };
  });
