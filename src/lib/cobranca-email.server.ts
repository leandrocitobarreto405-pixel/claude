// E-mail de cobrança (fatura vencida) para os admins da empresa. Nasce DESLIGADO:
// configuracoes_plataforma.cobranca_emails_ativo = true liga (Painel Nexa › Assinaturas).
import type { Db } from "@/lib/mkt/contexto.server";
import { brl, dateBR } from "@/lib/format";
import { enderecoDoApp } from "@/lib/enderecos";

export async function avisarFaturaVencida(db: Db, faturaId: string): Promise<number> {
  const { data: liga } = await db
    .from("configuracoes_plataforma")
    .select("valor")
    .eq("chave", "cobranca_emails_ativo")
    .maybeSingle();
  if (liga?.valor !== true) return 0;
  const chave = process.env["RESEND_API_KEY"];
  if (!chave) return 0;

  const { data: f } = await db
    .from("faturas")
    .select("empresa_id, valor, vencimento, link_pagamento")
    .eq("id", faturaId)
    .maybeSingle();
  if (!f) return 0;
  const { data: emp } = await db
    .from("empresas")
    .select("nome")
    .eq("id", f.empresa_id)
    .maybeSingle();
  const empresa = emp?.nome ?? "sua empresa";
  const { data: admins } = await db
    .from("usuarios_empresa")
    .select("user_id")
    .eq("empresa_id", f.empresa_id)
    .eq("papel", "admin");
  const emails: string[] = [];
  for (const a of admins ?? []) {
    const { data } = await db.auth.admin.getUserById(a.user_id);
    if (data.user?.email) emails.push(data.user.email);
  }
  if (emails.length === 0) return 0;

  const link = f.link_pagamento ?? `${enderecoDoApp()}/configuracoes/empresa`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env["EMAIL_REMETENTE"] || "Nexa OS <nao-responda@nexaperformanceos.com.br>",
      to: emails,
      subject: `Fatura do Nexa OS vencida (${empresa})`,
      text: [
        `A fatura do Nexa OS de ${empresa}, no valor de ${brl(f.valor)}, venceu em ${dateBR(f.vencimento)}.`,
        "",
        `Pague por aqui: ${link}`,
        "Depois de 7 dias de atraso, o app fica em modo somente leitura até o pagamento.",
        "Se já pagou, pode ignorar este e-mail.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return res?.ok ? emails.length : 0;
}
