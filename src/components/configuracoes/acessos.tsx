// Logins da empresa: convites, papéis e o vínculo de cada login com a vendedora ou o técnico
// (veio da antiga tela Usuários).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import { useSalespeople, useTechnicians } from "@/lib/data";
import { useMinhaEmpresa, type Papel } from "@/lib/tenant";
import { convidarPorEmailFn, type ResultadoConvite } from "@/lib/convite.functions";
import { agentesChatwootFn, ligarAgenteChatwootFn } from "@/lib/caixa-equipe.functions";
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

const PAPEIS: { valor: Papel; label: string; descricao: string }[] = [
  { valor: "admin", label: "Administrador", descricao: "Acesso total, inclusive financeiro" },
  { valor: "atendente", label: "Atendente", descricao: "Operação, agenda, OSs e cobrança" },
  { valor: "tecnico", label: "Técnico", descricao: "Somente a agenda e a conclusão dos serviços" },
];

export function Acessos() {
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
        .select("id, user_id, papel, created_at, chatwoot_agent_id")
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

  function recarregarTudo() {
    void queryClient.invalidateQueries({ queryKey: ["salespeople"] });
    void queryClient.invalidateQueries({ queryKey: ["technicians"] });
    void queryClient.invalidateQueries({ queryKey: ["convites_empresa"] });
    void queryClient.invalidateQueries({ queryKey: ["equipe_empresa"] });
  }

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
            `${e instanceof Error ? e.message : "A foto não foi enviada."} Dá para enviar depois, aqui em Equipe e acessos.`,
          );
        }
      }
      setConvidado({ email: email.trim().toLowerCase(), papel, envio: r.envio });
      setEmail("");
      setNome("");
      setEndereco("");
      setFoto(null);
      recarregarTudo();
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
        ? "Papel atualizado. A vendedora foi criada ou ligada abaixo."
        : novo === "tecnico"
          ? "Papel atualizado. O técnico foi criado ou ligado abaixo."
          : "Papel atualizado.",
    );
    recarregarTudo();
    void queryClient.invalidateQueries({ queryKey: ["minha_empresa"] });
  }

  const lista = equipe.data ?? [];

  return (
    <>
      {admin ? (
        <section className="card-surface space-y-4 p-5">
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
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                  placeholder={papel === "atendente" ? "Ex.: Carol" : "Ex.: nome e sobrenome"}
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
                  ? "Já entra como vendedora abaixo. Se já existir alguém com o mesmo nome ou e-mail, liga em vez de duplicar."
                  : "Já entra como técnico abaixo, ligado a este login. Se já existir um técnico com o mesmo nome ou e-mail, liga em vez de duplicar."}
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

      <section className="card-surface p-5">
        <h2 className="mb-1 text-lg font-semibold">Quem tem login</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Atendente aparece como vendedora na OS; técnico vê só a agenda dele. O vínculo com o
          cadastro fica aqui mesmo.
        </p>
        {lista.length === 0 ? (
          <EmptyState title="Nenhum usuário na empresa" />
        ) : (
          <div className="space-y-3">
            {lista.map((m) => (
              <div
                key={m.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">{m.perfil?.full_name ?? "Usuário"}</p>
                  <p className="text-sm text-muted-foreground">
                    {m.perfil?.email ?? "sem e-mail"} · desde {dateBR(m.created_at)}
                  </p>
                </div>
                {admin ? (
                  <select
                    aria-label={`Papel de ${m.perfil?.full_name ?? "usuário"}`}
                    className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
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
                {admin && (m.papel === "tecnico" || m.papel === "atendente") ? (
                  <CadastroDoLogin userId={m.user_id} papel={m.papel} aoMudar={recarregarTudo} />
                ) : null}
                {admin && m.papel !== "tecnico" ? (
                  <UsuarioNoChatwoot
                    vinculoId={m.id}
                    atual={m.chatwoot_agent_id ?? null}
                    aoMudar={recarregarTudo}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {admin && (convites.data ?? []).length ? (
        <section className="card-surface p-5">
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

/**
 * Qual cadastro (técnico ou vendedora) este login usa. Trocar aqui desliga o cadastro anterior
 * deste login e liga o escolhido; "Nenhum" deixa o login sem cadastro.
 */
function CadastroDoLogin({
  userId,
  papel,
  aoMudar,
}: {
  userId: string;
  papel: "tecnico" | "atendente";
  aoMudar: () => void;
}) {
  const tabela = papel === "tecnico" ? "technicians" : "salespeople";
  const { data: tecnicos } = useTechnicians(false);
  const { data: vendedoras } = useSalespeople(false);
  const cadastros = (papel === "tecnico" ? tecnicos : vendedoras) ?? [];
  const meu = cadastros.find((c) => c.user_id === userId) ?? null;
  // Opções: o meu e os que ainda não têm login.
  const opcoes = cadastros.filter((c) => c.id === meu?.id || !c.user_id);
  const [ocupado, setOcupado] = useState(false);

  async function ligar(id: string) {
    setOcupado(true);
    try {
      if (meu && meu.id !== id) {
        const { error } = await supabase.from(tabela).update({ user_id: null }).eq("id", meu.id);
        if (error) throw error;
      }
      if (id) {
        const { error } = await supabase.from(tabela).update({ user_id: userId }).eq("id", id);
        if (error) throw error;
      }
      toast.success(
        id
          ? papel === "tecnico"
            ? "Login ligado ao técnico. A agenda dele passa a ser a deste login."
            : "Login ligado à vendedora."
          : "Login sem cadastro.",
      );
      aoMudar();
    } catch {
      toast.error("Não foi possível ligar o cadastro.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <label className="flex w-full flex-wrap items-center gap-2 text-sm">
      <span className={meu ? "text-muted-foreground" : "font-semibold text-atencao-foreground"}>
        {papel === "tecnico" ? "Técnico:" : "Vendedora:"}
        {meu ? "" : " sem cadastro ligado"}
      </span>
      <select
        aria-label={
          papel === "tecnico" ? "Cadastro de técnico deste login" : "Vendedora deste login"
        }
        className="min-h-11 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        value={meu?.id ?? ""}
        disabled={ocupado}
        onChange={(e) => void ligar(e.target.value)}
      >
        <option value="">Nenhum</option>
        {opcoes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.active ? "" : " (inativo)"}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Quem é esta pessoa no Chatwoot. Com a ligação, assumir pelo app atribui lá e o que ela assume
 * no Chatwoot aparece em "Minhas" aqui. Sem ligação, assumir pelo app deixa a conversa "sem
 * responsável" no Chatwoot (a meta é ninguém mais precisar de conta lá).
 */
function UsuarioNoChatwoot({
  vinculoId,
  atual,
  aoMudar,
}: {
  vinculoId: string;
  atual: number | null;
  aoMudar: () => void;
}) {
  const agentesFn = useServerFn(agentesChatwootFn);
  const ligarFn = useServerFn(ligarAgenteChatwootFn);
  const agentes = useQuery({ queryKey: ["agentes_chatwoot"], queryFn: () => agentesFn() });
  const [ocupado, setOcupado] = useState(false);
  const lista = agentes.data ?? [];
  if (!lista.length) return null;
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Usuário no Chatwoot
      <select
        aria-label="Usuário no Chatwoot"
        className="min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        value={atual ?? ""}
        disabled={ocupado}
        onChange={(e) => {
          setOcupado(true);
          const agenteId = e.target.value ? Number(e.target.value) : null;
          void ligarFn({ data: { vinculoId, agenteId } })
            .then(() => {
              toast.success(agenteId ? "Ligação com o Chatwoot salva." : "Ligação removida.");
              aoMudar();
            })
            .catch((err) =>
              toast.error(err instanceof Error ? err.message : "Não foi possível salvar."),
            )
            .finally(() => setOcupado(false));
        }}
      >
        <option value="">Sem ligação (assume só pelo app)</option>
        {lista.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nome}
            {a.email ? ` · ${a.email}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
