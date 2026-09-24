# Corrigir a queda ao selecionar opções na Nova OS

## Diagnóstico confirmado

- O campo “Origem da venda” usa o seletor com portal do Radix UI.
- A seleção de “Google” atualiza apenas o estado local; não deveria navegar nem salvar dados.
- Em uma sessão limpa autenticada, a seleção funcionou sem erros de console, portanto a queda não foi reproduzida fora da sessão de preview atual e a causa exata permanece específica ao ambiente/interação dessa sessão.

## Implementação

1. Substituir os seletores com portal dentro do formulário de Nova OS por controles nativos estilizados, preservando as mesmas opções, valores e validações.
2. Manter toda a lógica de negócio e gravação da OS inalterada.
3. Adicionar uma barreira de erro específica na rota Nova OS para que uma falha de interação não derrube a aplicação inteira e produza um diagnóstico localizado.
4. Validar em navegador autenticado a sequência completa: origem “Google”, vendedora, tipo de serviço, estofado, técnico e forma de pagamento; confirmar que o formulário permanece aberto e mantém os valores selecionados.

## Escopo técnico

- Alterações somente no frontend da rota Nova OS.
- Nenhuma mudança no banco de dados, permissões, autenticação ou regras financeiras.