import { createFileRoute, Link } from "@tanstack/react-router";
import { PaginaLegal } from "@/components/pagina-legal";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Serviço — Nexa OS" },
      { name: "description", content: "Condições de uso do Nexa OS." },
    ],
  }),
  component: Termos,
});

function Termos() {
  return (
    <PaginaLegal titulo="Termos de Serviço" atualizadaEm="28 de setembro de 2026">
      <p>
        O Nexa OS é um sistema fornecido pela Nexa Performance às empresas de higienização e
        impermeabilização de estofados que ela atende. Ao usar o sistema, o usuário concorda com
        estes termos.
      </p>

      <h2>Acesso</h2>
      <ul>
        <li>
          O acesso é dado pela Nexa Performance ou pelo administrador da empresa cliente, com login
          individual. O usuário é responsável por manter a senha em sigilo.
        </li>
        <li>Cada usuário só acessa os dados das empresas às quais foi vinculado.</li>
      </ul>

      <h2>Uso permitido</h2>
      <ul>
        <li>
          Usar o sistema para a gestão comercial e operacional da empresa: leads, orçamentos, ordens
          de serviço, agenda, pagamentos, despesas, notas fiscais e relatórios.
        </li>
        <li>
          Não é permitido tentar acessar dados de outras empresas, burlar controles de acesso ou
          usar o sistema para fins ilegais.
        </li>
      </ul>

      <h2>Integrações</h2>
      <p>
        Ao conectar uma conta Google (Drive, Docs e Agenda) ou outras integrações, a empresa
        autoriza o Nexa OS a usá-las apenas para as funções descritas na{" "}
        <Link to="/privacidade" className="text-primary underline">
          Política de Privacidade
        </Link>
        . A conexão pode ser desfeita a qualquer momento em Configurações.
      </p>

      <h2>Dados</h2>
      <p>
        Os dados cadastrados pertencem à empresa cliente. A Nexa Performance os trata para prestar o
        serviço, conforme a Política de Privacidade e a Lei Geral de Proteção de Dados (LGPD).
      </p>

      <h2>Disponibilidade e responsabilidade</h2>
      <p>
        A Nexa Performance busca manter o sistema disponível e seguro, mas ele pode passar por
        manutenções e depende de serviços de terceiros (como Google, Supabase e Chatwoot). As
        informações lançadas no sistema são de responsabilidade de quem as cadastra.
      </p>

      <h2>Alterações</h2>
      <p>Estes termos podem ser atualizados; a data da última versão fica no topo desta página.</p>
    </PaginaLegal>
  );
}
