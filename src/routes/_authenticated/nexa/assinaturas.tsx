import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/app-shell";
import {
  Botao,
  CabecalhoDeTela,
  Card,
  Chip,
  LinhaSwitch,
  NumeroGrande,
  type TomChip,
} from "@/components/nexa";
import { ListaFaturas } from "@/components/assinatura/lista-faturas";
import { supabase } from "@/integrations/supabase/client";
import { motivoSemFatura } from "@/lib/asaas";
import { gerarFaturaFn, situacaoAsaasFn } from "@/lib/faturas.functions";
import { CHAVE_FATURAS, useFaturas } from "@/lib/faturas";
import { brl } from "@/lib/format";
import {
  STATUS_ASSINATURA,
  avisosFimGratis,
  mensalidade,
  mrr,
  resumoAssinatura,
  usePlanos,
  type Assinatura,
} from "@/lib/planos";
import { useContextoTenant } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/nexa/assinaturas")({
  head: () => ({
    meta: [
      { title: "Assinaturas — Nexa OS" },
      {
        name: "description",
        content: "Plano, mensalidade, situação e faturas de cada empresa (Asaas).",
      },
    ],
  }),
  component: AssinaturasNexa,
});

const HOJE = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const TOM_STATUS: Record<Assinatura["status"], TomChip> = {
  trial: "neutro",
  ativa: "sucesso",
  inadimplente: "problema",
  cancelada: "neutro",
};

type Linha = { id: string; nome: string; assinatura: Assinatura | null };

