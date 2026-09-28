import { createFileRoute } from "@tanstack/react-router";
import { PaginaLegal } from "@/components/pagina-legal";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Nexa OS" },
      {
        name: "description",
        content: "Como o Nexa OS coleta, usa e protege os dados, inclusive os dados do Google.",
      },
    ],
  }),
  component: Privacidade,
});

function Privacidade() {
  return (
    <PaginaLegal titulo="Política de Privacidade" atualizadaEm="28 de setembro de 2026">
      <p>
        O Nexa OS é o sistema de gestão comercial e operacional usado pela Nexa Performance e pelas
        empresas de higienização e impermeabilização de estofados que ela atende (“empresas
        clientes”). Esta política explica quais dados o sistema trata, para quê e como eles são
        protegidos.
      </p>

      <h2>Dados tratados</h2>
      <ul>
        <li>
          <strong>Conta de acesso:</strong> nome e e-mail dos usuários das empresas clientes e da
          Nexa Performance.
        </li>
        <li>
          <strong>Dados de trabalho das empresas clientes:</strong> leads, conversas de atendimento
          recebidas pelo Chatwoot (WhatsApp), orçamentos, ordens de serviço, agenda, pagamentos,
          despesas e notas fiscais, incluindo nome, telefone, e-mail, endereço e CPF/CNPJ dos
          clientes finais dessas empresas.
        </li>
        <li>
          <strong>Dados do Google</strong> (somente quando a empresa conecta a própria conta Google,
          veja abaixo).
        </li>
      </ul>

      <h2>Uso dos dados do Google</h2>
      <p>
        Um administrador de cada empresa pode conectar a conta Google da empresa em Configurações.
        Com essa autorização, o Nexa OS acessa:
      </p>
      <ul>
        <li>
          <strong>Google Drive e Google Docs:</strong> para copiar os modelos de ordem de serviço
          indicados pela empresa, preencher o documento da OS e o termo de garantia, criar a pasta
          de cada cliente (fotos e vídeos do serviço) e compartilhá-la com o cliente final.
        </li>
        <li>
          <strong>Google Agenda:</strong> para criar, atualizar e cancelar os eventos dos serviços e
          das visitas agendados no Nexa OS e convidar o técnico responsável.
        </li>
        <li>
          <strong>E-mail da conta Google:</strong> apenas para mostrar qual conta está conectada.
        </li>
      </ul>
      <p>
        O Nexa OS só acessa os arquivos e eventos necessários para essas funções, sempre a partir de
        uma ação da empresa no sistema. Os dados do Google não são vendidos, não são usados para
        publicidade, não são usados para treinar modelos de inteligência artificial e não são
        compartilhados com terceiros, exceto quando necessário para executar essas funções ou para
        cumprir a lei.
      </p>
      <p>
        O uso e a transferência, para qualquer outro aplicativo, de informações recebidas das APIs
        do Google pelo Nexa OS seguem a{" "}
        <a
          className="text-primary underline"
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Política de Dados do Usuário dos Serviços de API do Google
        </a>
        , incluindo os requisitos de Uso Limitado.
      </p>

      <h2>Armazenamento e segurança</h2>
      <ul>
        <li>
          Os dados ficam no Supabase (região de São Paulo), com acesso separado por empresa: cada
          empresa só vê os próprios dados.
        </li>
        <li>
          A autorização do Google (token de renovação) é guardada numa área que nenhum usuário
          consegue ler; só o servidor do Nexa OS a usa para falar com o Google.
        </li>
        <li>O acesso ao sistema exige login, e toda a comunicação usa HTTPS.</li>
      </ul>

      <h2>Retenção e exclusão</h2>
      <ul>
        <li>
          A empresa pode desconectar a conta Google a qualquer momento em Configurações; a
          autorização é revogada e apagada. Também é possível removê-la em{" "}
          <a
            className="text-primary underline"
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            myaccount.google.com/permissions
          </a>
          .
        </li>
        <li>
          Arquivos criados no Drive e eventos na Agenda pertencem à conta Google da empresa e
          continuam lá, sob o controle dela.
        </li>
        <li>
          Os dados de uma empresa são mantidos enquanto ela usar o sistema e excluídos a pedido,
          ressalvadas as obrigações legais de guarda.
        </li>
      </ul>

      <h2>Direitos e contato</h2>
      <p>
        Pedidos de acesso, correção ou exclusão de dados (LGPD) podem ser feitos à Nexa Performance
        pelo e-mail de suporte exibido na tela de autorização do Google ou diretamente à empresa
        cliente com quem o titular se relaciona.
      </p>
    </PaginaLegal>
  );
}
