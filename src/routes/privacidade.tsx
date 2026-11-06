import { createFileRoute, Link } from "@tanstack/react-router";
import { PaginaLegal } from "@/components/pagina-legal";
import {
  ATUALIZADA_EM,
  CONTATO_PRIVACIDADE,
  EMPRESA_LEGAL,
  PRAZO_EXCLUSAO_DIAS,
} from "@/lib/legal";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Nexa OS" },
      {
        name: "description",
        content:
          "Como o Nexa OS trata os dados (LGPD): WhatsApp, atendimento, agenda, OS, CRM, IA e Google.",
      },
    ],
  }),
  component: Privacidade,
});

function Privacidade() {
  return (
    <PaginaLegal titulo="Política de Privacidade" atualizadaEm={ATUALIZADA_EM}>
      <p>
        O Nexa OS é o sistema de gestão comercial e operacional da {EMPRESA_LEGAL}, usado pelas
        empresas de higienização e impermeabilização de estofados que ela atende (“empresas
        clientes”). Esta política explica, em linguagem simples e conforme a Lei Geral de Proteção
        de Dados (LGPD, Lei 13.709/2018), quais dados o sistema trata, para quê, com quem
        compartilha, por quanto tempo guarda e como você exerce os seus direitos.
      </p>

      <h2>Quem é quem</h2>
      <ul>
        <li>
          <strong>Empresa cliente (controladora):</strong> decide como atender os próprios clientes
          e é responsável pelos dados deles.
        </li>
        <li>
          <strong>{EMPRESA_LEGAL} (operadora):</strong> fornece o Nexa OS e trata os dados em nome
          da empresa cliente, só para prestar o serviço.
        </li>
      </ul>

      <h2>Dados tratados</h2>
      <ul>
        <li>
          <strong>Dados da empresa cliente e dos usuários:</strong> razão social, CNPJ, telefone,
          endereço, nome e e-mail de quem usa o sistema.
        </li>
        <li>
          <strong>Contatos e mensagens de WhatsApp dos clientes finais:</strong> nome, número de
          telefone, conteúdo das mensagens trocadas com a empresa cliente, data e situação de
          entrega (enviada, entregue, lida).
        </li>
        <li>
          <strong>Mídias:</strong> fotos, vídeos, áudios e documentos enviados nas conversas ou
          anexados aos atendimentos.
        </li>
        <li>
          <strong>Dados de trabalho:</strong> leads, orçamentos, ordens de serviço, agenda,
          pagamentos, despesas e notas fiscais, incluindo endereço, e-mail e CPF/CNPJ dos clientes
          finais quando informados.
        </li>
        <li>
          <strong>Dados do Google</strong> (somente quando a empresa conecta a própria conta Google,
          veja abaixo).
        </li>
      </ul>

      <h2>Para que usamos</h2>
      <ul>
        <li>
          <strong>Atendimento:</strong> receber e responder as mensagens de WhatsApp da empresa
          cliente (pela WhatsApp Cloud API da Meta), inclusive mensagens de modelo aprovadas pela
          Meta.
        </li>
        <li>
          <strong>Agenda e ordens de serviço:</strong> marcar, confirmar e registrar os serviços.
        </li>
        <li>
          <strong>CRM:</strong> organizar leads, orçamentos, retornos e o histórico de cada cliente.
        </li>
        <li>
          <strong>IA de atendimento:</strong> quando a empresa liga a assistente virtual, as
          mensagens são processadas por provedores de inteligência artificial para sugerir ou enviar
          respostas e montar orçamentos. Esses dados não são usados para treinar modelos.
        </li>
      </ul>
      <p>
        Base legal: execução do contrato com a empresa cliente, legítimo interesse no atendimento
        solicitado pelo próprio cliente final e cumprimento de obrigações legais.
      </p>

      <h2>Com quem compartilhamos</h2>
      <p>Só com os fornecedores necessários para o serviço funcionar:</p>
      <ul>
        <li>
          <strong>Meta (WhatsApp Cloud API):</strong> envio e recebimento das mensagens de WhatsApp.
        </li>
        <li>
          <strong>Chatwoot:</strong> caixa de entrada das conversas usada por algumas empresas
          clientes.
        </li>
        <li>
          <strong>Supabase e Google Cloud:</strong> banco de dados e servidores do sistema (região
          de São Paulo).
        </li>
        <li>
          <strong>Provedores de IA</strong> (como a Anthropic): processamento das mensagens quando a
          assistente virtual está ligada.
        </li>
        <li>
          <strong>Google</strong> (Drive, Docs e Agenda): somente quando a empresa conecta a conta.
        </li>
      </ul>
      <p>Não vendemos dados e não os usamos para publicidade.</p>

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
          Autorizações de acesso (token do WhatsApp e token de renovação do Google) ficam
          criptografadas, numa área que nenhum usuário consegue ler; só o servidor do Nexa OS as
          usa.
        </li>
        <li>O acesso ao sistema exige login, e toda a comunicação usa HTTPS.</li>
      </ul>

      <h2>Por quanto tempo guardamos</h2>
      <ul>
        <li>
          Enquanto a empresa cliente usar o Nexa OS. Depois do fim do contrato, os dados são
          excluídos em até 90 dias, salvo o que a lei obriga a guardar (por exemplo, dados fiscais).
        </li>
        <li>
          A empresa pode desconectar o WhatsApp ou a conta Google a qualquer momento em
          Configurações; a autorização é apagada. A conta Google também pode ser removida em{" "}
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
      </ul>

      <h2>Seus direitos</h2>
      <p>
        Pela LGPD, o titular pode pedir: confirmação de que tratamos seus dados, acesso, correção,
        anonimização, portabilidade, exclusão, informação sobre compartilhamento e revisão do
        consentimento. Veja como pedir a exclusão em{" "}
        <Link to="/exclusao-de-dados" className="text-primary underline">
          Exclusão de dados
        </Link>
        . Respondemos em até {PRAZO_EXCLUSAO_DIAS} dias.
      </p>

      <h2>Encarregado (contato)</h2>
      <p>
        Encarregado pelo tratamento de dados da {EMPRESA_LEGAL}:{" "}
        <a className="text-primary underline" href={`mailto:${CONTATO_PRIVACIDADE}`}>
          {CONTATO_PRIVACIDADE}
        </a>
        . Você também pode falar diretamente com a empresa com quem se relaciona (a empresa
        cliente).
      </p>
    </PaginaLegal>
  );
}
