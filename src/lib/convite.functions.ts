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

const PAPEIS: Record<Papel, string> = {
  admin: "Administrador",
  atendente: "Atendente",
  tecnico: "Técnico",
};

/** Endereço do app nos links (run.app por enquanto; troca quando o domínio estiver no ar). */
export function enderecoDoApp(): string {
  return (
    process.env["APP_URL_PUBLICA"] || "https://nexaos-980094719320.southamerica-east1.run.app"
  ).replace(/\/+$/, "");
}

export type ResultadoConvite = {
  /** e-mail do convite saiu; aviso de acesso saiu; já tem conta e não deu para avisar por e-mail. */
  envio: "convite_enviado" | "aviso_enviado" | "ja_tem_conta" | "falhou";
  /** Motivo, quando o e-mail não saiu (sem dados sensíveis). */
  detalhe: string | null;
};

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

const escapar = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const convidarPorEmailFn = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { email: string; papel: Papel; reenviar?: boolean }) => {
    const email = String(i.email ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
      throw new Error("Informe um e-mail válido.");
    if (!(i.papel in PAPEIS)) throw new Error("Papel inválido.");
    return { email, papel: i.papel, reenviar: Boolean(i.reenviar) };
  })
  .handler(async ({ data, context }): Promise<ResultadoConvite> => {
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
    if (!error) return { envio: "convite_enviado", detalhe: null };
    if (!jaTemConta(error as never))
      return { envio: "falhou", detalhe: "O servidor de e-mail não aceitou o convite agora." };

    // 3. Já tem conta: aviso pelo Resend, se a chave estiver no servidor.
    if (await avisoPorResend(data.email, empresa, papel))
      return { envio: "aviso_enviado", detalhe: null };
    return { envio: "ja_tem_conta", detalhe: null };
  });