function AssinaturasNexa() {
  const { data: ctx } = useContextoTenant();
  const souNexa = Boolean(ctx?.souNexa);
  const queryClient = useQueryClient();
  const planos = usePlanos(souNexa);
  const faturas = useFaturas(null, souNexa);
  const situacaoFn = useServerFn(situacaoAsaasFn);
  const asaas = useQuery({
    queryKey: ["asaas_situacao"],
    enabled: souNexa,
    queryFn: () => situacaoFn(),
  });
  const empresas = useQuery({
    queryKey: ["nexa_assinaturas"],
    enabled: souNexa,
    queryFn: async (): Promise<Linha[]> => {
      const [lista, assinaturas] = await Promise.all([
        supabase.from("empresas").select("id, nome").eq("ativo", true).order("nome"),
        supabase
          .from("assinaturas")
          .select(
            "id, empresa_id, plano_id, valor_mensal, status, vigencia_inicio, vigencia_fim, gratis_ate, proximo_vencimento, contrato_pdf_path, contrato_pdf_em",
          )
          .is("vigencia_fim", null),
      ]);
      if (lista.error) throw lista.error;
      if (assinaturas.error) throw assinaturas.error;
      const porEmpresa = new Map(
        ((assinaturas.data ?? []) as Assinatura[]).map((a) => [a.empresa_id, a]),
      );
      return (lista.data ?? []).map((e) => ({ ...e, assinatura: porEmpresa.get(e.id) ?? null }));
    },
  });
  const emails = useQuery({
    queryKey: ["cobranca_emails_ativo"],
    enabled: souNexa,
    queryFn: async () => {
      const { data } = await supabase
        .from("configuracoes_plataforma")
        .select("valor")
        .eq("chave", "cobranca_emails_ativo")
        .maybeSingle();
      return data?.valor === true;
    },
  });
  const [gerando, setGerando] = useState<Linha | null>(null);

  if (ctx && !souNexa) return <EmptyState title="Acesso restrito à Nexa" />;

  const lista = empresas.data ?? [];
  const catalogo = planos.data ?? [];
  const avisos = avisosFimGratis(lista, catalogo, HOJE());
  const contagem = (s: Assinatura["status"]) =>
    lista.filter((l) => l.assinatura?.status === s).length;

  async function alternarEmails(ligar: boolean) {
    const { error } = await supabase.from("configuracoes_plataforma").upsert({
      chave: "cobranca_emails_ativo",
      valor: ligar,
      descricao: "E-mail de cobrança da assinatura (fatura vencida) para o admin da empresa",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(ligar ? "E-mail de cobrança ligado." : "E-mail de cobrança desligado.");
    void queryClient.invalidateQueries({ queryKey: ["cobranca_emails_ativo"] });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Assinaturas"
        descricao="Plano, mensalidade, situação e faturas de cada empresa."
      />

      {avisos.length > 0 && (
        <div
          role="status"
          className="space-y-1 rounded-md bg-atencao px-4 py-3 text-sm text-atencao-foreground"
        >
          {avisos.map((a) => (
            <p key={a} className="font-medium">
              {a}
            </p>
          ))}
        </div>
      )}

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumeroGrande
            valor={brl(
              mrr(
                lista.map((l) => l.assinatura),
                catalogo,
              ),
            )}
            legenda="MRR"
            tamanho="pequeno"
          />
          <NumeroGrande valor={contagem("ativa")} legenda="Ativas" tamanho="pequeno" />
          <NumeroGrande valor={contagem("trial")} legenda="Grátis" tamanho="pequeno" />
          <NumeroGrande
            valor={contagem("inadimplente")}
            legenda="Inadimplentes"
            tamanho="pequeno"
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-bold">Asaas</h2>
        <p className="text-sm">
          {asaas.isLoading
            ? "Conferindo…"
            : asaas.data?.configurado
              ? `Ligado (${asaas.data.ambiente === "producao" ? "produção" : "sandbox"}). Webhook: ${asaas.data.webhook ? "ligado" : "falta o token"}.`
              : "Ainda não configurado: falta ligar a chave do Secret Manager no Cloud Run. Dá para ver tudo, mas não gerar fatura."}
        </p>
        <LinhaSwitch
          id="cobranca-emails"
          titulo="E-mail de cobrança"
          descricao="Quando uma fatura vence, avisa os admins da empresa por e-mail (o aviso no app vale sempre)."
          checked={emails.data === true}
          disabled={emails.isLoading}
          onCheckedChange={(v) => void alternarEmails(v)}
        />
      </Card>

      {lista.map((l) => {
        const a = l.assinatura;
        const valor = a
          ? mensalidade(
              a,
              catalogo.find((p) => p.id === a.plano_id),
            )
          : null;
        const motivo = motivoSemFatura(valor, a?.status);
        const daEmpresa = (faturas.data ?? []).filter((f) => f.empresa_id === l.id).slice(0, 3);
        return (
          <Card key={l.id} as="article">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-base font-bold">{l.nome}</h2>
              {a && <Chip tom={TOM_STATUS[a.status]}>{STATUS_ASSINATURA[a.status]}</Chip>}
            </div>
            <p className="text-sm text-muted-foreground">{resumoAssinatura(a, catalogo)}</p>
            <ListaFaturas faturas={daEmpresa} />
            <div className="flex flex-wrap items-center gap-2">
              <Botao
                variante="contorno"
                disabled={Boolean(motivo) || !asaas.data?.configurado}
                onClick={() => setGerando(l)}
              >
                Gerar fatura
              </Botao>
              {motivo && <span className="text-xs text-muted-foreground">{motivo}</span>}
            </div>
          </Card>
        );
      })}

      <GerarFatura
        linha={gerando}
        onFechar={() => setGerando(null)}
        onGerada={() => {
          setGerando(null);
          void queryClient.invalidateQueries({ queryKey: CHAVE_FATURAS });
          void queryClient.invalidateQueries({ queryKey: ["nexa_assinaturas"] });
        }}
      />
    </div>
  );
}

function GerarFatura({
  linha,
  onFechar,
  onGerada,
}: {
  linha: Linha | null;
  onFechar: () => void;
  onGerada: () => void;
}) {
  const gerar = useServerFn(gerarFaturaFn);
  const proximo = linha?.assinatura?.proximo_vencimento ?? HOJE();
  const [mes, setMes] = useState(proximo.slice(0, 7));
  const [vencimento, setVencimento] = useState(proximo);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    if (!linha) return;
    setEnviando(true);
    try {
      await gerar({ data: { empresaId: linha.id, mes, vencimento } });
      toast.success("Fatura gerada no Asaas.");
      onGerada();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar a fatura.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={Boolean(linha)}
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
        else {
          setMes(proximo.slice(0, 7));
          setVencimento(proximo);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerar fatura · {linha?.nome}</DialogTitle>
          <DialogDescription>
            Cria a cobrança no Asaas (Pix, boleto ou cartão, à escolha de quem paga). O Asaas não
            manda aviso por conta própria.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fatura-mes">Mês cobrado</Label>
            <Input
              id="fatura-mes"
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fatura-vencimento">Vencimento</Label>
            <Input
              id="fatura-vencimento"
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Botao variante="neutro" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao disabled={enviando || !mes || !vencimento} onClick={() => void confirmar()}>
            {enviando ? "Gerando…" : "Gerar fatura"}
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
