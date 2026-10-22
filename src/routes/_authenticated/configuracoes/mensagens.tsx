import { createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { LinkDeConfig, PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { Mensagem, MensagemNota } from "@/components/configuracoes/mensagens";
import { DigitandoMeta } from "@/components/configuracoes/digitando-meta";
import { EncerramentoAutomatico } from "@/components/configuracoes/encerramento-automatico";
import { RespostasProntasConfig } from "@/components/configuracoes/respostas-prontas";

export const Route = createFileRoute("/_authenticated/configuracoes/mensagens")({
  head: () => ({ meta: [{ title: "Configurações: mensagens — Nexa OS" }] }),
  component: () => (
    <PaginaGrupo grupo="mensagens">
      <LinkDeConfig
        to="/modelos-mensagem"
        titulo="Modelos de mensagem"
        descricao="Textos aprovados pela Meta e rascunhos"
        icone={ScrollText}
      />
      <SecaoConfig titulo="Respostas prontas">
        <RespostasProntasConfig />
      </SecaoConfig>
      <SecaoConfig titulo="Conversas: digitando… e lido (Meta)">
        <DigitandoMeta />
      </SecaoConfig>
      <SecaoConfig titulo="Conversas: encerramento automático">
        <EncerramentoAutomatico />
      </SecaoConfig>
      <SecaoConfig titulo="Mensagem padrão" aberta>
        <div className="grid gap-6">
          <Mensagem />
          <MensagemNota />
        </div>
      </SecaoConfig>
    </PaginaGrupo>
  ),
});
