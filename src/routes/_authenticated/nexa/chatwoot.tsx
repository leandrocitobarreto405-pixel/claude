import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useContextoTenant } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/nexa/chatwoot")({
  head: () => ({
    meta: [
      { title: "Chatwoot — Nexa OS" },
      {
        name: "description",
        content: "Conexão com o Chatwoot, caixas de entrada por empresa e registro de eventos.",
      },
    ],
  }),
  component: ChatwootNexa,
});

/** Mesma lista de src/lib/chatwoot.server.ts (não importável no navegador). */
const EVENTOS = [
  "conversation_created",
  "conversation_updated",
  "conversation_status_changed",
  "message_created",
  "message_updated",
  "contact_created",
  "contact_updated",
];

const STATUS_CLASSE: Record<string, string> = {
  processado: "bg-emerald-100 text-emerald-800",
  ignorado: "bg-secondary text-muted-foreground",
  inbox_nao_mapeado: "bg-amber-100 text-amber-800",
  erro: "bg-destructive/10 text-destructive",
  recebido: "bg-primary/10 text-primary",
};

const STATUS_ROTULO: Record<string, string> = {
  processado: "Processado",
  ignorado: "Ignorado",
  inbox_nao_mapeado: "Caixa não mapeada",
  erro: "Erro",
  recebido: "Recebido",
};

type Conexao = {
  id: string;
  nome: string;
  base_url: string;
  account_id: number;
  webhook_token: string;
  verificar_assinatura: boolean;
  ativo: boolean;
  ultimo_evento_em: string | null;
  tem_segredo: boolean;
  tem_token_api: boolean;
};

