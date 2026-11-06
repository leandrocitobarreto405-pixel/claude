import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Botao, CabecalhoDeTela, Card, Chip, type TomChip } from "@/components/nexa";
import { supabase } from "@/integrations/supabase/client";
import {
  abrirCadastro,
  carregarSdkMeta,
  lerMensagemCadastro,
  ROTULO_SITUACAO,
  type ResultadoCadastro,
} from "@/lib/meta/cadastro-incorporado";

export const Route = createFileRoute("/_authenticated/configuracoes/whatsapp")({
  head: () => ({ meta: [{ title: "Conectar WhatsApp — Nexa OS" }] }),
  component: ConectarWhatsapp,
});

type Situacao = {
  liberado: boolean;
  pronto?: boolean;
  app_id?: string;
  config_id?: string | null;
  versao?: string;
  situacao?: "liberado" | "pendente" | "conectado" | "erro" | "desautorizado";
  numero?: string | null;
  nome?: string | null;
  erro?: string | null;
  conectado_em?: string | null;
};

const TOM: Record<string, TomChip> = {
  liberado: "neutro",
  pendente: "atencao",
  conectado: "sucesso",
  erro: "problema",
  desautorizado: "problema",
};

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("nexa-meta-cadastro", { body: corpo });
  if (error) {
    // Mensagem do servidor (nunca traz token).
    const ctx = (error as { context?: Response }).context;
    const msg = ctx
      ? ((await ctx.json().catch(() => null)) as { erro?: string } | null)?.erro
      : null;
    throw new Error(msg ?? "Não foi possível falar com o servidor.");
  }
  return data as T;
}

/**
 * Configurações › Conectar WhatsApp (Cadastro Incorporado do app Nexa OS na Meta). Só aparece o
 * botão para empresa liberada pela Nexa; as empresas atuais (Turbine inclusive) veem "não
 * disponível" e nada muda no WhatsApp que já usam.
 */
function ConectarWhatsapp() {
  const [s, setS] = useState<Situacao | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const resultado = useRef<ResultadoCadastro | null>(null);

  const carregar = useCallback(async () => {
    try {
      setFalha(null);
      setS(await chamar<Situacao>({ acao: "situacao" }));
    } catch (e) {
      setFalha(e instanceof Error ? e.message : "Erro ao carregar.");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O Cadastro Incorporado devolve waba_id e phone_number_id por postMessage.
  useEffect(() => {
    const ouvir = (ev: MessageEvent) => {
      const r = lerMensagemCadastro(ev.origin, ev.data);
      if (r) resultado.current = r;
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, []);

  async function conectar() {
    if (!s?.app_id || !s.config_id) return;
    resultado.current = null;
    setAndamento("Abrindo a janela da Meta…");
    try {
      const fb = await carregarSdkMeta(s.app_id, s.versao ?? "v23.0");
      const code = await abrirCadastro(fb, s.config_id);
      // O postMessage pode chegar logo depois do retorno do login.
      for (let i = 0; i < 20 && !resultado.current; i++)
        await new Promise((r) => setTimeout(r, 150));
      const r = resultado.current as ResultadoCadastro | null;
      if (!code || r?.tipo === "cancelado") {
        toast.info("Cadastro cancelado. Nada foi alterado.");
        return;
      }
      if (!r || r.tipo !== "concluido") {
        toast.error(
          r?.tipo === "erro" ? r.mensagem : "A Meta não devolveu o número. Tente de novo.",
        );
        return;
      }
      setAndamento("Conectando o número…");
      await chamar({
        acao: "concluir",
        code,
        waba_id: r.wabaId,
        phone_number_id: r.phoneNumberId,
      });
      toast.success("WhatsApp conectado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível conectar.");
    } finally {
      setAndamento(null);
      void carregar();
    }
  }

  const situacao = s?.situacao ?? "liberado";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Conectar WhatsApp"
        descricao="Ligue o número de WhatsApp da empresa ao Nexa OS pela Meta (WhatsApp Cloud API)."
        voltarPara="/configuracoes/mensagens"
      />
      {falha ? (
        <Card className="text-sm text-problema-foreground">{falha}</Card>
      ) : !s ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !s.liberado ? (
        <Card className="gap-2">
          <p className="text-[15px] font-bold">Ainda não disponível para esta empresa</p>
          <p className="text-sm text-muted-foreground">
            O WhatsApp que a empresa já usa continua funcionando como hoje. Quando a conexão direta
            for liberada, o botão aparece aqui.
          </p>
        </Card>
      ) : (
        <Card className="gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-marca-claro text-marca">
              <MessageCircle className="size-5" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-bold">WhatsApp da empresa</span>
              <span className="text-sm text-muted-foreground">
                {(situacao === "conectado" || situacao === "pendente") && s.numero
                  ? [s.numero, s.nome].filter(Boolean).join(" · ")
                  : "Nenhum número conectado"}
              </span>
            </div>
            <Chip tom={TOM[situacao] ?? "neutro"}>{ROTULO_SITUACAO[situacao] ?? situacao}</Chip>
          </div>
          {situacao === "desautorizado" ? (
            <p className="rounded-md bg-problema px-3 py-2 text-sm text-problema-foreground">
              O acesso do Nexa OS foi removido no Facebook. Conecte de novo para voltar a receber as
              mensagens.
            </p>
          ) : (situacao === "erro" || situacao === "pendente") && s.erro ? (
            <p
              className={
                situacao === "erro"
                  ? "rounded-md bg-problema px-3 py-2 text-sm text-problema-foreground"
                  : "rounded-md bg-atencao px-3 py-2 text-sm text-atencao-foreground"
              }
            >
              {s.erro}
            </p>
          ) : null}
          {situacao === "pendente" ? null : situacao === "conectado" ? (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-marca" aria-hidden />
              Mensagens e confirmações de entrega chegam ao Nexa OS.
            </p>
          ) : (
            <>
              <ol className="ml-5 list-decimal space-y-1 text-sm text-muted-foreground">
                <li>Toque em “Conectar WhatsApp” e entre com o Facebook da empresa.</li>
                <li>Escolha (ou crie) a conta do WhatsApp Business e o número.</li>
                <li>Confirme o número com o código que a Meta envia por SMS ou ligação.</li>
              </ol>
              <Botao
                tamanho="grande"
                onClick={() => void conectar()}
                disabled={Boolean(andamento) || !s.pronto || !s.config_id}
              >
                <MessageCircle /> {andamento ?? "Conectar WhatsApp"}
              </Botao>
              {!s.pronto || !s.config_id ? (
                <p className="text-xs text-muted-foreground">
                  A Nexa ainda está terminando a configuração do app na Meta.
                </p>
              ) : null}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
