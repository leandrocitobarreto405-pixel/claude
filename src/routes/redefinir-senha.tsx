import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ensureAccess } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  head: () => ({ meta: [{ title: "Nova senha — Nexa OS" }] }),
  component: RedefinirSenha,
});

/**
 * Destino do link de "Esqueci minha senha": o Supabase abre esta página já com a sessão de
 * recuperação; a pessoa escolhe a nova senha e entra.
 */
function RedefinirSenha() {
  const navigate = useNavigate();
  const [pronto, setPronto] = useState<"esperando" | "ok" | "invalido">("esperando");
  const [senha, setSenha] = useState("");
  const [repetir, setRepetir] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (evento === "PASSWORD_RECOVERY" || (sessao && evento === "SIGNED_IN")) setPronto("ok");
    });
    // O link pode já ter sido lido antes de o componente montar.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setPronto("ok");
    });
    const prazo = window.setTimeout(
      () => setPronto((p) => (p === "esperando" ? "invalido" : p)),
      5000,
    );
    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(prazo);
    };
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (senha !== repetir) {
      toast.error("As duas senhas não são iguais.");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      setSalvando(false);
      toast.error(`Não foi possível trocar a senha: ${error.message}`);
      return;
    }
    try {
      await ensureAccess();
    } catch {
      /* segue mesmo assim */
    }
    toast.success("Senha nova salva.");
    navigate({ to: "/inicio", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="card-surface w-full max-w-md p-6">
        <h1 className="text-xl font-semibold text-navy">Criar nova senha</h1>
        {pronto === "esperando" ? (
          <p className="mt-3 text-sm text-muted-foreground">Conferindo o link…</p>
        ) : pronto === "invalido" ? (
          <div className="mt-3 space-y-3 text-sm">
            <p>
              Este link é inválido ou já expirou. Peça um novo em “Esqueci minha senha”, na tela de
              entrada.
            </p>
            <Link to="/auth" className="font-semibold text-marca hover:underline">
              Ir para a tela de entrada
            </Link>
          </div>
        ) : (
          <form onSubmit={salvar} className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nova-senha">Nova senha</Label>
              <Input
                id="nova-senha"
                type="password"
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repetir-senha">Repita a nova senha</Label>
              <Input
                id="repetir-senha"
                type="password"
                autoComplete="new-password"
                value={repetir}
                onChange={(e) => setRepetir(e.target.value)}
              />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar e entrar"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
