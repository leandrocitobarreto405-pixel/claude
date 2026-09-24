# Corrigir "Novo orçamento" + sugerir dias pelo CEP no orçamento

## 1. A tela de novo orçamento não abre

Confirmado: a lista de orçamentos está funcionando como "moldura" da tela de orçamento e não abre espaço para ela, então ao clicar em "Novo orçamento" a página fica vazia. Nada a ver com a tabela de preços — os itens já estão certos.

Correção: separar as duas telas, de forma que a lista continue em Orçamentos e a tela de criar/editar abra normalmente, com o formulário completo (cliente, celular, CEP, endereço, data, itens, desconto, custos internos, mensagem de WhatsApp e "Transformar em OS").

## 2. Sugestão de dias pelo CEP dentro do orçamento

Na tela de novo orçamento, logo abaixo do CEP, um bloco **"Melhores dias para este CEP"**:

- Aparece quando o CEP tem 8 dígitos; a vendedora clica em "Sugerir dias".
- Mostra os 3 dias mais próximos nos próximos 30 dias, com data e dia da semana, distância até o atendimento mais próximo daquele dia, quantos atendimentos o dia já tem (primeiro e último horário) e o técnico.
- Cada sugestão tem um botão "Usar esta data", que preenche a data do serviço do orçamento.
- Se não houver nada agendado no período, mostra o aviso "nenhum atendimento agendado nesse período".
- Uso interno: essas informações nunca entram na mensagem enviada ao cliente.

O mesmo bloco continua na Agenda, sem alteração, para consulta depois do orçamento aprovado.

## Detalhes técnicos

- `src/routes/_authenticated/orcamentos.tsx` hoje é rota-pai de `orcamentos.$quoteId` e não renderiza `<Outlet />`, por isso a rota filha não pinta. Mover para `src/routes/_authenticated/orcamentos/index.tsx` e `src/routes/_authenticated/orcamentos/$quoteId.tsx` (conteúdo inalterado), eliminando a relação pai/filho; `routeTree.gen.ts` se regenera.
- Reusar a server function existente `sugerirDiasPorCep` (`src/lib/routes.functions.ts` + `route-suggest.server.ts`) via `useServerFn` + `useMutation` na tela do orçamento; nenhuma mudança no backend.
- Extrair o cartão de sugestão da Agenda para um componente compartilhado (`src/components/sugestao-dias-cep.tsx`) com prop opcional `onEscolherData`, usado nas duas telas para não duplicar código.
- Após a correção: typecheck/build e teste no navegador criando um orçamento.
