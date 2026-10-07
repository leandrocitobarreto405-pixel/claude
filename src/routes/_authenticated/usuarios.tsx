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
import { useMinhaEmpresa, type Papel } from "@/lib/tenant";
import { convidarPorEmailFn, type ResultadoConvite } from "@/lib/convite.functions";
import { enviarFotoTecnico } from "@/lib/equipe-fotos";
import { useServerFn } from "@tanstack/react-start";
import { AcoesConvite } from "@/components/usuarios/acoes-convite";

const TEXTO_ENVIO: Record<ResultadoConvite["envio"], string> = {
  convite_enviado: "Convite enviado por e-mail. A pessoa toca no link, cria a senha e entra.",
  aviso_enviado:
    "Essa pessoa já tem conta no Nexa: mandamos um e-mail avisando do acesso. A empresa aparece no próximo login.",
  ja_tem_conta: "Essa pessoa já tem conta no Nexa. A empresa aparece para ela no próximo login.",
  falhou:
    "Convite registrado, mas o e-mail não saiu agora. Mande pelo WhatsApp ou copie a mensagem.",
};

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
  // Dados da equipe no próprio convite: vendedora (atendente) ou técnico.
  const [nome, setNome] = useState("");
  const [comissao, setComissao] = useState("3");
  const [endereco, setEndereco] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [convidado, setConvidado] = useState<{
    email: string;
    papel: Papel;
    envio: ResultadoConvite["envio"];
  } | null>(null);
  const convidarFn = useServerFn(convidarPorEmailFn);
  const [reenviando, setReenviando] = useState<string | null>(null);

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
    const daEquipe = papel === "atendente" || papel === "tecnico";
    if (daEquipe && nome.trim().length < 2) {
      toast.error(
        papel === "atendente"
          ? "Informe o nome (é o que aparece em Vendedora responsável)."
          : "Informe o nome do técnico.",
      );
      return;
    }
    const pct = Number(comissao.replace(",", "."));
    if (papel === "atendente" && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      toast.error("A comissão vai de 0% a 100%.");
      return;
    }
    setEnviando(true);
    try {
      const r = await convidarFn({
        data: {
          email: email.trim(),
          papel,
          equipe: daEquipe
            ? {
                nome: nome.trim(),
                comissao: papel === "atendente" ? pct : null,
                endereco: papel === "tecnico" ? endereco.trim() : null,
              }
            : null,
        },
      });
      toast[r.envio === "falhou" ? "warning" : "success"](TEXTO_ENVIO[r.envio]);
      if (papel === "tecnico" && foto && r.tecnicoId && empresaId) {
        try {
          await enviarFotoTecnico(empresaId, r.tecnicoId, foto);
        } catch (e) {
          toast.warning(
            `${e instanceof Error ? e.message : "A foto não foi enviada."} Dá para enviar depois em Configurações → Equipe.`,
          );
        }
      }
      setConvidado({ email: email.trim().toLowerCase(), papel, envio: r.envio });
      setEmail("");
      setNome("");
      setEndereco("");
      setFoto(null);
      void queryClient.invalidateQueries({ queryKey: ["salespeople"] });
      void queryClient.invalidateQueries({ queryKey: ["technicians"] });
      void queryClient.invalidateQueries({ queryKey: ["convites_empresa"] });
      void queryClient.invalidateQueries({ queryKey: ["equipe_empresa"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar o convite.");
    } finally {
      setEnviando(false);
    }
  }

  async function reenviar(emailConvite: string, papelConvite: Papel) {
    setReenviando(emailConvite);
    try {
      const r = await convidarFn({
        data: { email: emailConvite, papel: papelConvite, reenviar: true },
      });
      toast[r.envio === "falhou" ? "warning" : "success"](TEXTO_ENVIO[r.envio]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível reenviar.");
    } finally {
      setReenviando(null);
    }
  }

  async function alterarPapel(id: string, novo: Papel) {
    const { error } = await supabase.from("usuarios_empresa").update({ papel: novo }).eq("id", id);
    if (error) {
      toast.error("Não foi possível alterar o papel.");
      return;
    }
    toast.success(
      novo === "atendente"
        ? "Papel atualizado. A vendedora foi criada ou ligada em Configurações → Equipe."
        : novo === "tecnico"
          ? "Papel atualizado. O técnico foi criado ou ligado em Configurações → Equipe."
          : "Papel atualizado.",
    );
    void queryClient.invalidateQueries({ queryKey: ["salespeople"] });
    void queryClient.invalidateQueries({ queryKey: ["technicians"] });
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
          <div className="grid gap-3 sm:grid-cols-[1fr_200px] sm:items-end">
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
          </div>
          {papel === "atendente" || papel === "tecnico" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nome-convite">
                  {papel === "atendente" ? "Nome (vendedora responsável)" : "Nome do técnico"}
                </Label>
                <Input
                  id="nome-convite"
                  value={nome}
                  maxLength={80}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={papel === "atendente" ? "Ex.: Carol" : "Ex.: Josué Barreto"}
                />
              </div>
              {papel === "atendente" ? (
                <div className="space-y-2">
                  <Label htmlFor="comissao-convite">Comissão %</Label>
                  <Input
                    id="comissao-convite"
                    inputMode="decimal"
                    value={comissao}
                    onChange={(e) => setComissao(e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="endereco-convite">Endereço base (de onde sai)</Label>
                    <Input
                      id="endereco-convite"
                      value={endereco}
                      onChange={(e) => setEndereco(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="foto-convite">Foto (opcional, pode enviar depois)</Label>
                    <Input
                      id="foto-convite"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {papel === "atendente"
                  ? "Já entra como vendedora em Configurações → Equipe. Se já existir alguém com o mesmo nome ou e-mail, liga em vez de duplicar."
                  : "Já entra como técnico em Configurações → Equipe. Se já existir alguém com o mesmo nome ou e-mail, liga em vez de duplicar."}
              </p>
            </div>
          ) : null}
          <Button className="min-h-11 w-full sm:w-auto" onClick={convidar} disabled={enviando}>
            {enviando ? "Enviando..." : "Convidar"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {PAPEIS.map((p) => `${p.label}: ${p.descricao}`).join(" · ")}
          </p>
          {convidado && vinculo ? (
            <div className="space-y-3 rounded-botao bg-marca-claro p-4">
              <p className="text-sm">
                <b>{convidado.email}:</b> {TEXTO_ENVIO[convidado.envio]} Se preferir, mande também
                pelo WhatsApp ou copie a mensagem.
              </p>
              <AcoesConvite
                empresa={vinculo.empresa.nome}
                email={convidado.email}
                papel={convidado.papel}
              />
            </div>
          ) : null}
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
              <div key={c.id} className="space-y-2 border-b border-border pb-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {c.email} · {c.papel}
                  </span>
                  <Badge
                    className={c.aceito_em ? "bg-success text-success-foreground" : "bg-secondary"}
                  >
                    {c.aceito_em ? "Ativo" : "Aguardando cadastro"}
                  </Badge>
                </div>
                {!c.aceito_em && vinculo ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={reenviando !== null}
                      onClick={() => void reenviar(c.email, c.papel as Papel)}
                    >
                      {reenviando === c.email ? "Enviando…" : "Reenviar e-mail"}
                    </Button>
                    <AcoesConvite
                      empresa={vinculo.empresa.nome}
                      email={c.email}
                      papel={c.papel as Papel}
                      reenviar
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
