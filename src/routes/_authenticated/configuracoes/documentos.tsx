import { createFileRoute } from "@tanstack/react-router";
import { PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { DocumentosPdf } from "@/components/configuracoes/documentos-pdf";
import { ModelosOS } from "@/components/configuracoes/modelos-os";
import { ContaGoogle } from "@/components/conta-google";

export const Route = createFileRoute("/_authenticated/configuracoes/documentos")({
  head: () => ({ meta: [{ title: "Configurações: documentos — Nexa OS" }] }),
  component: () => (
    <PaginaGrupo grupo="documentos">
      <SecaoConfig titulo="PDF da OS e textos" aberta>
        <DocumentosPdf />
      </SecaoConfig>
      <SecaoConfig titulo="Modelos da OS (Google Drive)">
        <div className="grid gap-6">
          <ContaGoogle />
          <ModelosOS />
        </div>
      </SecaoConfig>
    </PaginaGrupo>
  ),
});
