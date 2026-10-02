import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Lock } from "lucide-react";
import { Card, CabecalhoDeTela } from "@/components/nexa";
import {
  CHAVE_IMPLANTACAO,
  ListaEtapas,
  ProgressoImplantacao,
} from "@/components/implantacao/checklist";
import { minhaImplantacaoFn } from "@/lib/implantacao.functions";
import { dateBR } from "@/lib/format";
import { usePapel } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/implantacao")({
  head: () => ({ meta: [{ title: "Configuração da empresa — Nexa OS" }] }),
  component: Implantacao,
});

function Implantacao() {
  const { papel } = usePapel();
  const admin = papel === "admin";
  const fn = useServerFn(minhaImplantacaoFn);
  const q = useQuery({ queryKey: CHAVE_IMPLANTACAO, queryFn: () => fn(), enabled: admin });

  if (papel && !admin)
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Card className="text-center text-sm">Só o administrador vê esta tela.</Card>
      </div>
    );

  const d = q.data;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Configuração da empresa"
        descricao="O que falta para a empresa usar o Nexa por completo. Cada etapa se marca sozinha quando fica pronta."
      />
      {q.isLoading ? <Card className="text-sm">Conferindo as etapas…</Card> : null}
      {q.error ? (
        <Card className="text-sm text-problema">
          {q.error instanceof Error ? q.error.message : "Não foi possível carregar."}
        </Card>
      ) : null}
      {d ? (
        <>
          <Card className="flex flex-col gap-3">
            <ProgressoImplantacao resumo={d.resumo} />
            {d.liberadaEm ? (
              <p className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-marca" aria-hidden />
                <span>
                  Empresa liberada pela Nexa em {dateBR(d.liberadaEm.slice(0, 10))}: a Alice e os
                  envios podem ser ligados.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-2 text-sm">
                <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  {d.resumo.podeLiberar
                    ? "Tudo pronto: agora a Nexa confere e libera a Alice e os envios."
                    : "Enquanto as etapas obrigatórias não ficam prontas, a Alice e os envios para clientes ficam desligados."}
                </span>
              </p>
            )}
          </Card>
          <ListaEtapas etapas={d.etapas} editavel />
        </>
      ) : null}
    </div>
  );
}
