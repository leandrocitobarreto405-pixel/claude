import { createFileRoute } from "@tanstack/react-router";
import { CabecalhoDeTela } from "@/components/nexa";
import { NotificacoesCelular } from "@/components/avisos/notificacoes-celular";
import { usePapel } from "@/lib/tenant";

/** Notificações no celular, para todos os papéis (o técnico não tem Configurações). */
export const Route = createFileRoute("/_authenticated/notificacoes")({
  head: () => ({ meta: [{ title: "Notificações no celular — Nexa OS" }] }),
  component: Notificacoes,
});

function Notificacoes() {
  const { papel } = usePapel();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Notificações no celular"
        descricao="Avisos da Nexa direto no celular, mesmo com o app fechado."
        {...(papel === "admin" ? { voltarPara: "/configuracoes/outros" } : {})}
      />
      <NotificacoesCelular />
    </div>
  );
}
