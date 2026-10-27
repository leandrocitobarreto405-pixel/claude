import { createFileRoute } from "@tanstack/react-router";
import { CabecalhoDeTela } from "@/components/nexa";
import { Acessos } from "@/components/configuracoes/acessos";
import { Equipe } from "@/components/configuracoes/equipe";
import { Contadora } from "@/components/configuracoes/contadora";

/** Usuários + vendedoras + técnicos num lugar só. */
export const Route = createFileRoute("/_authenticated/configuracoes/equipe")({
  head: () => ({ meta: [{ title: "Equipe e acessos — Nexa OS" }] }),
  component: () => (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoDeTela
        sobretitulo="Configurações · Empresa"
        titulo="Equipe e acessos"
        descricao="Convide pessoas, defina o papel e ligue cada login à vendedora ou ao técnico."
        voltarPara="/configuracoes/empresa"
      />
      <Acessos />
      <Contadora />
      <Equipe />
    </div>
  ),
});
