# Etapa 4 — Funil e indicadores

Situação em 27/09/2026: pronta. Está aplicada no Supabase de desenvolvimento e foi testada no
banco e no navegador.

## O que mudou

**Orçamento ↔ lead ↔ OS**
- O orçamento tem lead (`quotes.crm_lead_id`). Há três formas de ligar:
  - pelo botão **Novo orçamento** na página do lead, que já preenche nome e telefone;
  - **automaticamente**: um orçamento salvo com o telefone de um lead **aberto** da mesma empresa
    é ligado a ele;
  - desfazer o vínculo não religa sozinho.
- Quando um orçamento ligado a um lead vira OS, o lead é **convertido**: fica com a OS
  vinculada, é encerrado e recebe o status de convertido, com registro no histórico. É a mesma
  regra do "Converter em OS" da página do lead.

**Marcos do funil no lead**, preenchidos pelo banco a partir dos fatos, sem depender de alguém
mudar status à mão:

| Marco | De onde vem |
|---|---|
| Lead recebido | criação do lead |
| Primeira resposta | primeira mensagem de saída no Chatwoot (Etapa 3) |
| Orçamento criado | primeiro orçamento ligado ao lead |
| Orçamento enviado / aprovado | primeira vez em que um orçamento do lead fica enviado / aprovado |
| OS criada | OS vinculada ao lead (se a OS for excluída, o marco some) |
| Serviço agendado | primeiro atendimento não cancelado da OS |
| Serviço realizado | primeiro atendimento concluído (data e hora de conclusão, horário de São Paulo) |
| Pagamento recebido | primeiro pagamento "Pago" e ativo (reabrir o pagamento desfaz) |
| Perdido | lead encerrado com motivo de perda ou status de desistência, sem OS |

**Etapa canônica**: igual para todas as empresas. Vai de novo → em atendimento → orçamento →
enviado → aprovado → OS criada → agendado → realizado → faturado, com perdido e encerrado à parte.
É calculada pelo banco (`etapa`). Os status personalizados de cada empresa continuam valendo no
dia a dia.

## Telas

- **Lead**: cartão "Funil" com a etapa, os marcos com data, os orçamentos do lead e o botão
  "Novo orçamento".
- **Orçamento**: mostra o lead vinculado, com link para ele.
- **Funil e indicadores** (`/indicadores`, no grupo CRM; só administrador da empresa e Nexa,
  porque mostra faturamento). Mostra:
  - destaques: leads, % atendidos, mediana da primeira resposta, % que virou venda, vendido e
    recebido;
  - **funil da coorte**: os leads com primeiro contato no período e até onde cada um avançou (até
    hoje), com % do total e % da etapa anterior;
  - **vendas no período**: orçamentos, aprovação, lucro médio dos aprovados, OS, ticket médio,
    recebido bruto e líquido, com ou sem lead;
  - **origem dos leads**: leads, orçamentos, vendas, conversão e valor por origem.

Os números vêm de `indicadores_funil(de, ate)`. A função roda com as permissões de quem chama,
então cada empresa só vê os próprios dados e a Nexa vê os da empresa aberta.

## Correção incluída

Ao converter um lead em OS pela tela, o registro no histórico de status usava colunas que não
existem e falhava sem aviso. Agora ele grava corretamente.

## Testes

- `npm run test:db`: `supabase/tests/030_funil.sql`. Cobre:
  - vínculo automático, só para lead aberto e da mesma empresa;
  - cada marco e a sua reversão (OS excluída, pagamento reaberto, lead reaberto);
  - conversão com status e histórico;
  - etapa canônica;
  - indicadores com valores conferidos;
  - isolamento entre empresas.

  Validado com **mutação**: cinco proteções desligadas, uma de cada vez, e o teste falhou em todas.
- No navegador, contra o Supabase real, com dados temporários já removidos:
  - lead → "Novo orçamento", com nome e telefone preenchidos → salvar;
  - o vínculo se mantém → mudar para "Enviado";
  - o lead passa para "Orçamento enviado" e lista o orçamento;
  - `/indicadores` mostra o funil, com a dica ao passar o mouse, e cabe no celular.

## Próximo (Etapa 5)

Painel consolidado da Nexa (todas as empresas) e apuração da comissão conforme D5.
