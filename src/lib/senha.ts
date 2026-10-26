// Regra mínima de senha (Supabase no plano grátis não tem a proteção contra senha vazada):
// pelo menos 8 caracteres, com letra e número. Vale no cadastro e na troca de senha.
export const REGRA_SENHA = "mínimo de 8 caracteres, com letra e número";

/** Motivo da recusa, ou null se a senha serve. */
export function problemaDaSenha(senha: string): string | null {
  if (senha.length < 8) return "A senha precisa ter no mínimo 8 caracteres.";
  if (!/\p{L}/u.test(senha)) return "A senha precisa ter pelo menos uma letra.";
  if (!/\d/.test(senha)) return "A senha precisa ter pelo menos um número.";
  return null;
}
