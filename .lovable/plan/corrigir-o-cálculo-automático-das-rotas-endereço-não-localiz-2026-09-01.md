# Corrigir o cálculo automático das rotas (endereço não localizado)

## O que está acontecendo

O agendamento automático **está rodando todos os dias** (o registro do dia 31/08 rodou às 23:59 de Sao Paulo, sem falha do job). O que falha é a **leitura do endereço no mapa**: em vários dias a rota fica com status "Erro no cálculo" e a mensagem "endereço não localizado no mapa".

Causa confirmada por teste direto no serviço de mapas: hoje o app monta a busca com rua + número + **bairro + CEP** de uma vez. Com o bairro e o CEP juntos, o serviço (OpenStreetMap/Nominatim) não encontra nada e devolve vazio; a mesma rua e número, sem bairro e sem CEP, é encontrada normalmente.

Testes feitos com endereços reais que falharam:

```text
"Rua Celso Ramos, 132, Vila Andrade, São Paulo, SP, 05734080"  -> vazio
"Rua Celso Ramos, 132, São Paulo, SP"                          -> encontrado
"Rua Tungue, 164, Jardim Cidade Pirituba, São Paulo, SP, 02945-110" -> vazio
"Rua Tungue, 164, São Paulo, SP"                               -> encontrado
```

Também não há nenhum cache: todos os clientes estão com latitude/longitude vazias, então o mapa é consultado de novo a cada cálculo — o que aumenta a chance de bloqueio por excesso de consultas e deixa o fechamento lento.

## O que vai ser feito

1. **Busca em cascata do endereço** — em vez de uma tentativa só, tentar em ordem até achar:
   - busca estruturada (rua + número, cidade, estado, país);
   - rua + número + cidade + estado (sem bairro e sem CEP);
   - rua + cidade + estado;
   - CEP + cidade (última tentativa, como aproximação).
   Só marca como "não localizado" se todas falharem.
2. **Guardar as coordenadas** no cadastro do cliente (latitude/longitude já existem na tabela). Na próxima vez o mapa nem é consultado: fica mais rápido, mais estável e sem risco de bloqueio.
3. **Espaçar as consultas** (uma por segundo, com uma nova tentativa em caso de bloqueio temporário), respeitando o limite de uso do serviço gratuito.
4. **Reprocessar o que ficou parado**: no fechamento diário e no fechamento do mês, as rotas com status "Erro no cálculo" e marcadas para recalcular voltam a ser tentadas automaticamente, e a tela de Rotas ganha um botão "Recalcular" claro para as rotas com erro, mostrando quais clientes falharam.
5. **Mensagem de erro mais útil**: quando ainda não achar, indicar o cliente e sugerir corrigir/completar o endereço no cadastro.

## Detalhes técnicos

- `src/lib/geo.server.ts`: `geocode()` passa a receber as partes do endereço e tentar a cascata (structured query `street/city/state/country` + variações livres), com `sleep` entre chamadas e retry em HTTP 429/503.
- Novo cache persistente: ler `customers.latitude/longitude` antes de consultar o mapa e gravar após o sucesso (mesma abordagem para `technicians.base_latitude/base_longitude`).
- `src/lib/route-calc.server.ts` / `src/lib/route-auto.server.ts`: usar o cache, propagar falhas por cliente e reprocessar rotas com `route_status = 'Erro no cálculo' AND needs_recalculation`.
- `src/routes/_authenticated/rotas.tsx`: botão de recalcular e detalhe dos endereços que falharam.
- Sem mudança de schema: latitude/longitude já existem nas tabelas.
- Depois de aplicar, rodar um reprocessamento das rotas em erro de agosto para gerar os custos que faltaram.
