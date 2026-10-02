import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { Botao, CabecalhoDeTela, Card } from "@/components/nexa";
import { usePapel } from "@/lib/tenant";

// Versão provisória da aba Avisos. A lista única de avisos (campanhas, conversas passadas
// para a equipe, pós-venda, serviços atrasados, pagamentos) chega na etapa "Avisos".
export const Route = createFileRoute("/_authenticated/avisos")({
  head: () => ({ meta: [{ title: "Avisos — Nexa OS" }] }),
  component: Avisos,
});

function Avisos() {
  const { papel } = usePapel();
  const escritorio = papel === "admin" || papel === "atendente";
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <CabecalhoDeTela titulo="Avisos" descricao="O que precisa da sua atenção." />
      <Card className="items-center py-8 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-marca-claro text-marca">
          <Bell className="size-6" aria-hidden />
        </span>
        <p className="text-[15px] font-bold">Os avisos vão aparecer aqui</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          {escritorio
            ? "Por enquanto, os avisos das campanhas ficam na aba Marketing."
            : "Serviços atrasados, reagendados ou sem técnico vão aparecer aqui."}
        </p>
        {escritorio ? (
          <Botao asChild variante="contorno">
            <Link to="/marketing">Ver avisos das campanhas</Link>
          </Botao>
        ) : null}
      </Card>
    </div>
  );
}
