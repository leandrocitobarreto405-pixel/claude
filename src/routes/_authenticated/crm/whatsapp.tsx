import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Copy, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, SectionCard } from "@/components/app-shell";
import { InfoBadge } from "@/components/crm-ui";
import { dateTimeBR } from "@/lib/format";
import {
  getWhatsappStatus,
  listWebhookEvents,
  reprocessWebhookEvent,
  simulateWhatsappMessage,
} from "@/lib/crm-integration.functions";

export const Route = createFileRoute("/_authenticated/crm/whatsapp")({
  head: () => ({
    meta: [
      { title: "Integração do WhatsApp — Nexa OS" },
      {
        name: "description",
        content: "Status da conexão do WhatsApp Business, webhook e registros de eventos.",
      },
      { property: "og:title", content: "Integração do WhatsApp — Nexa OS" },
      {
        property: "og:description",
        content: "Status da conexão do WhatsApp Business, webhook e registros de eventos.",
      },
    ],
  }),
  component: WhatsappConfig,
});

function WhatsappConfig() {
  const lerStatus = useServerFn(getWhatsappStatus);
  const lerEventos = useServerFn(listWebhookEvents);
  const reprocessar = useServerFn(reprocessWebhookEvent);
  const simular = useServerFn(simulateWhatsappMessage);

  const status = useQuery({ queryKey: ["crm_wa_status"], queryFn: () => lerStatus({}) });
  const eventos = useQuery({ queryKey: ["crm_wa_events"], queryFn: () => lerEventos({}) });

  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("Olá, gostaria de um orçamento de higienização de sofá.");
  const [testando, setTestando] = useState(false);

  const webhookUrl = status.data?.webhookUrl?.startsWith("http")
    ? status.data.webhookUrl
    : `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/hooks/whatsapp`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("URL do webhook copiada.");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  }

  async function testarRecebimento() {
    setTestando(true);
    try {
      const r = await simular({ data: { phone: telefone, name: nome, text: texto } });
      toast.success(
        `Teste concluído: ${r.messagesStored} mensagem(ns) registrada(s), ${r.leadsCreated} lead(s) criado(s).`,
      );
      void status.refetch();
      void eventos.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível simular o recebimento.",
      );
    } finally {
      setTestando(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Integração do WhatsApp"
        description="Conecte o WhatsApp Business para criar leads automaticamente a partir das mensagens recebidas."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void status.refetch();
              void eventos.refetch();
            }}
            className="gap-2"
          >
            <RefreshCw className="size-4" /> Verificar configuração
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Status da integração"
          description="Situação atual da conexão."
          accent="navy"
        >
          <div className="flex flex-wrap items-center gap-2">
            <InfoBadge>{status.data?.state ?? "Carregando..."}</InfoBadge>
            {status.data?.processedCount ? (
              <InfoBadge>{status.data.processedCount} evento(s) processado(s)</InfoBadge>
            ) : null}
            {status.data?.errorCount ? (
              <InfoBadge>{status.data.errorCount} erro(s)</InfoBadge>
            ) : null}
          </div>
          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Último evento recebido</dt>
              <dd>{status.data?.lastReceivedAt ? dateTimeBR(status.data.lastReceivedAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Último evento processado</dt>
              <dd>
                {status.data?.lastProcessedAt ? dateTimeBR(status.data.lastProcessedAt) : "—"}
              </dd>
            </div>
          </dl>
          {status.data?.lastError ? (
            <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              Último erro: {status.data.lastError}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            O CRM funciona normalmente antes da conexão: você pode cadastrar leads manualmente e
            importar a planilha histórica.
          </p>
        </SectionCard>

        <SectionCard
          title="Webhook"
          description="Cole esta URL na configuração do aplicativo da Meta."
        >
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button variant="outline" size="icon" aria-label="Copiar URL" onClick={copiar}>
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Assine o campo <span className="font-mono">messages</span>. A verificação usa o token de
            verificação configurado, e toda mensagem recebida é validada pela assinatura da Meta.
          </p>

          <p className="mt-4 mb-2 text-sm font-medium text-navy">Credenciais</p>
          <ul className="grid gap-1.5 text-sm">
            {(status.data?.secrets ?? []).map((s) => (
              <li key={s.name} className="flex items-center gap-2">
                {s.configured ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <XCircle className="size-4 text-destructive" />
                )}
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="text-xs text-muted-foreground">
                  {s.configured ? "Configurado" : "Não configurado"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Os valores ficam guardados com segurança no servidor e nunca são exibidos aqui.
          </p>
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Testar recebimento"
          description="Cria um lead de teste como se uma mensagem tivesse chegado."
        >
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="teste-telefone">Telefone com DDD</Label>
              <Input
                id="teste-telefone"
                value={telefone}
                maxLength={20}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="teste-nome">Nome</Label>
              <Input
                id="teste-nome"
                value={nome}
                maxLength={120}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome do contato"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="teste-texto">Mensagem</Label>
              <Textarea
                id="teste-texto"
                value={texto}
                maxLength={2000}
                onChange={(e) => setTexto(e.target.value)}
                rows={3}
              />
            </div>
            <Button onClick={testarRecebimento} disabled={testando}>
              {testando ? "Testando..." : "Testar recebimento"}
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="Registros de eventos"
          description="Últimos 50 eventos recebidos."
          accent="warning"
        >
          {(eventos.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum evento recebido até agora.</p>
          ) : (
            <div className="grid gap-2">
              {(eventos.data ?? []).map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-navy">{e.processing_status}</p>
                    <p className="text-xs text-muted-foreground">
                      {dateTimeBR(e.received_at)} · {e.messages_stored} nova(s) ·{" "}
                      {e.duplicated_messages} duplicada(s)
                    </p>
                    {e.error_message ? (
                      <p className="mt-1 text-xs text-destructive">{e.error_message}</p>
                    ) : null}
                  </div>
                  {e.processing_status === "Erro" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await reprocessar({ data: { eventId: e.id } });
                          toast.success("Evento reprocessado.");
                          void eventos.refetch();
                        } catch {
                          toast.error("Não foi possível reprocessar o evento.");
                        }
                      }}
                    >
                      Reprocessar
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
