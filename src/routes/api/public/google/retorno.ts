import { createFileRoute } from "@tanstack/react-router";

/**
 * Retorno da autorização do Google (Configurações → Conectar conta Google).
 *
 * O "state" é assinado pelo servidor e traz a empresa, o usuário e o endereço de retorno; aqui
 * ele é conferido, o usuário precisa continuar administrador da empresa, e o token de renovação
 * é guardado em google_conexao_segredos (só a chave de serviço lê).
 */
export const Route = createFileRoute("/api/public/google/retorno")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        try {
          return voltar(await concluir(url));
        } catch (erro) {
          console.error("Google: erro ao concluir a conexão:", erro);
          return voltar({ google: "erro", motivo: "falha" });
        }
      },
    },
  },
});

/** Volta para a tela de configurações (endereço relativo: mesmo host do retorno). */
function voltar(params: Record<string, string>) {
  const alvo = `/configuracoes?${new URLSearchParams({ aba: "documentos", ...params })}`;
  return new Response(null, { status: 302, headers: { Location: alvo } });
}

async function concluir(url: URL): Promise<Record<string, string>> {
  const {
    credenciaisGoogle,
    lerEstado,
    trocarCodigo,
    emailDoIdToken,
    esquecerTokenGoogle,
    ESCOPOS_OBRIGATORIOS,
  } = await import("@/lib/google-auth.server");

  const credenciais = credenciaisGoogle();
  const estado = credenciais
    ? lerEstado(url.searchParams.get("state") ?? "", credenciais.segredo)
    : null;
  if (!estado) return { google: "erro", motivo: "expirado" };

  if (url.searchParams.get("error")) return { google: "erro", motivo: "cancelado" };
  const codigo = url.searchParams.get("code");
  if (!codigo) return { google: "erro", motivo: "cancelado" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: vinculo }, { data: nexa }] = await Promise.all([
    supabaseAdmin
      .from("usuarios_empresa")
      .select("papel")
      .eq("user_id", estado.userId)
      .eq("empresa_id", estado.empresaId)
      .maybeSingle(),
    supabaseAdmin
      .from("plataforma_usuarios")
      .select("papel")
      .eq("user_id", estado.userId)
      .eq("papel", "nexa_admin")
      .eq("ativo", true)
      .maybeSingle(),
  ]);
  if (vinculo?.papel !== "admin" && !nexa) {
    return { google: "erro", motivo: "sem_permissao" };
  }

  const token = await trocarCodigo(codigo, estado.redirectUri);
  if (!token.refresh_token) return { google: "erro", motivo: "sem_token" };
  const escopos = (token.scope ?? "").split(" ").filter(Boolean);

  const { error: erroConexao } = await supabaseAdmin.from("google_conexoes").upsert(
    {
      empresa_id: estado.empresaId,
      email: emailDoIdToken(token.id_token),
      escopos,
      situacao: "conectada",
      erro: null,
      conectado_por: estado.userId,
      conectado_em: new Date().toISOString(),
    },
    { onConflict: "empresa_id" },
  );
  if (erroConexao) throw erroConexao;
  const { error: erroSegredo } = await supabaseAdmin.from("google_conexao_segredos").upsert(
    {
      empresa_id: estado.empresaId,
      refresh_token: token.refresh_token,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "empresa_id" },
  );
  if (erroSegredo) throw erroSegredo;
  esquecerTokenGoogle(estado.empresaId);

  const faltando = ESCOPOS_OBRIGATORIOS.some((e) => !escopos.includes(e));
  return { google: faltando ? "parcial" : "conectado" };
}
