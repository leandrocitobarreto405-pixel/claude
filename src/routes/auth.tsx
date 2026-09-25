import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Droplets } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ensureAccess } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar — Nexa OS" },
      {
        name: "description",
        content:
          "Acesse o sistema de gestão de pós-venda de higienização e impermeabilização de estofados.",
      },
      { property: "og:title", content: "Entrar — Nexa OS" },
      {
        property: "og:description",
        content: "Sistema de gestão de pós-venda para higienização e impermeabilização.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/inicio", replace: true });
    });
  }, [navigate]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !senha) {
      toast.error("Informe e-mail e senha.");
      return;
    }
    setCarregando(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });
    if (error) {
      setCarregando(false);
      toast.error(
        error.message.toLowerCase().includes("not confirmed")
          ? "E-mail ainda não confirmado. Crie a conta novamente para liberar o acesso."
          : "Não foi possível entrar. Verifique e-mail e senha.",
      );
      return;
    }
    try {
      await ensureAccess();
    } catch {
      /* segue mesmo assim */
    }
    setCarregando(false);
    toast.success("Bem-vindo de volta!");
    navigate({ to: "/inicio", replace: true });
  }

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 3) {
      toast.error("Informe o nome completo.");
      return;
    }
    if (senha.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    setCarregando(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: nome.trim() },
      },
    });
    if (error) {
      setCarregando(false);
      toast.error(`Não foi possível criar a conta: ${error.message}`);
      return;
    }
    if (!data.session) {
      // conta já existente ou sem sessão: tenta entrar direto
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });
      if (loginError) {
        setCarregando(false);
        toast.error("Conta criada. Tente entrar na aba “Entrar”.");
        return;
      }
    }
    try {
      // Aceita os convites pendentes deste e-mail (empresas são cadastradas pela Nexa).
      await ensureAccess();
    } catch {
      /* segue mesmo assim */
    }
    setCarregando(false);
    toast.success("Conta criada com sucesso!");
    navigate({ to: "/inicio", replace: true });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-linear-to-b from-navy-deep to-navy p-10 text-navy-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Droplets className="size-6" />
          </span>
          <span className="text-lg font-semibold text-navy-foreground">Nexa OS</span>
        </div>
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight text-navy-foreground">
            Do fechamento da venda ao lucro líquido, em um único lugar.
          </h2>
          <p className="text-sm opacity-80">
            Cadastre a OS uma única vez e alimente automaticamente a agenda, as mensagens da equipe,
            os pagamentos, as comissões, a quilometragem, as notas fiscais e o DRE.
          </p>
        </div>
        <p className="text-xs opacity-70">Higienização e impermeabilização de estofados</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="card-surface w-full max-w-md p-6">
          <h1 className="text-xl font-semibold text-navy">Acessar o sistema</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use seu e-mail corporativo para entrar.
          </p>

          <Tabs defaultValue="entrar" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="entrar">Entrar</TabsTrigger>
              <TabsTrigger value="criar">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="entrar">
              <form onSubmit={entrar} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@empresa.com.br"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="senha">Senha</Label>
                  <Input
                    id="senha"
                    type="password"
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                <Button type="submit" className="h-11 w-full" disabled={carregando}>
                  {carregando ? "Entrando..." : "Entrar"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="criar">
              <form onSubmit={cadastrar} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome completo</Label>
                  <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  O acesso é liberado por convite. Use o mesmo e-mail em que recebeu o convite.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="email2">E-mail</Label>
                  <Input
                    id="email2"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="senha2">Senha</Label>
                  <Input
                    id="senha2"
                    type="password"
                    autoComplete="new-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                <Button type="submit" className="h-11 w-full" disabled={carregando}>
                  {carregando ? "Criando conta..." : "Criar conta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
