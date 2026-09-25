import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import { convidarUsuario, useMinhaEmpresa, type Papel } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários — Nexa OS" },
      { name: "description", content: "Equipe com acesso ao sistema, com papéis e convites." },
      { property: "og:title", content: "Usuários — Nexa OS" },
      {
        property: "og:description",
        content: "Convide pessoas e defina o papel de cada uma na empresa.",
      },
    ],
  }),
  component: Usuarios,
});

const PAPEIS: { valor: Papel; label: string; descricao: string }[] = [
  { valor: "admin", label: "Administrador", descricao: "Acesso total, inclusive financeiro" },
  { valor: "atendente", label: "Atendente", descricao: "Operação, agenda, OSs e cobrança" },
  { valor: "tecnico", label: "Técnico", descricao: "Somente a agenda e a conclusão dos serviços" },
];

function Usuarios() {
  const queryClient = useQueryClient();
  const { data: vinculo } = useMinhaEmpresa();
  const admin = vinculo?.papel === "admin";

  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<Papel>("atendente");
  const [enviando, setEnviando] = useState(false);

  const empresaId = vinculo?.empresa.id ?? null;

  const equipe = useQuery({
    queryKey: ["equipe_empresa", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usuarios_empresa")
        .select("id, user_id, papel, created_at")
        .eq("empresa_id", empresaId!)
        .order("created_at");
      if (error) throw error;
      const ids = (data ?? []).map((m) => m.user_id);
      const perfis = ids.length
        ? ((
            await supabase
              .from("users_profiles")
              .select("id, full_name, email, active")
              .in("id", ids)
          ).data ?? [])
        : [];
      return (data ?? []).map((m) => ({
        ...m,
        perfil: perfis.find((p) => p.id === m.user_id) ?? null,
      }));
    },
  });

  const convites = useQuery({
    queryKey: ["convites_empresa", empresaId],
    enabled: admin && Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("convites_empresa")
        .select("id, email, papel, aceito_em, created_at")
        .eq("empresa_id", empresaId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function convidar() {
    if (!email.includes("@")) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    setEnviando(true);
    try {
      await convidarUsuario(email.trim(), papel);
      toast.success("Convite registrado. A pessoa entra criando a conta com este e-mail.");
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["convites_empresa"] });
      void queryClient.invalidateQueries({ queryKey: ["equipe_empresa"] });
    } catch {
      toast.error("Não foi possível registrar o convite.");
    } finally {
      setEnviando(false);
    }
  }

  async function alterarPapel(id: string, novo: Papel) {
    const { error } = await supabase.from("usuarios_empresa").update({ papel: novo }).eq("id", id);
    if (error) {
      toast.error("Não foi possível alterar o papel.");
      return;
    }
    toast.success("Papel atualizado.");
    void queryClient.invalidateQueries({ queryKey: ["equipe_empresa"] });
    void queryClient.invalidateQueries({ queryKey: ["minha_empresa"] });
  }

  const lista = equipe.data ?? [];

  return (
    <>
      <PageHeader
        title="Usuários"
        description={
          vinculo
            ? `Equipe da empresa ${vinculo.empresa.nome}. Cada empresa vê apenas os próprios dados.`
            : "Equipe com acesso ao sistema."
        }
      />

      {admin ? (
        <section className="card-surface mb-6 space-y-4 p-5">
          <h2 className="text-lg font-semibold">Convidar pessoa</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="email-convite">E-mail</Label>
              <Input
                id="email-convite"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@empresa.com.br"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="papel-convite">Papel</Label>
              <select
                id="papel-convite"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={papel}
                onChange={(e) => setPapel(e.target.value as Papel)}
              >
                {PAPEIS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={convidar} disabled={enviando}>
              {enviando ? "Enviando..." : "Convidar"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {PAPEIS.map((p) => `${p.label}: ${p.descricao}`).join(" · ")}
          </p>
        </section>
      ) : null}

      {lista.length === 0 ? (
        <EmptyState title="Nenhum usuário na empresa" />
      ) : (
        <div className="space-y-3">
          {lista.map((m) => (
            <section
              key={m.id}
              className="card-surface flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <p className="font-medium">{m.perfil?.full_name ?? "Usuário"}</p>
                <p className="text-sm text-muted-foreground">
                  {m.perfil?.email ?? "sem e-mail"} · desde {dateBR(m.created_at)}
                </p>
              </div>
              {admin ? (
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={m.papel}
                  onChange={(e) => void alterarPapel(m.id, e.target.value as Papel)}
                >
                  {PAPEIS.map((p) => (
                    <option key={p.valor} value={p.valor}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge className="bg-secondary">{m.papel}</Badge>
              )}
            </section>
          ))}
        </div>
      )}

      {admin && (convites.data ?? []).length ? (
        <section className="card-surface mt-6 p-5">
          <h2 className="mb-3 text-lg font-semibold">Convites</h2>
          <div className="space-y-2 text-sm">
            {(convites.data ?? []).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {c.email} · {c.papel}
                </span>
                <Badge
                  className={c.aceito_em ? "bg-success text-success-foreground" : "bg-secondary"}
                >
                  {c.aceito_em ? "Ativo" : "Aguardando cadastro"}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
