/**
 * Nova OS em janela: 3 passos (Cliente / Serviço / Venda), rodapé fixo com o total e tela de
 * sucesso. O formulário antigo continua em /nova-os?classico=1 (link discreto no topo).
 */
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Botao } from "@/components/nexa";
import { brl } from "@/lib/format";
import { PASSOS } from "@/lib/nova-os/estado";
import { useNovaOs, type OrigemDaJanela } from "@/lib/nova-os/useNovaOs";
import { useContextoTenant } from "@/lib/tenant";
import { cn } from "@/lib/utils";
import { PassoCliente } from "./passo-cliente";
import { PassoServico } from "./passo-servico";
import { PassoVenda } from "./passo-venda";
import { Sucesso } from "./sucesso";

export function JanelaNovaOs({
  aberta,
  aoFechar,
  origem,
}: {
  aberta: boolean;
  aoFechar: () => void;
  origem: OrigemDaJanela;
}) {
  const n = useNovaOs({ aberta, origem });
  const navigate = useNavigate();
  const { data: tenant } = useContextoTenant();
  const ehAdmin = Boolean(tenant?.souNexa || tenant?.ativa?.papel === "admin");
  const ultimo = n.passo === 2;
  // Cada passo começa do topo (o rolamento do passo anterior não fica).
  const corpo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    corpo.current?.scrollTo({ top: 0 });
  }, [n.passo, n.criada]);

  return (
    <Dialog open={aberta} onOpenChange={(v) => (!v ? aoFechar() : null)}>
      <DialogContent
        className={cn(
          "inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0",
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[92dvh] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border",
          "[&>button.absolute]:hidden",
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <header className="flex items-center gap-2 border-b border-border px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
          {n.criada ? null : n.passo > 0 ? (
            <Botao variante="neutro" tamanho="icone" aria-label="Voltar" onClick={n.voltar}>
              <ChevronLeft className="size-5" />
            </Botao>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <DialogTitle className="font-titulo text-[19px] leading-tight">Nova OS</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {n.criada
                ? "Pronto."
                : `Passo ${n.passo + 1} de 3 · ${PASSOS[n.passo]}${n.carregandoOrigem ? " · carregando dados…" : ""}`}
            </DialogDescription>
          </div>
          {!n.criada ? (
            <Link
              to="/nova-os"
              search={{ classico: "1", ...origem } as never}
              className="shrink-0 px-1 text-[11px] text-muted-foreground underline underline-offset-2"
            >
              usar formulário antigo
            </Link>
          ) : null}
          <DialogPrimitive.Close asChild>
            <Botao variante="neutro" tamanho="icone" aria-label="Fechar">
              <X className="size-5" />
            </Botao>
          </DialogPrimitive.Close>
        </header>

        {n.ambienteDeTeste && !n.criada ? (
          <p
            className="bg-atencao px-4 py-2 text-[13px] font-semibold text-atencao-foreground"
            role="note"
          >
            Endereço de teste: a OS já vem marcada como teste (não conta nos números, no Google Ads
            nem na Agenda).
          </p>
        ) : null}

        {!n.criada ? (
          <ol className="flex gap-1 px-4 pt-3" aria-label="Passos">
            {PASSOS.map((p, i) => (
              <li
                key={p}
                className={cn("h-1.5 flex-1 rounded-full", i <= n.passo ? "bg-marca" : "bg-muted")}
                aria-current={i === n.passo ? "step" : undefined}
              />
            ))}
          </ol>
        ) : null}

        <div ref={corpo} className="flex-1 overflow-y-auto bg-background p-4">
          {n.criada ? (
            <Sucesso
              n={n}
              aoVerOs={() => {
                const numero = n.criada!.os_number;
                aoFechar();
                void navigate({ to: "/os/$osNumber", params: { osNumber: numero } });
              }}
              aoNova={n.reiniciar}
            />
          ) : n.passo === 0 ? (
            <PassoCliente n={n} />
          ) : n.passo === 1 ? (
            <PassoServico n={n} />
          ) : (
            <PassoVenda n={n} ehAdmin={ehAdmin} />
          )}
        </div>

        {!n.criada ? (
          <footer className="flex items-center gap-3 border-t border-border bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                Total
              </span>
              <span className="font-titulo text-[20px] leading-tight">
                {brl(n.derivados.total)}
              </span>
              {ultimo && n.derivados.comissaoPct > 0 ? (
                <span className="text-xs text-muted-foreground">
                  comissão {n.derivados.comissaoPct}% · {brl(n.derivados.comissao)}
                </span>
              ) : null}
            </div>
            {ultimo ? (
              <Botao tamanho="grande" onClick={() => void n.salvar()} disabled={n.salvando}>
                {n.salvando ? "Criando…" : "Criar OS"}
              </Botao>
            ) : (
              <Botao tamanho="grande" onClick={n.avancar}>
                Continuar
              </Botao>
            )}
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
