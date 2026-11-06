import { createFileRoute, Link } from "@tanstack/react-router";
import { PaginaLegal } from "@/components/pagina-legal";
import { ATUALIZADA_EM, CONTATO_PRIVACIDADE, EMPRESA_LEGAL, RESPONSAVEL } from "@/lib/legal";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — Nexa OS" },
      { name: "description", content: "Termos de uso do Nexa OS, em linguagem simples." },
    ],
  }),
  component: Termos,
});

function Termos() {
  return (
    <PaginaLegal titulo="Termos de Uso" atualizadaEm={ATUALIZADA_EM}>
      <p>
        O Nexa OS é um sistema da {EMPRESA_LEGAL} para empresas de higienização e impermeabilização
        de estofados organizarem atendimento, WhatsApp, agenda, ordens de serviço, CRM e financeiro.
        Ao usar o Nexa OS, a empresa e seus usuários concordam com estes termos.
      </p>

      <h2>1. Conta e acesso</h2>
      <ul>
        <li>
          O acesso é criado pela {EMPRESA_LEGAL} ou pelo administrador da empresa, com login
          individual. Cada um cuida da própria senha.
        </li>
        <li>Cada usuário só vê os dados das empresas às quais foi vinculado.</li>
      </ul>

      <h2>2. O que pode e o que não pode</h2>
      <ul>
        <li>Pode: usar o sistema para a gestão da própria empresa e o atendimento dos clientes.</li>
        <li>
          Não pode: tentar acessar dados de outras empresas, burlar controles de acesso, enviar spam
          ou mensagens que desrespeitem as regras do WhatsApp, ou usar o sistema para algo ilegal.
        </li>
      </ul>

      <h2>3. WhatsApp e outras integrações</h2>
      <ul>
        <li>
          A empresa pode conectar o próprio número de WhatsApp (WhatsApp Cloud API, da Meta) pelo
          Nexa OS. Ela continua dona do número e da conta e deve seguir as políticas do WhatsApp
          Business e da Meta, inclusive pedir o consentimento dos clientes antes de mandar mensagens
          de modelo.
        </li>
        <li>
          Ao conectar o WhatsApp, a conta Google ou outra integração, a empresa autoriza o Nexa OS a
          usá-la só para as funções descritas na{" "}
          <Link to="/privacidade" className="text-primary underline">
            Política de Privacidade
          </Link>
          . A conexão pode ser desfeita a qualquer momento em Configurações.
        </li>
        <li>
          Custos cobrados pela Meta pelas conversas do WhatsApp são da empresa dona do número.
        </li>
      </ul>

      <h2>4. Assistente virtual (IA)</h2>
      <p>
        Quando ligada pela empresa, a assistente responde clientes e monta orçamentos com base nas
        regras e preços cadastrados. A empresa revisa as configurações e responde pelo que oferece
        aos clientes.
      </p>

      <h2>5. Dados</h2>
      <p>
        Os dados cadastrados pertencem à empresa cliente. A {EMPRESA_LEGAL} os trata para prestar o
        serviço, conforme a Política de Privacidade e a LGPD.
      </p>

      <h2>6. Pagamento e cancelamento</h2>
      <p>
        O plano, o valor e a forma de pagamento são combinados com a {EMPRESA_LEGAL}. Com pagamento
        em atraso, o sistema pode ficar só para consulta até a regularização. A empresa pode
        cancelar quando quiser; os dados ficam disponíveis para exportação por 30 dias.
      </p>

      <h2>7. Disponibilidade e responsabilidade</h2>
      <p>
        Fazemos o possível para manter o Nexa OS no ar e seguro, mas ele pode passar por manutenções
        e depende de serviços de terceiros (como Meta, Google, Supabase e Chatwoot). As informações
        lançadas no sistema são de responsabilidade de quem as cadastra.
      </p>

      <h2>8. Mudanças e contato</h2>
      <p>
        Estes termos podem ser atualizados; a data da última versão fica no topo da página.
        Responsável: {RESPONSAVEL}. Dúvidas:{" "}
        <a className="text-primary underline" href={`mailto:${CONTATO_PRIVACIDADE}`}>
          {CONTATO_PRIVACIDADE}
        </a>
        .
      </p>
    </PaginaLegal>
  );
}
