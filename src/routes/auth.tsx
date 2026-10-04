import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Droplets } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ensureAccess } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { enderecoDoApp } from "@/lib/enderecos";

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
  /** E-mail que ainda não confirmou o cadastro (mostra "Reenviar confirmação"). */
  const [naoConfirmado, setNaoConfirmado] = useState<string | null>(null);

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
      if (error.message.toLowerCase().includes("not confirmed")) {
        setNaoConfirmado(email.trim());
        toast.error("Seu e-mail ainda não foi confirmado: toque no link que enviamos para ele.");
      } else {
        toast.error("Não foi possível entrar. Verifique e-mail e senha.");
      }
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

  async function esqueciSenha() {
    const alvo = email.trim();
    if (!alvo.includes("@")) {
      toast.error("Escreva seu e-mail no campo acima e toque de novo em “Esqueci minha senha”.");
      return;
    }
    setCarregando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(alvo, {
      redirectTo: `${enderecoDoApp()}/redefinir-senha`,
    });
    setCarregando(false);
    if (error) {
      toast.error(`Não foi possível enviar o link: ${error.message}`);
      return;
    }
    toast.success(
      `Se ${alvo} tiver conta, enviamos um link para criar uma nova senha. Confira também o spam.`,
      { duration: 10000 },
    );
  }

  async function reenviarConfirmacao() {
    if (!naoConfirmado) return;
    setCarregando(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: naoConfirmado,
      options: { emailRedirectTo: enderecoDoApp() },
    });
    setCarregando(false);
    if (error) {
      toast.error(`Não foi possível reenviar: ${error.message}`);
      return;
    }
    toast.success(`Enviamos de novo o link de confirmação para ${naoConfirmado}.`);
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
        emailRedirectTo: enderecoDoApp(),
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
        if (loginError.message.toLowerCase().includes("not confirmed")) {
          setNaoConfirmado(email.trim());
          toast.success(
            `Conta criada! Enviamos um link de confirmação para ${email.trim()}. Toque nele e depois entre pela aba “Entrar”.`,
            { duration: 10000 },
          );
        } else {
          toast.error("Conta criada. Tente entrar na aba “Entrar”.");
        }
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
                <div className="flex flex-wrap justify-between gap-2">
                  <button
                    type="button"
                    className="min-h-11 text-sm font-semibold text-marca hover:underline"
                    onClick={() => void esqueciSenha()}
                    disabled={carregando}
                  >
                    Esqueci minha senha
                  </button>
                  {naoConfirmado ? (
                    <button
                      type="button"
                      className="min-h-11 text-sm font-semibold text-marca hover:underline"
                      onClick={() => void reenviarConfirmacao()}
                      disabled={carregando}
                    >
                      Reenviar confirmação
                    </button>
                  ) : null}
                </div>
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
                {naoConfirmado ? (
                  <button
                    type="button"
                    className="min-h-11 w-full text-sm font-semibold text-marca hover:underline"
                    onClick={() => void reenviarConfirmacao()}
                    disabled={carregando}
                  >
                    Não chegou? Reenviar confirmação
                  </button>
                ) : null}
              </form>
            </TabsContent>
          </Tabs>
          <p className="mt-6 flex justify-center gap-4 text-xs text-muted-foreground">
            <Link to="/privacidade" className="hover:underline">
              Política de Privacidade
            </Link>
            <Link to="/termos" className="hover:underline">
              Termos de Serviço
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