function dataHora(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function ChatwootNexa() {
  const queryClient = useQueryClient();
  const { data: ctx } = useContextoTenant();

  const conexoes = useQuery({
    queryKey: ["chatwoot_conexoes"],
    queryFn: async (): Promise<Conexao[]> => {
      const { data, error } = await supabase.rpc("chatwoot_conexoes_resumo");
      if (error) throw error;
      return (data ?? []) as Conexao[];
    },
  });
  const conexao = conexoes.data?.[0] ?? null;

  const empresas = useQuery({
    queryKey: ["nexa_empresas_lista"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome").order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const inboxes = useQuery({
    queryKey: ["chatwoot_inboxes", conexao?.id],
    enabled: Boolean(conexao),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chatwoot_inboxes")
        .select("id, inbox_id, nome, ativo, empresa:empresa_id ( id, nome )")
        .eq("conexao_id", conexao!.id)
        .order("inbox_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const eventos = useQuery({
    queryKey: ["integracao_eventos"],
    enabled: Boolean(conexao),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integracao_eventos")
        .select(
          "id, evento, status, inbox_id, erro, tentativas, recebido_em, empresa:empresa_id ( nome )",
        )
        .order("recebido_em", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const semMapa = Array.from(
    (eventos.data ?? [])
      .filter((e) => e.status === "inbox_nao_mapeado" && e.inbox_id !== null)
      .reduce(
        (m, e) => m.set(Number(e.inbox_id), (m.get(Number(e.inbox_id)) ?? 0) + 1),
        new Map<number, number>(),
      ),
  );

  // Formulário de conexão
  const [nome, setNome] = useState("Nexa Performance");
  const [conta, setConta] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://app.chatwoot.com");
  const [segredo, setSegredo] = useState("");
  const [tokenApi, setTokenApi] = useState("");
  // Formulário de mapeamento
  const [inboxId, setInboxId] = useState("");
  const [inboxNome, setInboxNome] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [ocupado, setOcupado] = useState(false);

  function recarregar() {
    void queryClient.invalidateQueries({ queryKey: ["chatwoot_conexoes"] });
    void queryClient.invalidateQueries({ queryKey: ["chatwoot_inboxes"] });
    void queryClient.invalidateQueries({ queryKey: ["integracao_eventos"] });
  }

  async function criarConexao() {
    const account = Number(conta);
    if (!Number.isInteger(account) || account <= 0) {
      toast.error("Informe o número da conta do Chatwoot (aparece na URL: /app/accounts/NÚMERO).");
      return;
    }
    setOcupado(true);
    const { error } = await supabase
      .from("chatwoot_conexoes")
      .insert({ nome: nome.trim() || "Chatwoot", account_id: account, base_url: baseUrl.trim() });
    setOcupado(false);
    if (error) {
      toast.error(`Não foi possível criar a conexão: ${error.message}`);
      return;
    }
    toast.success("Conexão criada. Copie a URL do webhook para o Chatwoot.");
    recarregar();
  }

  async function salvarSegredos() {
    if (!conexao || (!segredo.trim() && !tokenApi.trim())) return;
    setOcupado(true);
    const { error } = await supabase.rpc("definir_segredos_chatwoot", {
      _conexao_id: conexao.id,
      ...(segredo.trim() ? { _webhook_secret: segredo.trim() } : {}),
      ...(tokenApi.trim() ? { _api_token: tokenApi.trim() } : {}),
    });
    setOcupado(false);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    setSegredo("");
    setTokenApi("");
    toast.success("Salvo. Os valores não são exibidos novamente.");
    recarregar();
  }

  async function alternarAssinatura(valor: boolean) {
    if (!conexao) return;
    if (valor && !conexao.tem_segredo) {
      toast.error(
        "Cadastre primeiro o segredo do webhook (mostrado no Chatwoot ao criar o webhook).",
      );
      return;
    }
    const { error } = await supabase
      .from("chatwoot_conexoes")
      .update({ verificar_assinatura: valor })
      .eq("id", conexao.id);
    if (error) toast.error(error.message);
    recarregar();
  }

  async function mapear() {
    const numero = Number(inboxId);
    if (!conexao || !Number.isInteger(numero) || numero <= 0 || !empresaId) {
      toast.error("Informe o número da caixa de entrada e a empresa.");
      return;
    }
    setOcupado(true);
    const { error } = await supabase.from("chatwoot_inboxes").insert({
      conexao_id: conexao.id,
      inbox_id: numero,
      empresa_id: empresaId,
      nome: inboxNome.trim() || null,
    });
    if (error) {
      setOcupado(false);
      toast.error(`Não foi possível mapear: ${error.message}`);
      return;
    }
    // Eventos que chegaram antes do mapeamento são processados agora.
    await supabase.rpc("reprocessar_eventos_chatwoot", { _limite: 200 });
    setOcupado(false);
    setInboxId("");
    setInboxNome("");
    toast.success("Caixa mapeada. Eventos pendentes dela foram processados.");
    recarregar();
  }

  async function alternarInbox(id: string, ativo: boolean) {
    const { error } = await supabase.from("chatwoot_inboxes").update({ ativo }).eq("id", id);
    if (error) toast.error(error.message);
    recarregar();
  }

  async function reprocessar() {
    setOcupado(true);
    const { data, error } = await supabase.rpc("reprocessar_eventos_chatwoot", { _limite: 200 });
    setOcupado(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const r = (data ?? {}) as { verificados?: number; processados?: number };
    toast.success(
      `${r.verificados ?? 0} evento(s) verificado(s), ${r.processados ?? 0} processado(s).`,
    );
    recarregar();
  }

  if (ctx && !ctx.souNexa) return <EmptyState title="Acesso restrito à Nexa" />;

  const urlWebhook = conexao
    ? `${window.location.origin}/api/public/hooks/chatwoot/${conexao.webhook_token}`
    : "";

  return (
    <>
      <PageHeader
        title="Chatwoot"
        description="Recebe conversas e mensagens do Chatwoot e cria contatos e leads na empresa de cada caixa de entrada."
      />

      {!conexao ? (
        <section className="card-surface mb-6 space-y-4 p-5">
          <h2 className="text-lg font-semibold">Conectar conta do Chatwoot</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="cw-nome">Nome</Label>
              <Input id="cw-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cw-conta">Nº da conta</Label>
              <Input
                id="cw-conta"
                inputMode="numeric"
                placeholder="187966"
                value={conta}
                onChange={(e) => setConta(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cw-url">Endereço do Chatwoot</Label>
              <Input id="cw-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <Button onClick={criarConexao} disabled={ocupado}>
              Conectar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O número da conta aparece na barra de endereço do Chatwoot: …/app/accounts/<b>187966</b>
            /…
          </p>
        </section>
      ) : (
        <>
          <section className="card-surface mb-6 space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {conexao.nome} · conta {conexao.account_id}
              </h2>
              <span className="text-sm text-muted-foreground">
                Último evento: {dataHora(conexao.ultimo_evento_em)}
              </span>
            </div>
            <div className="space-y-2">
              <Label>URL do webhook (cole no Chatwoot)</Label>
              <div className="flex gap-2">
                <Input readOnly value={urlWebhook} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copiar URL"
                  onClick={() => {
                    void navigator.clipboard.writeText(urlWebhook);
                    toast.success("URL copiada.");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                No Chatwoot: Configurações → Integrações → Webhooks → Adicionar. Marque os eventos:{" "}
                {EVENTOS.join(", ")}. Esta URL contém um segredo: não compartilhe.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="cw-segredo">
                  Segredo do webhook {conexao.tem_segredo ? "(cadastrado)" : ""}
                </Label>
                <Input
                  id="cw-segredo"
                  type="password"
                  autoComplete="off"
                  placeholder={conexao.tem_segredo ? "••••••••" : "mostrado pelo Chatwoot"}
                  value={segredo}
                  onChange={(e) => setSegredo(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cw-token">
                  Token de acesso da API {conexao.tem_token_api ? "(cadastrado)" : ""}
                </Label>
                <Input
                  id="cw-token"
                  type="password"
                  autoComplete="off"
                  placeholder={conexao.tem_token_api ? "••••••••" : "Perfil → Token de acesso"}
                  value={tokenApi}
                  onChange={(e) => setTokenApi(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={salvarSegredos} disabled={ocupado}>
                Salvar
              </Button>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={conexao.verificar_assinatura}
                onCheckedChange={(v) => void alternarAssinatura(v)}
              />
              Exigir assinatura do Chatwoot (X-Chatwoot-Signature)
            </label>
          </section>

          <section className="card-surface mb-6 space-y-4 p-5">
            <h2 className="text-lg font-semibold">Caixas de entrada → empresas</h2>
            {semMapa.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Eventos recebidos de caixas sem empresa:{" "}
                {semMapa.map(([id, n]) => (
                  <button
                    key={id}
                    type="button"
                    className="mr-2 underline"
                    onClick={() => setInboxId(String(id))}
                  >
                    caixa {id} ({n})
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[140px_1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="cw-inbox">Nº da caixa</Label>
                <Input
                  id="cw-inbox"
                  inputMode="numeric"
                  value={inboxId}
                  onChange={(e) => setInboxId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cw-inbox-nome">Nome (opcional)</Label>
                <Input
                  id="cw-inbox-nome"
                  placeholder="ex.: WhatsApp Turbine"
                  value={inboxNome}
                  onChange={(e) => setInboxNome(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cw-empresa">Empresa</Label>
                <select
                  id="cw-empresa"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={empresaId}
                  onChange={(e) => setEmpresaId(e.target.value)}
                >
                  <option value="">Escolha…</option>
                  {(empresas.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={mapear} disabled={ocupado}>
                Mapear
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              O número da caixa aparece na URL ao abri-la no Chatwoot: …/settings/inboxes/<b>12</b>
            </p>
            {(inboxes.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma caixa mapeada ainda.</p>
            ) : (
              <div className="space-y-2">
                {(inboxes.data ?? []).map((i) => (
                  <div
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                  >
                    <span>
                      Caixa <b>{i.inbox_id}</b>
                      {i.nome ? ` · ${i.nome}` : ""} →{" "}
                      <b>{(i.empresa as unknown as { nome: string } | null)?.nome ?? "?"}</b>
                    </span>
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={i.ativo}
                        onCheckedChange={(v) => void alternarInbox(i.id, v)}
                      />
                      {i.ativo ? "Ativa" : "Pausada"}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card-surface mb-6 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Últimos eventos</h2>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={reprocessar}
                disabled={ocupado}
              >
                <RefreshCw className="size-4" />
                Reprocessar pendentes
              </Button>
            </div>
            {(eventos.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum evento recebido ainda. Depois de cadastrar o webhook, envie uma mensagem para
                o WhatsApp conectado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Recebido</th>
                      <th className="pb-2 font-medium">Evento</th>
                      <th className="pb-2 font-medium">Caixa</th>
                      <th className="pb-2 font-medium">Empresa</th>
                      <th className="pb-2 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(eventos.data ?? []).map((e) => (
                      <tr key={e.id} className="border-t border-border align-top">
                        <td className="py-2">{dataHora(e.recebido_em)}</td>
                        <td className="py-2 font-mono text-xs">{e.evento}</td>
                        <td className="py-2">{e.inbox_id ?? "—"}</td>
                        <td className="py-2">
                          {(e.empresa as unknown as { nome: string } | null)?.nome ?? "—"}
                        </td>
                        <td className="py-2">
                          <Badge className={STATUS_CLASSE[e.status] ?? "bg-secondary"}>
                            {STATUS_ROTULO[e.status] ?? e.status}
                          </Badge>
                          {e.erro ? (
                            <p className="mt-1 max-w-[320px] text-xs text-destructive">
                              {e.erro} ({e.tentativas} tentativa(s))
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
