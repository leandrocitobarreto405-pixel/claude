import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Usuário-robô da Nexa para tarefas automáticas (despesas recorrentes, fechamento de km).
 *
 * Em vez da chave de serviço (que ignora o RLS), as tarefas entram como um usuário comum
 * com papel nexa_admin e escolhem a empresa pelo cabeçalho x-empresa-id — assim cada
 * execução só enxerga e grava dados daquela empresa, pelas mesmas regras do app.
 *
 * Variáveis: NEXA_ROBO_EMAIL, NEXA_ROBO_SENHA (usuário criado no Supabase Auth e cadastrado
 * em plataforma_usuarios como nexa_admin).
 */

let sessao: { token: string; expiraEm: number } | null = null;

function ambiente() {
  const url = process.env["SUPABASE_URL"];
  const chave = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const email = process.env["NEXA_ROBO_EMAIL"];
  const senha = process.env["NEXA_ROBO_SENHA"];
  if (!url || !chave || !email || !senha) {
    throw new Error(
      "Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, NEXA_ROBO_EMAIL e NEXA_ROBO_SENHA para as tarefas automáticas.",
    );
  }
  return { url, chave, email, senha };
}

async function tokenDoRobo(): Promise<string> {
  if (sessao && sessao.expiraEm - Date.now() > 60_000) return sessao.token;
  const { url, chave, email, senha } = ambiente();
  const auth = createClient<Database>(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email, password: senha });
  if (error || !data.session) {
    throw new Error(
      `Não foi possível autenticar o usuário-robô: ${error?.message ?? "sem sessão"}`,
    );
  }
  sessao = {
    token: data.session.access_token,
    expiraEm: (data.session.expires_at ?? 0) * 1000,
  };
  return sessao.token;
}

/** Cliente do banco como robô; com empresaId, restrito àquela empresa pelo RLS. */
export async function clienteDoRobo(empresaId?: string): Promise<SupabaseClient<Database>> {
  const { url, chave } = ambiente();
  const token = await tokenDoRobo();
  return createClient<Database>(url, chave, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(empresaId ? { "x-empresa-id": empresaId } : {}),
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Executa a tarefa em cada empresa ativa, isoladamente. Falha de uma não interrompe as outras. */
export async function paraCadaEmpresa<T>(
  tarefa: (db: SupabaseClient<Database>, empresa: { id: string; nome: string }) => Promise<T>,
) {
  const robo = await clienteDoRobo();
  const { data: empresas, error } = await robo
    .from("empresas")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome");
  if (error) throw error;

  const resultados: Array<{ empresa: string; ok: boolean; resultado?: T; erro?: string }> = [];
  for (const empresa of empresas ?? []) {
    try {
      const db = await clienteDoRobo(empresa.id);
      resultados.push({ empresa: empresa.nome, ok: true, resultado: await tarefa(db, empresa) });
    } catch (e) {
      resultados.push({
        empresa: empresa.nome,
        ok: false,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return resultados;
}

/** Autenticação das rotas de tarefa: cabeçalho Authorization: Bearer <NEXA_TAREFAS_SEGREDO>. */
export function tarefaAutorizada(request: Request): boolean {
  const segredo = process.env["NEXA_TAREFAS_SEGREDO"];
  if (!segredo || segredo.length < 32) return false;
  const recebido = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (recebido.length !== segredo.length) return false;
  let diff = 0;
  for (let i = 0; i < segredo.length; i++) diff |= recebido.charCodeAt(i) ^ segredo.charCodeAt(i);
  return diff === 0;
}
