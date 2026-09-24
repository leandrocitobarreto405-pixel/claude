# Orçamentos + Tabela de preços

Duas entregas na mesma leva: a **Tabela de preços** em Configurações e o novo módulo **Orçamentos**, com margem interna e mensagem de WhatsApp pronta para copiar.

## 1. Tabela de preços (Configurações)

Nova aba "Tabela de preços" com a lista dos 13 itens já cadastrados (colchões, sofás, poltrona, puff, cadeiras, cabeceira) nos valores que você passou.

- Colunas: Item · Higienização · Impermeabilização · Ativo · Ações
- Preços editáveis na própria linha, no formato R$ 0,00
- "+ Adicionar item": nome e preço de higienização obrigatórios; impermeabilização em branco = serviço não oferecido para aquele item
- Liga/desliga o item por linha
- Excluir só é permitido se o item nunca foi usado em orçamento; caso contrário o app avisa e oferece desativar
- Reordenar arrastando e soltando (também funciona no celular)
- Nenhum preço fica fixo no código: todas as telas leem essa tabela

## 2. Orçamentos

Nova seção "Orçamentos" no menu. No topo o botão **"Novo orçamento"**; abaixo, a lista dos orçamentos criados.

**Listagem:** cliente, data, total e situação em etiqueta colorida (Rascunho, Enviado, Aprovado, Recusado, Virou OS). Filtro por **mês** (padrão o mês atual), por situação e por cliente, busca por nome, mais recentes primeiro.

**Resumo do mês** no topo da lista: quantos orçamentos, valor total orçado, quantos viraram OS, valor convertido e **taxa de conversão** em %.

**Criar/editar:** nome do cliente (obrigatório), celular, CEP (preenche o endereço automaticamente, como na Nova OS) e endereço, data do serviço, observações. O CEP também é usado para estimar o deslocamento (item 3).

Linhas de itens: Item · Serviço · Qtd · Preço unitário · Subtotal · excluir.
- Só itens ativos aparecem na lista
- Impermeabilização fica desabilitada, com aviso "Não disponível para este item", quando o item não tem esse preço
- Ao escolher item + serviço o preço de tabela é preenchido automaticamente
- A vendedora pode alterar o preço: igual ou acima da tabela fica normal; entre 90% e 99% fica amarelo; abaixo de 90% fica vermelho e exige o motivo do desconto
- Subtotal recalculado na hora; o mesmo item pode repetir com serviço diferente

Rodapé: Subtotal · Desconto em R$ ou % · TOTAL em destaque.
Ações: salvar rascunho, duplicar orçamento, alterar situação, gerar a mensagem de WhatsApp e **transformar em OS**.

### Virar OS

Quando o cliente aprova, o botão **"Transformar em OS"** abre a Nova OS já preenchida com o cliente (cadastrando-o se ainda não existir), endereço, data do serviço e os itens do orçamento com os valores aplicados. Ao salvar a OS, o orçamento passa para "Virou OS" e mostra o link para a OS gerada; o orçamento continua guardado do jeito que foi enviado.

## 3. Custos e margem (uso interno)

Bloco recolhido "Custos (uso interno)", visível para administrador e atendente:
- Km ida e volta: sugerido automaticamente a partir do CEP do cliente (distância até a base do técnico, ida e volta) e editável à mão
- Custo de deslocamento calculado automaticamente com o custo por km já cadastrado nas configurações (não crio campo novo)
- Custo de produtos e de mão de obra, opcionais
- Custo total somado

Painel de margem: receita, custos, margem em R$ e %. Verde a partir de 60%, amarelo de 40% a 59%, vermelho abaixo de 40% com o aviso "Margem baixa — revise o valor ou o deslocamento". Técnico não vê esse bloco.

Custo, km e margem nunca aparecem na mensagem enviada ao cliente.

## 4. Mensagem de WhatsApp

Botão "Gerar mensagem WhatsApp" monta o texto pronto para copiar (e um atalho para abrir a conversa). O texto escolhido depende dos serviços do orçamento:

- só higienização → texto "Higienização Premium TurbineClean"
- só impermeabilização → texto "Impermeabilização Premium Turbine Clean"
- os dois → texto "Higienização e Impermeabilização Premium Turbine Clean"

Em todos, a lista "Estofados:" é preenchida com os itens do orçamento (nome, serviço, quantidade e valor de cada um) e o fechamento traz "Total: 5x de R$ … sem juros ou à vista por R$ …" e "Orçamento válido por 7 dias".

Como o parcelado e o à vista podem ser diferentes, o orçamento ganha um campo opcional "valor à vista". Em branco, os dois valores usam o total (parcela = total ÷ 5).

## 5. Regras gerais


- Moeda R$ 1.234,56 e datas dd/mm/aaaa
- Não salva sem cliente e sem pelo menos um item
- Totais, custos e margem recalculados no servidor antes de gravar
- Layout pensado primeiro para celular
- Cada empresa vê apenas a própria tabela de preços e os próprios orçamentos

## Detalhes técnicos

- Já existe uma tabela chamada `service_items` no banco (são os itens de cada atendimento das OS). Para não quebrar nada, o catálogo de preços será criado como `tabela_precos_itens` (nome, preco_higienizacao, preco_impermeabilizacao, ativo, ordem, timestamps).
- Novas tabelas `quotes` e `quote_items` conforme especificado, mais `empresa_id NOT NULL` em todas (padrão multiempresa já adotado), GRANTs e políticas RLS por empresa via `empresas_do_usuario(auth.uid())`; enums `quote_status` e `quote_tipo_servico`.
- `quote_items` grava `nome_snapshot`, `preco_tabela`, `preco_aplicado` e `motivo_desconto` — mudar a tabela de preços depois não altera orçamentos existentes.
- Seed dos 13 itens na própria migração, vinculados à Turbine Clean.
- Server functions em `src/lib/quotes.functions.ts` para salvar/duplicar: recalculam subtotais, desconto, total, custo de deslocamento (lendo `cost_per_km` de `app_settings`), custo total e margem antes de persistir; exclusão de item do catálogo bloqueada quando existe `quote_items` referenciando.
- Novas rotas `src/routes/_authenticated/orcamentos.tsx` e `orcamentos.$quoteId.tsx`, nova aba em `configuracoes.tsx`, item de menu em `app-shell.tsx` com guarda de papel (técnico sem acesso).
- Reordenação com `@dnd-kit/core` + `@dnd-kit/sortable` (dependência nova), gravando `ordem`.
- Reuso de `MoneyInput`/`IntegerInput` e dos helpers de `src/lib/format.ts`; textos das mensagens em `src/lib/quote-message.ts`.
- `quotes` ganha `cep`, `valor_a_vista` e `generated_work_order_id` (FK `work_orders`, nulo até converter); status inclui `convertido`.
- Estimativa de km reusa `src/lib/route-suggest.server.ts` / `geo.server.ts` (ViaCEP + geocode em cascata com cache) para calcular a distância entre a base do técnico e o CEP, ×2.
- Conversão em OS: server function `converterOrcamentoEmOs` cria/reaproveita o cliente por telefone, monta a OS com os `quote_items` e grava `generated_work_order_id`.
- Indicadores do mês (contagem, valor orçado, convertidos, taxa de conversão) calculados por consulta agregada sobre `quotes` filtrada por `created_at` no mês.
