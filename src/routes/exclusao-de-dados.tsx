import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PaginaLegal } from "@/components/pagina-legal";
import {
  ATUALIZADA_EM,
  CONTATO_PRIVACIDADE,
  PRAZO_EXCLUSAO_DIAS,
  RESPONSAVEL,
  URL_SITUACAO_EXCLUSAO,
} from "@/lib/legal";

export const Route = createFileRoute("/exclusao-de-dados")({
  validateSearch: (s: Record<string, unknown>) => {
    const codigo = String(s["codigo"] ?? "").toUpperCase();
    return /^[A-Z0-9]{10,32}$/.test(codigo) ? { codigo } : {};
  },
  head: () => ({
    meta: [
      { title: "Exclusão de dados — Nexa OS" },
      { name: "description", content: "Como pedir a exclusão dos seus dados no Nexa OS." },
    ],
  }),
  component: ExclusaoDeDados,
});

type Situacao = { situacao: string; recebido_em: string; concluido_em: string | null };

function dataBR(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function ExclusaoDeDados() {
  const { codigo } = Route.useSearch() as { codigo?: string };
  const [pedido, setPedido] = useState<Situacao | null | "nao_achado">(null);

  useEffect(() => {
    if (!codigo) return;
    fetch(`${URL_SITUACAO_EXCLUSAO}?codigo=${encodeURIComponent(codigo)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Situacao) : "nao_achado"))
      .then(setPedido)
      .catch(() => setPedido("nao_achado"));
  }, [codigo]);

  const assunto = encodeURIComponent("Exclusão de dados — Nexa OS");
  return (
    <PaginaLegal titulo="Exclusão de dados" atualizadaEm={ATUALIZADA_EM}>
      {codigo ? (
        <div className="rounded-card border border-border bg-secondary/60 p-4">
          <p className="font-semibold">Pedido {codigo}</p>
          {pedido === null ? (
            <p className="text-muted-foreground">Consultando…</p>
          ) : pedido === "nao_achado" ? (
            <p className="text-muted-foreground">
              Não encontramos este pedido. Escreva para {CONTATO_PRIVACIDADE} com o código.
            </p>
          ) : (
            <p>
              Situação: <strong>{pedido.situacao}</strong> · recebido em{" "}
              {dataBR(pedido.recebido_em)}
              {pedido.concluido_em ? ` · concluído em ${dataBR(pedido.concluido_em)}` : ""}.
            </p>
          )}
        </div>
      ) : null}

      <p>
        Você pode pedir a exclusão dos seus dados tratados pelo Nexa OS a qualquer momento. É
        gratuito.
      </p>

      <h2>Como pedir</h2>
      <ul>
        <li>
          Mande um e-mail para{" "}
          <a
            className="text-primary underline"
            href={`mailto:${CONTATO_PRIVACIDADE}?subject=${assunto}`}
          >
            {CONTATO_PRIVACIDADE}
          </a>{" "}
          com o assunto “Exclusão de dados”.
        </li>
        <li>
          Informe seu nome, o número de WhatsApp ou e-mail usado e, se souber, a empresa com quem
          você falou (por exemplo, a empresa de higienização que te atendeu).
        </li>
        <li>
          Se você é uma empresa cliente e quer apagar a conta inteira, o pedido deve vir do e-mail
          do administrador da empresa.
        </li>
      </ul>

      <h2>Prazo</h2>
      <p>
        Confirmamos o recebimento em até 2 dias úteis e concluímos a exclusão em até{" "}
        {PRAZO_EXCLUSAO_DIAS} dias. Guardamos apenas o que a lei obriga (por exemplo, dados
        fiscais), pelo prazo legal.
      </p>

      <h2>O que é excluído</h2>
      <ul>
        <li>Contato, conversas e mídias do WhatsApp ligados ao seu número.</li>
        <li>Cadastro, orçamentos e histórico de atendimento, quando não houver obrigação legal.</li>
        <li>Autorizações de acesso (WhatsApp e Google) da empresa, quando ela desconecta.</li>
      </ul>

      <h2>Pedido pelo Facebook</h2>
      <p>
        Se você removeu o app “Nexa OS” nas configurações do Facebook, a Meta nos avisa
        automaticamente e você recebe um código de acompanhamento. Use o link que a Meta mostrar
        para ver a situação do pedido nesta página.
      </p>

      <p>
        Mais detalhes na{" "}
        <Link to="/privacidade" className="text-primary underline">
          Política de Privacidade
        </Link>
        . Responsável: {RESPONSAVEL}.
      </p>
    </PaginaLegal>
  );
}
