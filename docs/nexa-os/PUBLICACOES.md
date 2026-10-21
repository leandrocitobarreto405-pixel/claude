# Publicações do redesign e como voltar

Desde 02/10/2026 o redesign é feito direto na branch principal
`claude/nexa-os-multi-tenant-dl9c3s` (a que o Cloud Run `nexaos` publica) e cada etapa é
publicada assim que passa nos testes. A equipe ainda usa no dia a dia o app antigo do Lovable,
que tem banco próprio no Lovable Cloud (`aainaxrwirzrqmesoidz`), separado deste
(`avvxapeplhuiruijyyed`).

Endereço oficial do app: **https://app.nexaperformanceos.com.br** (Firebase Hosting → Cloud Run).
Webhooks, rotinas agendadas e chamadas pesadas continuam no `run.app`
(https://nexaos-980094719320.southamerica-east1.run.app). Detalhes em `infra/firebase/README.md`.

Mudanças no banco (todas aprovadas em 02/10/2026):

- "Avisos no WhatsApp" (`20261010120000`): só acrescenta campos desligados.
- "Agenda, promoção e contato interno" (`20261011120000` e `20261011120001`): acrescenta as
  tabelas `contatos_internos`, `veiculos`, `agenda_horarios_base` e `agenda_configuracoes`, o tipo
  de campanha "promocao" e troca as funções de reserva e conferência do disparo para cancelar
  envios a contatos internos e respeitar o "Envio ligado" na promoção.
- "Modelos de mensagem" (`20261012120000`): só acrescenta as tabelas `meta_conexoes`,
  `meta_conexao_segredos` (o token da Meta, legível só pelo servidor), `modelos_edicoes` e
  `mensagens_textos`.
- "Notificações no celular" (`20261013120000`): só acrescenta `push_inscricoes`,
  `push_preferencias` e `push_envios`. Avisos pelo WhatsApp desligados em 02/10 (dado, não código).
- "Configuração por empresa" (`20261014120000` e `20261014120001`): acrescenta campos com o
  valor de hoje (modelos por finalidade, dias de disparo, descrição do negócio na Alice) e troca
  as funções de horário, reserva e gatilhos para lerem esses campos. A Turbine ficou com os
  mesmos nomes tc_ e terça a quinta. `20261014120002` (preparação de campanhas) foi aplicada em 03/10 pelo SQL Editor (o Supabase
  pedia uma confirmação que não chegava a esta sessão); a função ficou igual à testada (só as
  quebras de linha vieram no formato do Windows, o que não muda nada).
- "Configuração da empresa" (`20261015120000` e `20261015120001`): acrescenta
  `implantacao_etapas`, a liberação em `empresas` (a Turbine entrou liberada), travas que impedem
  ligar a Alice e os envios de empresa não liberada, e a reserva do disparo passa a ignorar
  empresa não liberada. Voltar o app não precisa mexer no banco: o app anterior não usa nada disso.
- "Cidade e estado" (`20261016120000`): só acrescenta `cidade` e `estado` em `empresas` (Turbine
  São Paulo/SP). O rodízio não precisou de banco: só vale com veículo com dia de rodízio.
- "Listas de leads" (`20261017120000`, aplicada em 04/10): acrescenta campos (datas do orçamento
  e da perda por preço, coordenadas do contato, limite de marketing, chave/listas/margem/km/custo
  de produto da promoção) e funções de leitura das listas. A Turbine ficou com a promoção liberada
  e produto R$ 6 (higienização) e R$ 80 (impermeabilização). A promoção de dia vago (04/10) não
  mexeu no banco: só guarda coordenadas encontradas (contatos e base do técnico) para não
  procurar de novo.
- "Campanhas pelas listas" (`20261018120000`, aplicada em 04/10): campo `listas` nas campanhas (os
  12 rascunhos receberam as listas equivalentes aos grupos), contagem das listas da campanha,
  aprovação dos lembretes do dia e a reserva do disparo passa a cancelar campanha/promoção para
  quem recebeu outra mensagem de marketing nos últimos 30 dias (editável). `20261018120001`
  (preparar campanha pelas listas e segurar os lembretes de 6 meses e 13º mês até a aprovação)
  vai pelo SQL Editor; até lá a preparação continua pelos grupos e os lembretes saem sozinhos,
  como antes. Voltar o app não precisa mexer no banco. A parte 2 foi rodada no SQL Editor em
  04/10 e conferida (funções iguais às testadas).
- "Km guardado e janela dos lembretes" (`20261019120000`, aplicada em 04/10): tabela
  `rotas_distancias` (km pelas ruas já consultados; só o servidor usa) e campanha sem quem está na
  janela do lembrete de 6 meses ou do 13º mês (já vale na contagem). `20261019120001` (a mesma
  regra na preparação da campanha) foi rodada no SQL Editor em 04/10 e conferida.
- "Planilha das listas" (`20261020120000`, aplicada em 04/10): `planilha_listas_id` e
  `planilha_listas_atualizada_em` em `mkt_configuracoes` e a leitura das listas pela rotina das
  9h (só o servidor). A planilha "Nexa OS — Listas" fica no Drive da conta Google da empresa.
- "Pediu orçamento na importação" (`20261021120000`, aplicada em 04/10): a importação da base
  entende a coluna "Pediu orçamento" (Sim/Não). Com "Sim", a data de entrada do lead vira a data
  do orçamento (sem apagar uma data mais nova), e o contato vai para "Orçamento sem
  agendamento" em vez de "Conversou". Só troca a função `mkt_importar_contatos`.
- "Lembretes adiados" (`20261022120000`, aplicada em 04/10): lembrete de 6 meses e do 13º mês
  não sai para quem recebeu campanha ou promoção há menos de 30 dias; a pessoa fica para o dia em
  que completar os 30 dias, se ainda estiver na época do lembrete. Acrescenta `mkt_lotes.adiados`
  (quantos ficaram para depois, mostrado na aprovação em Avisos) e troca `mkt_gerar_gatilhos`.
- "Faixas sem sobrepor" (`20261023120000`, aplicada em 04/10): "até Y" inclui o dia Y e "de X"
  começa no dia X + 1 (90 dias fica só em "até 90"; 365 só em "até 1 ano"). Só troca
  `private.mkt_no_intervalo`.
- "Rascunhos dos modelos" (`20261024120000`, aplicada em 04/10): tabela `modelos_rascunhos`
  (texto novo de um modelo, com empresa e RLS: só o admin lê; só o servidor grava) e os botões
  "Quero aproveitar!", "Me mostre as datas", "Quero renovar" e "Quero um orçamento" contando como
  interesse. Nada vai para a Meta sem o admin tocar em enviar. Dados (não código): 16 rascunhos da
  Turbine e a "Regra do 13º mês" no fim das instruções da Alice da Turbine.
- "Campanhas novas" (`20261025120000`, aplicada em 05/10): `mkt_campanhas.quem_responde`
  ('alice' ou 'equipe', padrão 'alice') e `criada_por`; resposta de campanha "equipe" tira a Alice
  da conversa com nota interna. O preparo novo (etiqueta própria da campanha e lotes com as listas
  quentes primeiro) agora vem em `20261026120001`, que substitui o `20261025120001`.
- "Dia e horário próprios" (`20261026120000`, aplicada em 05/10): `mkt_campanhas.hora_inicio`
  (vazio = dias e horário da configuração; preenchido 08:00–20:00 = qualquer dia, inclusive hoje).
  Aprovação até 10 minutos antes do primeiro disparo; envio no horário escolhido, até as 21h.
  `20261026120001_preparar_horario.sql` (preparo com hoje/qualquer dia, etiqueta por campanha,
  listas quentes primeiro e limite de pessoas por lista) foi rodada no SQL Editor em 06/10 e
  conferida (igual à testada); versões `20261025120001` e `20261026120001` registradas.
- "Saudação automática" (`20261027120000`, aplicada em 06/10): `private.ia_mensagem_automatica` e
  `ia_agendar_por_mensagem` — eco do app do celular (sender nulo, `external_echo`) até 10 s da
  primeira mensagem do cliente numa conversa nova, ou com texto de saudação/ausência já vista,
  não tira a Alice da conversa.
- "Usuários e Equipe" (`20261028120000`, aplicada em 07/10): `salespeople.email`,
  `technicians.user_id` e `foto_path`; gatilho em `usuarios_empresa` que liga (login, e-mail ou
  mesmo nome) ou cria a vendedora/técnico ao entrar ou mudar de papel, e desativa ao sair do papel;
  pasta privada `equipe-fotos`. Dados de 07/10 (Turbine): técnico "Josué Barreto", Maria e Carol
  ligadas aos logins, Alice (IA) com 3%, sábado 9h e 14h; roteiro da Alice versão 4 e agenda
  automática ligada.
- "Regras do orçamento" (`20261030120000`, aplicada em 07/10): `tabela_precos_itens.categoria`,
  tabela `orcamento_configuracoes` (tudo desligado por padrão; só admin grava) e campos de preço
  editado/vitrine em `quote_items`, `quotes` e `service_items`. Só acrescenta. Dados: Ecoprime
  com categorias, desconto do item adicional 40%, mínimo de cadeiras R$ 90, muito sujo 10%,
  vitrine 20%/10%, até 5x, validade 2 dias, textos da mensagem em rascunho neutro.
- "Termo por modelo" (sem migração): `os_document_settings.templateGarantia` (JSON em
  `app_settings`). Em 08/10 configurado só na Turbine (modelo `1Kq_s36d…`). OS de teste
  `TESTE-GARANTIA` (cliente fictício, R$ 0,00, telefone 00000000000) criada para conferir o termo.
- "Classe e acréscimos" (`20261031120000`, aplicada em 08/10): classe A e acréscimos por item
  em `orcamento_configuracoes` (desligados por padrão), classe/marcações/% em `quote_items` e
  `desconto_tipo`/`desconto_pct` em `quotes`. Só acrescenta. Dados de 08/10 (só Turbine):
  impermeabilização = 2 × higienização em 13 itens e nova ordem da tabela (voltar: valores antigos
  em `voltar-tabela-turbine-0810.sql`, guardado na sessão; resumo: retrátil 649,90/649,90/799,90/
  899,90, comum 549,90/649,90/749,90, sofá-cama igual ao retrátil, poltrona 239,90, cabeceira
  485,90); linha de regras da Turbine com só classe (A +20%) e acréscimos (almofadas soltas e muito
  encardido +10%) ligados. Roteiro da Alice: seção 4 trocada pelo texto aprovado
  (`docs/nexa-os/alice/turbine-secao4-0810.md`); cópia exata da anterior em
  `docs/nexa-os/alice/turbine-secao4-ate-0810.md` (md5 do roteiro antes: `189b2512…`, depois:
  `0879f123…`). Para voltar, trocar a seção 4 do roteiro (de "## 4." até "## 5.") pelo arquivo
  da cópia.
- "Colchão adicional" (`20261101120000`, aplicada em 09/10): `tabela_precos_itens.preco_adicional`,
  `adicional_pos_fechamento` em `quote_items` e `service_items`, `adicional_oferecido_em` e
  `adicional_aceito` em `quotes`. Só acrescenta. Dados (só Turbine): colchão como adicional
  solteiro 159,90, casal 199,90, queen 229,90, king 269,90. Roteiro da Turbine: classe = tecido
  (linho, veludo, bouclé), oferta de colchão depois do fechamento e Etapa 3 "considerei de 2,30 a
  2,50 m" (seção 4 atual em `docs/nexa-os/alice/turbine-secao4-0910.md`; md5 do roteiro
  `d623b742…`).
- "Alice: uma resposta por vez e cliente antigo" (`20261102120000`, aplicada em 12/10): troca
  `ia_reservar_tarefa` (não começa uma resposta da Alice enquanto outra da mesma conversa roda;
  a segunda é adiada e volta para a fila), cria `private.ia_cliente_antigo(contato, desde)`
  (cliente antigo = serviço realizado: atendimento concluído, lead realizado ou comprador na
  base; a função antiga continua existindo) e troca o gatilho `ia_agendar_por_mensagem` para
  usá-la. Acrescenta `crm_followups.conversa_id` e o gatilho `trg_crm_followup_unico_por_conversa`
  (um follow-up pendente por conversa; os anteriores da mesma conversa, e os da Alice sem conversa
  do mesmo lead, são cancelados; follow-up feito à mão no CRM não é tocado). Para voltar a regra
  antiga do cliente antigo sem apagar nada: recriar `ia_agendar_por_mensagem` como em
  `20261027120000_alice_saudacao_automatica.sql`.
  Dados em 12/10 (aprovados): roteiro da Turbine com a Etapa 6 nova (janela de chegada, encaixe,
  troca de data com `remarcar_horario`, upsell com `avisar_equipe`), a linha do desconto da
  Etapa 5 e a linha da véspera (md5 antes `d623b742…`, depois `ec62229f…`; trechos antigos em
  `docs/nexa-os/alice/turbine-etapa6-ate-1210.md`); 4 lembretes duplicados de uma cliente
  marcados como "Cancelada" (nada apagado).
- "Tapete por m² e persiana" (`20261103120000`, aplicada em 12/10): categorias `tapete` e
  `persiana` na tabela de preços, `quote_items.quantidade` e `service_items.quantity` em
  numeric(10,2) (valores existentes iguais) e `service_items.unidade` ('un' / 'm2'). Dados (só
  Turbine): impermeabilização de colchão 399,80 / 499,80 / 579,80 / 678,00 e 7 itens novos
  (3 tapetes por m², 4 persianas por peça, ordem 23 a 29). Para voltar os dados: colchões com
  `preco_impermeabilizacao = NULL` e os 7 itens com `ativo = false`.
  Roteiro da Turbine em 13/10 (aprovado): colchão só higienização (impermeabilização só se o
  cliente fizer questão), "tapete" saiu da lista de transferência e entrou o parágrafo de tapete e
  persiana (md5 antes `ec62229f…`, depois `a634c188…`; trechos antigos em
  `docs/nexa-os/alice/turbine-colchao-tapete-ate-1310.md`).
- "Alice depois do agendamento" (`20261104120000`, aplicada em 13/10): só acrescenta campos em
  `ia_configuracoes` (confirmação na véspera, pós-venda e avaliação, todos desligados; horário
  10:00) e a tabela `ia_pos_atendimento` (o que foi mandado e a resposta, com RLS por empresa).
  Troca `mkt_gerar_gatilhos` só para o C1 do marketing pular quando o pós-venda da Alice estiver
  ligado (desligado, nada muda). Para voltar a função: recriar a de `20261029120000`. Dados
  (Turbine): nomes dos modelos `tc_confirmacao_servico` e `tc_pos_venda` na configuração e os
  dois como rascunho em Modelos de mensagem (origem "Parte 2 (13/10)"), sem botões, para envio à
  Meta pela própria equipe.
- "Leads do site" (`20261105120000`, aplicada em 13/10): só acrescenta. Tabelas
  `leads_site_planilhas`, `leads_site` e `leads_site_configuracoes` (RLS por empresa; técnico
  não vê; só o servidor grava), as funções `leads_site_registrar` e `leads_site_atualizar`,
  `so_no_app` em `mkt_avisos` (com trava: aviso só no app não pode ser marcado como enviado no
  WhatsApp) e `lp_origem`, `utm_term`, `gclid`, `gbraid` em `crm_leads` (preenchidos só quando
  vazios). Dados (Turbine): configuração com o envio automático desligado, rascunho
  `tc_lead_site` em Modelos de mensagem (origem "Leads do site (13/10)") e as duas planilhas das
  LPs (ids só no banco, fora do repositório). Para parar a leitura sem mexer no código: "Pausar
  leitura" em Configurações → Leads do site (ou `ativa = false`).
- "Leads do site: chave do cadastro" (`20261106120000`, aplicada em 13/10): só acrescenta
  `leads_site.chave` (data/hora de São Paulo + telefone, preenchida nos 35 cadastros já lidos,
  sem repetição) com índice único por planilha, `leads_site_planilhas.chaves_ignoradas` e troca
  `leads_site_registrar` (confere a aba inteira pela chave; ignora nome começando com "teste" e as
  chaves ignoradas). Saiu a restrição de linha única (a linha muda quando apagam linhas). Dados:
  as chaves dos 4 cadastros de teste de 12/10 (20h27–20h34) na lista de ignorados; os rascunhos
  `tc_confirmacao_servico` e `tc_pos_venda` recriados com o texto sem "amanhã"/"ontem" (origem
  "Ajuste 13/10: sem amanhã/ontem"); depois renomeados para `tc_confirmacao_servico_v2` e
  `tc_pos_venda_v2` (os antigos, já enviados à Meta, ficam como estão e não são usados).
- "Leads do site: 5 min e 24 h" (`20261107120000`, aplicada em 13/10): só acrescenta
  `leads_site_configuracoes.envio_24h` (padrão ligado) e muda o padrão de `envio_apos_minutos`
  para 5. Dados (Turbine): envio em 5 min (continua desligado) e `ia_configuracoes` apontando
  para os modelos `_v2`. Para voltar os nomes: `confirmacao_modelo = 'tc_confirmacao_servico'`,
  `pos_venda_modelo = 'tc_pos_venda'` (o código novo recusa os antigos; voltar exige também
  reverter `726a216`).
  Roteiro da Turbine em 13/10 (aprovado): a linha do total nos modelos de Higienização e
  Impermeabilização virou duas (total no cartão com [parcelas]; Pix com [X]% da ferramenta) e o
  passo 3 pede para copiar as duas linhas exatamente como a ferramenta devolver (md5 antes
  `a634c188…`, depois `42608b8f…`; trecho antigo em `docs/nexa-os/alice/turbine-total-pix-ate-1310.md`).
- "Google Ads: venda = OS agendada" (`20261108120000`, aplicada em 13/10): troca só a view
  `vw_conversoes_google_pendentes` (mesmas colunas). Para voltar: recriar a view de
  `20261007120000` (venda por `faturado_em`).
- "Google Ads: LP do colchão" (`20261108130000`, aplicada em 13/10): insere
  `turbinecleancolchao.lovable.app` em `ads_dominios` (Turbine). Para voltar: apagar a linha.
  Dados (13/10, script único `scripts/ads/importar-cliques-colchao.sql`): 12 cliques da planilha da
  LP do colchão em `ads_clicks` (eventos `captacao`/`importado`), 10 ligados a leads. Exportação
  de 13/10 12h55: 3 conversões na planilha do Google Ads (OS 1671, 1673 e 1677) e
  `enviado_google_em` marcado.
- "OS sem lead: vínculo automático" (`20261108140000`, aplicada em 13/10 e versão registrada;
  conferido: função existe e a tela não executa): cria `crm_ligar_os_sem_lead` (só o servidor executa). Liga OS
  criada a partir de 13/10 14h ao único lead aberto com o mesmo telefone; nenhum ou vários só
  registram em `ads_eventos`. Para voltar: `DROP FUNCTION public.crm_ligar_os_sem_lead(uuid,
- Dados da Turbine (14/10, sem migração; scripts únicos `scripts/crm/origem-lp-colchao.sql` e
  `scripts/rotas/aplicar-custo-km.sql`): mensagem pronta da LP do colchão como origem Google
  (`mensagens_origem` 42e9a0f1); 13 leads sem origem marcados como Google (`origem_automatica`):
  12 da LP do colchão e 1 com gclid das LPs de higienização/impermeabilização; `cost_per_km` =
  0,57 em `app_settings`; rotas de 07 a 10/10 com custo gerado (R$ 54,95, 7 serviços rateados,
  sem despesa: ela sai no fechamento de 01/11). Para voltar: origem nula nos 13 leads (IDs no
  relatório de 14/10), apagar os rateios dessas 4 rotas e voltar status/custos, apagar a
  mensagem pronta e a configuração.
- "Repaginada fase 1: permissões" (`20261109120000`, aplicada em 14/10): RLS. Despesas
  (`expenses`, `recurring_expenses`, `technician_expenses`) só para o admin; `visits` e
  `budget_visits` só do próprio técnico quando o papel é técnico (`private.meu_tecnico_id()`).
  Vale para o app de produção e o de teste ao mesmo tempo. Para voltar: `ALTER POLICY` de cada
  tabela de volta para `empresa_id = private.empresa_ativa()` (texto em
  `20260909000333_multiempresa.sql`).
- "Repaginada fase 1: retornos automáticos" (`20261109120001`, aplicada em 14/10): tabela
  `gatilho_erros` (RLS: admin lê), índice parcial em `crm_followups`, `crm_fechar_retornos`,
  gatilhos em `whatsapp_messages` (mensagem digitada pela equipe) e `crm_leads` (OS/encerrado),
  `crm_expirar_retornos()` (varredura). Dados (script único
  `scripts/crm/resolver-retornos-respondidos.sql`): 16 retornos pendentes da Turbine em que a
  equipe já tinha respondido ficaram "Concluída". Para voltar: `DROP TRIGGER` dos dois gatilhos e
  `DROP FUNCTION public.crm_expirar_retornos()`; os 16 retornos voltam a "Pendente" pelo
  `notes` que marca a correção.
  timestamptz)` (a varredura só registra a falha e segue).
- "Repaginada fase 2: OS de teste" (`20261110120000`, aplicada em 14/10): coluna
  `work_orders.eh_teste` (padrão falso) e a view `vw_conversoes_google_pendentes` passa a ignorar
  OS de teste. Nenhuma OS foi marcada; nada muda até alguém marcar. Para voltar: recriar a view
  com o texto de `20261108120000` e `ALTER TABLE public.work_orders DROP COLUMN eh_teste`.
- "Repaginada fase 2: origem certa" (`20261110120001`, aplicada em 14/10): gatilho
  `trg_crm_leads_origem_por_clique` (lead sem origem com gclid/gbraid vira Google automático) e
  `private.converter_lead_em_os` copia a origem para o lado vazio ao ligar lead e OS. Dados
  (idempotentes, nas duas empresas): 1 lead com gclid virou Google e 2 leads ligados a OS
  receberam a origem da OS. Script único só Turbine (`scripts/crm/renomear-site-organico.sql`,
  aplicado em 14/10): origem "Site" virou "Site (orgânico)" (a Ecoprime não mudou). Para voltar:
  `DROP TRIGGER trg_crm_leads_origem_por_clique ON public.crm_leads`, recriar
  `private.converter_lead_em_os` com o texto de `20260929120000` e `sales_origin_id = NULL` nos
  3 leads (`origem_automatica` marca quais foram).
- Fase 2, dados da Turbine (scripts únicos, aprovados e rodados em 14/10 à tarde, nesta ordem):
  `eh_teste` marcado nas OS `TESTE-GARANTIA` e `1672` (a 1672 saiu da exportação do Google Ads:
  não está em `vw_conversoes_google_pendentes` e não foi ligada a lead);
  `scripts/crm/ligar-os-antigas.sql`: 12 OS ligadas ao único lead pelo telefone (1615, 1620,
  1623, 1624, 1625, 1626, 1627, 1628, 1667, 1669, 1670, 1676), leads fechados como "Agendado",
  7 receberam a origem da OS, nenhum retorno pendente mexido, nenhuma mensagem enviada,
  registro em `ads_eventos` (`detalhe.origem = correcao_fase2`);
  `scripts/notas/criar-pedidos-os-concluidas.sql`: 4 pedidos de nota Pendente (1615 R$ 339,90,
  1628 R$ 479,80, 1668 R$ 400,00, 1674 R$ 249,90); a 1670 ficou sem pedido por decisão do dono.
  Para voltar: `eh_teste = false` nas 2 OS; nos 12 leads (IDs em `ads_eventos`),
  `linked_work_order_id = NULL`, `is_open = true`, status anterior pelo `crm_status_history`
  ("Vínculo automático") e `sales_origin_id = NULL` onde `origem_automatica`; apagar os 4
  `invoice_tasks` (status Pendente, sem nota emitida).
- "Repaginada fase 3: indicadores sem OS de teste" (`20261111120000`, aplicada em 14/10):
  `public.indicadores_funil` passa a ignorar OS de teste (conversão, vendas por origem, OS e
  recebimentos do período) e `public.crm_ligar_os_sem_lead` não liga OS de teste a lead. Mesmas
  assinaturas; nenhuma tabela ou dado alterado. Para voltar: recriar as duas funções com o texto
  de `20261004120000` e `20261108140000`.
- "Marketing sem quem tem OS ou garantia" (`20261112120000`, aplicada em 15/10 em partes, todas as
  empresas): `mkt_listas_dados` ganha `tem_os` (OS não cancelada/excluída/de teste com venda nos
  últimos 90 dias ou atendimento ainda não concluído) e `garantia_aberta` (retorno pendente com
  "garantia"/"reclama", a regra da Alice); listas, promoção, planilha diária, contagem, "presas" e
  lembretes passam a usar as duas regras (motivos "tem OS" e "garantia/reclamação em aberto");
  `mkt_reservar_envios` cancela antes de reservar o pendente de campanha/promoção de quem passou a
  ter OS e qualquer envio de quem tem garantia em aberto (erro com o motivo, nada apagado; na
  aplicação, 2 dos 314 pendentes da "Primavera"); aviso só no app `servico_nao_concluido` (coluna
  nova `mkt_avisos.referencia`, um aviso por visita). As versões anteriores de `mkt_listas_dados` e
  `mkt_motivo_fora` ficaram com o sufixo `_ate_20261112`. A troca de `mkt_preparar_campanha` não
  pôde ser feita daqui (o Supabase pede uma confirmação que não chega a esta sessão):
  `scripts/mkt/preparar-campanha-tem-os.sql` rodado no SQL Editor (conferido em 18/10: a função em
  produção já usa "tem OS" e "garantia em aberto").
  Para voltar: recriar as funções com o texto das migrações anteriores e renomear as `_ate_20261112`
  de volta.
- "Alice no Sonnet" (`20261113120000`, aplicada em 18/10, todas as empresas): o padrão de
  `ia_configuracoes.modelo` passa a `claude-sonnet-5-5` e quem estava no `claude-opus-5-5` foi
  trocado (só a Turbine). Nada apagado. Para voltar: escolher o Opus em Alice › Ajustes avançados
  (o modelo de cada execução continua em `ia_execucoes.modelo`). O painel Nexa › Alice só lê.
- "Terceirizados" (`20261114120000`, aplicada em 18/10): colunas novas e vazias em `technicians`
  (`parceiro`, com regra "parceiro sem login e sem e-mail"), `tabela_precos_itens` (`terceirizado`,
  `custo_parceiro`, `custo_parceiro_impermeabilizacao`, `parceiro_id`), `service_items`
  (`tabela_preco_item_id`, `custo_parceiro_unitario`, `parceiro_id`, `repasse_parceiro` calculado)
  e `visits.repasse_parceiro`; gatilhos que congelam o custo na linha da OS e criam/ajustam/cancelam
  a despesa "Repasse a parceiro" (`reference_key` `repasse:<visita>`) ao concluir. Dados: 7 itens de
  tapete/persiana da Turbine marcados como terceirizados (custo vazio, repasse zero até preencher) e
  técnico parceiro "Reginaldo" (sem e-mail/login) ligado a eles. As chaves estrangeiras novas não têm
  `ON DELETE` (o Supabase pede confirmação que não chega a esta sessão): item usado em OS só é
  desativado. Pendente: preencher o custo e rodar `scripts/terceirizados/religar-os-existentes.sql`
  (OS 1684 e 1685) depois da prévia. Para voltar: desligar "Terceirizado" nos itens (repasse zero).
- "Funil e comissão pelo valor líquido" (`20261115120000`, aplicada em 18/10): `indicadores_funil`
  passa a somar vendido, ticket médio e vendido por origem sem o repasse (função nova
  `private.valor_liquido_os`); gatilho em `work_orders` troca a comissão prevista/realizada gravada
  pelo app pela líquida quando a OS tem repasse, e o sincronizador do repasse recalcula a comissão
  quando o repasse muda. Na aplicação, nenhuma OS mudou (nenhuma tem repasse ainda). Para voltar:
  recriar as funções com o texto de `20261111120000` e `20261114120000` e desligar o gatilho.
- "Orçamento enviado e proposta" (`20261116120000`, aplicada em 19/10): colunas `proposta_*` em
  `quotes`; orçamento "enviado" leva o lead aberto (antes da etapa de orçamento) para "Orçamento
  enviado" com histórico, e orçamento desligado do lead desfaz. Dados (Turbine): 25 orçamentos em
  rascunho desde 01/10 com telefone passaram a "enviado" (`scripts/orcamentos/enviado-retroativo.sql`),
  24 leads foram para "Orçamento enviado" (o fechado não mudou), data do envio = do orçamento.
  Diego (OS 1682, OS de teste mantida): lead desligado da OS e reaberto em "Orçamento enviado",
  orçamento de volta a "enviado" e liberado para virar OS.
- "Lead pelo CRM" (`20261117120000`, aplicada em 19/10): `GRANT EXECUTE` de
  `private.telefone_chave` a usuários logados (criar lead pela tela dava "permission denied" desde
  07/10). Conferido com um lead de teste como usuário comum, desfeito na hora.
- "Origem Google Ads" (`20261118120000`, aplicada em 19/10, Turbine): origens "Google Ads – botão
  WhatsApp" e "Google Ads – landing"; mensagem pronta "Olá, vim do google e gostaria de mais
  informações!" → botão + serviço Higienização; clique do pop-up sem origem → landing.
  Retroativo (`scripts/origens/google-ads-retroativo.sql`): 9 leads de "Google" (automático) para
  o botão, com as OS 1668 e 1687; nenhum lead de pop-up estava sem origem.
- "PDF da OS no app" (`20261119120000`, aplicada em 19/10): só cria a pasta privada
  `empresa-logos` do armazenamento (PNG/JPG até 2 MB, pasta por empresa, troca só pelo admin).
  Os dados novos da empresa (e-mail, endereço, Instagram, logo) vão no `app_settings` "company"
  que já existia, sem apagar as chaves de antes; os textos ficam no `app_settings` "documentos"
  (sem ele, a empresa continua nos modelos do Drive). Nenhum dado foi alterado na aplicação.
- "Cupons e origem Site x Blog" (`20261120120000`, aplicada em 19/10, Turbine): 13 textos do
  site/blog em `mensagens_origem`; palavra-chave com "_" final vale como começo de palavra
  (`private.identificar_origem_lead`, resto igual) e Site/Blog ganham "cupom site_"/"cupom blog*";
  tabela `cupons` (4 cupons) e coluna `quotes.cupom`. Reprocessamento dos leads abertos sem origem
  desde 01/10: nenhum mudou. Dados (`scripts/origens/google-ads-landing-outubro.sql`): 56 leads de
  outubro em "Google" automático (51 do pop-up + 5 com o texto da landing sem gclid) passaram a
  "Google Ads – landing", com as OS 1671, 1673, 1674, 1677, 1679, 1685 e 1686; os 3 textos das
  landing pages passaram a dar essa origem. Origem escolhida à mão e os 9 do botão não mudaram.
  Roteiro da Alice (Turbine, aprovado em 19/10, só acréscimos): bloco "Cupons de desconto" no
  fim da seção 4 e "Como conheceu" na Etapa 1 (pergunta no fim da primeira resposta, nunca em
  mensagem separada). Cópia dos pontos de antes: `docs/nexa-os/alice/turbine-cupons-origem-ate-1910.md`.
- "Número do orçamento" (`20261121120000`, aplicada em 19/10): coluna `quotes.numero` (única por
  empresa) e tabela `orcamento_contadores` (RLS: só leitura da própria empresa), gatilhos de
  numeração na criação e de número fixo. Existentes numerados por ordem de criação: Turbine 1–65,
  Ecoprime 1–4; contadores 65 e 4; `updated_at` conferido igual antes/depois (gatilho do
  updated_at desligado só durante a numeração). Nenhum outro dado mudou. Para voltar: o app
  anterior ignora a coluna; o gatilho de numeração pode ficar.
- "Alice responde em áudio" (`20261122120000`, aprovada e aplicada em 19/10, depois de ensaio
  desfeito): só acréscimos. Colunas `audio_*` em `ia_configuracoes` (desligado, sem voz, 350
  caracteres, 25 s, R$ 5,00/dia, US$ 1 = R$ 5,50), `conversas.alice_so_texto_em` (vazia) e a
  tabela `ia_audios_uso` (RLS: só leitura da própria empresa; quem grava é o servidor). Conferido
  depois: nenhuma empresa ligada, nenhuma conversa marcada, configuração atual da Alice igual
  (md5 das colunas antigas antes e depois). Para voltar: desligar em Configurações › Alice; o app
  anterior ignora as colunas novas.
- Cadastro da Ecoprime (dado, aprovado em 20/10): Carol e Maria marcadas como atendentes da Nexa
  (`salespeople.atendente_nexa` false → true; percentual 5% sem mudança). Nenhuma estrutura mudou.
  Para voltar: desmarcar "atendente da Nexa" nas duas em Configurações › Equipe.
- "Caixa de entrada, item 1" (`20261123120000`, aplicada em 21/10): só acréscimos —
  `whatsapp_messages.enviada_por` e `erro_envio`, `conversas.assumida_por`, `assumida_em` e
  `lida_por` (vazio), índice por conversa/hora. Nenhum dado muda; o Chatwoot continua recebendo
  tudo pelo webhook. Para voltar: o app anterior ignora as colunas.
- "Caixa de entrada, item 2" (`20261124120000`, aplicada em 21/10): `conversas` e
  `whatsapp_messages` entram na publicação `supabase_realtime` com REPLICA IDENTITY FULL (o RLS
  por empresa vale no Realtime). Nenhum dado muda. Para voltar: tirar as duas da publicação.
- "Caixa de entrada, item 2b" (`20261125120000`, aplicada em 21/10): função
  `private.avisar_tempo_real()` + gatilhos AFTER INSERT/UPDATE em `conversas` e `whatsapp_messages`
  (mandam um aviso curto no canal privado `empresa:<id>` via `realtime.send`) e política
  "tempo real da empresa" em `realtime.messages` (cada pessoa ouve só as empresas em que está;
  admin da Nexa, todas). Motivo: o RLS do "postgres_changes" não tem o cabeçalho da empresa e
  quem tem duas empresas não recebia evento. Nenhum dado muda. Para voltar: apagar os dois
  gatilhos, a função e a política. As duas tabelas continuam na publicação `supabase_realtime`
  (sem uso; pode tirar depois).
  Correção às 07:57 (Brasília) do mesmo dia: a função referenciava `NEW.conversa_id` também
  no gatilho de `conversas`, onde o campo não existe; isso derrubava o UPDATE de `conversas` e,
  com ele, a transação inteira do webhook do Chatwoot (mensagens recebidas entre 07:40 e 07:57
  ficaram em `integracao_eventos` e foram reprocessadas pelo agendador às 08:00). A função
  agora lê a linha em jsonb e engole qualquer erro próprio como aviso, sem derrubar gravações.
- Encerramento automático de conversas (21/10): só código; a regra fica em `app_settings`
  chave `caixa_entrada` (`encerramento_automatico`, `encerramento_horas`,
  `encerramento_inclui_alice`), começa desligada em toda empresa. Como testar: Configurações ›
  Mensagens › "Conversas: encerramento automático" › "Quantas seriam encerradas agora?".
- "Próximo número de OS" (`20261126120000`, aplicada em 21/10): `empresas.proximo_numero_os`
  (inteiro, opcional), função `public.proximo_numero_os(empresa)` (maior usado + 1 ou o campo, o
  que for maior) e gatilho que impede diminuir ou ficar abaixo do maior usado. Ecoprime recebeu
  1500 (próxima OS 1500; antes seria 0004); Turbine sem mudança (próxima 1694). Dados da Ecoprime
  em `app_settings` "company": e-mail, Instagram, slogan, atividade, frase do rodapé e quem assina
  (do modelo de orçamento dela). Para voltar: tirar coluna, função e gatilho; a numeração segue
  pelo maior usado + 1.
  Como testar: Painel Nexa › Empresas › botão "Próxima OS: 1500" (Ecoprime); Configurações ›
  Empresa › Dados nos documentos › "Prévia do orçamento"; Nova OS na Ecoprime sugere 1500.
- "Caixa de entrada, item 1b" (21/10): só código e imagem (ffmpeg no Dockerfile), nenhuma
  mudança no banco.
- Blocos A, B e C (20/10): só código, nenhuma mudança no banco. "Marcar como paga" em Comissões
  lança despesas "Comissões" com `reference_key` `comissao:<vendedora>:<mês>` (índice único já
  existente impede duplicar); essas despesas ficam fora das despesas do DRE.
- "Encerramento: quem estava com a conversa" (`20261127120000`, aprovada em 21/10): só
  acrescenta `conversas.encerrada_de` ('alice'/'equipe') e `encerrada_em`, e o gatilho
  `trg_whatsapp_messages_reabrir`: mensagem do cliente numa conversa encerrada que estava com
  a Alice cria a tarefa "devolver_para_alice" (volta para pending e ela responde); se estava com
  a equipe, só limpa a marca (o Chatwoot já reabre como open). Nada é enviado ao cliente.
  Primeira rodada na Turbine em 21/10, das 13:30 às 14:35: 609 conversas paradas há mais de
  24 h encerradas (354 que estavam com a Alice, 255 com a equipe), em três lotes; 5 ficaram de
  fora pela regra 1 (2 follow-ups da equipe, 3 lembretes de 13º mês aguardando aprovação). Nada
  foi enviado ao cliente. Daí em diante, de hora em hora.
  Correção às 15:10: 48 dessas conversas tinham o cliente falando por último (esperando
  resposta) e não deviam ter sido encerradas; foram reabertas no Chatwoot e no app, de volta a
  "Precisam" com a data da última mensagem do cliente. Regra nova: só encerra quando a empresa
  falou por último; cliente por último nunca encerra por tempo. "Encerrada por tempo" (hora em
  `encerrada_em`, só pela rotina) fica separada de "Encerrada pela equipe" (botão, sem hora).

- "Caixa de entrada 3: assumir e não lidas" (`20261128120000`, aprovada em 21/10): só acrescenta
  `usuarios_empresa.chatwoot_agent_id` (quem é a pessoa no Chatwoot; a Maria ficou ligada ao
  usuário atendimento@, os demais sem ligação), `conversas.assumida_por` / `assumida_em` (quem
  assumiu pelo app) e a tabela `conversas_leituras` (até quando cada pessoa leu cada conversa;
  RLS: cada um só vê e grava as próprias, na empresa ativa; teste 550).
  Arquivos para o SQL Editor: não usar `CREATE TEMP TABLE` (o Supabase oferece "ativar RLS em
  tabela nova" e, se aceito, cola `ALTER TABLE` no meio da função e quebra). Usar variável `jsonb`
  com `jsonb_to_recordset` no lugar. Se não der para evitar, avisar no topo do arquivo para rodar
  sem aceitar a sugestão de RLS.

- "Caixa de entrada 4: duas atendentes" (21/10): sem mudança no banco. A presença ("Maria está
  com esta conversa aberta agora") vai pelo canal privado `empresa:<id>` do Realtime que já
  existia, mandada pelo servidor (API de broadcast com a chave de serviço); fica só na memória
  de cada aba e some em 70 s sem aviso.

Voltar a versão do app continua seguro: o app anterior não usa as tabelas novas, e as funções
do banco continuam funcionando com ele (uma promoção criada antes da volta é pausada sozinha,
sem enviar, porque o app anterior não sabe preencher o desconto do Pix).

| Data (UTC)       | Etapa                                                              | Commit publicado    | Versão anterior (commit) |
| ---------------- | ------------------------------------------------------------------ | ------------------- | ------------------------ |
| 02/10/2026 00:56 | Base + Agenda                                                      | `86d9d15`           | `4a942a7`                |
| 02/10/2026 13:41 | Início + Conversas                                                 | `a8568c6`           | `86d9d15`                |
| 02/10/2026 13:59 | Avisos (tela)                                                      | `133e6bc`           | `fab37c7`                |
| 02/10/2026 14:21 | Avisos no WhatsApp                                                 | `91771de`           | `61c19e2`                |
| 02/10/2026 14:31 | Marketing                                                          | `79ef000`           | `8d7cbd9`                |
| 02/10/2026 16:56 | Agenda + promoção                                                  | `f9e84ce`           | `4d9ef1f`                |
| 02/10/2026 17:28 | Modelos de mensagem                                                | `316b11e`           | `2f900e8`                |
| 02/10/2026 18:27 | Notificações push                                                  | `b84c49d`           | `50112f8`                |
| 02/10/2026 18:38 | Tela do serviço                                                    | `3c40039`           | `b84c49d`                |
| 02/10/2026 19:15 | Conversas (espera)                                                 | `716ea28`           | `3c40039`                |
| 02/10/2026 22:19 | Config. por empresa                                                | `0e7ab52`           | `716ea28`                |
| 02/10/2026 22:44 | Checklist empresa                                                  | `4a6ac5a`           | `30a7c79`                |
| 03/10/2026 13:40 | Cidade e estado                                                    | `78be8c4`           | `e4aa78c`                |
| 03/10/2026 18:32 | Convite (WhatsApp)                                                 | `4e03e42`           | `25a9ad6`                |
| 03/10/2026 20:14 | Esqueci a senha                                                    | `2703b3f`           | `f54d21b`                |
| 04/10/2026 01:07 | Encerrar conversas                                                 | `eeaaa67`           | `ff9f68e`                |
| 04/10/2026 01:46 | Listas de leads                                                    | `869d8bf`           | `0584c05`                |
| 04/10/2026 02:20 | Promoção dia vago                                                  | `523dc67`           | `869d8bf`                |
| 04/10/2026 05:55 | Campanhas e listas                                                 | `e74d8b3`           | `b0d51b4`                |
| 04/10/2026 12:23 | Domínio e km guardado                                              | `48e5b05`           | `624dbf1`                |
| 04/10/2026 13:18 | Planilha das listas                                                | `2120cf0`           | `76bf5e9`                |
| 04/10/2026 17:23 | Pediu orçamento                                                    | `9d2ff92`           | `cd89379`                |
| 04/10/2026 22:43 | Modelos e lembretes                                                | `2a0e0a6`           | `f7b9952`                |
| 04/10/2026 23:10 | Faixas sem sobrepor                                                | `2fd5120`           | `cfcfdd9`                |
| 04/10/2026 23:10 | Rascunhos de modelos                                               | `6287c8e`           | `2fd5120`                |
| 05/10/2026 14:51 | Nova campanha                                                      | `31b70cb`           | `007631d`                |
| 05/10/2026 13:55 | Quantas pessoas                                                    | `9145f99`           | `0348392`                |
| 06/10/2026       | Equipe (vendedoras)                                                | `6b92091`           | `9f501df`                |
| 06/10/2026       | Comissão da Nexa                                                   | `db1aa08`           | `1c22651`                |
| 06/10/2026       | Saudação e modelos                                                 | `b3944d7`           | `db1aa08`                |
| 07/10/2026       | Transcrição de áudio                                               | `607ace7`           | `cf99f6e`                |
| 07/10/2026       | Agenda livre (Alice)                                               | `88dca53`           | `607ace7`                |
| 07/10/2026       | Áudio longo                                                        | `f8f2043`           | `88dca53`                |
| 07/10/2026       | Usuários e Equipe                                                  | `d46f737`           | `f8f2043`                |
| 07/10/2026       | Foto do técnico                                                    | `c638c08`           | `d46f737`                |
| 07/10/2026       | Alice agenda e faz OS                                              | `680c36c`           | `8f45a3f`                |
| 07/10/2026       | Alice sem relatório                                                | `368a4a8`           | `91e8a0a`                |
| 07/10/2026       | Avisos e envio                                                     | `bc90d8f`           | `45b5b25`                |
| 07/10/2026       | Tirar e chamar à mão                                               | `90a2c85`           | `3f5f954`                |
| 07/10/2026       | Lotes e qualidade                                                  | `8721715`           | `1534642`                |
| 07/10/2026       | Tela após chamada                                                  | `aac86f7`           | `eb2390c`                |
| 07/10/2026       | Um documento por OS                                                | `bc1eee9`           | `7c62927`                |
| 07/10/2026       | Fotos e vídeos (Drive)                                             | `6604089`           | `e6a59d8`                |
| 08/10/2026 00:40 | Regras do orçamento                                                | `dd5864a`           | `f107c0d`                |
| 08/10/2026 01:30 | Termo por modelo                                                   | `478ed9c`           | `6783fec`                |
| 08/10/2026 23:55 | Classe e acréscimos                                                | `460cd55`           | `3b7a39b`                |
| 09/10/2026 00:40 | Colchão adicional                                                  | `f9fd9d4`           | `4348cb9`                |
| 12/10/2026 08:35 | Alice: fila e remarcar                                             | `3a187c2`           | `57b03a0`                |
| 12/10/2026 21:00 | Tapete m² e persiana                                               | `fbc8359`           | `d333a88`                |
| 13/10/2026       | Aviso do colchão                                                   | `c24f447`           | `4d77c77`                |
| 13/10/2026 01:10 | Alice: pós-venda                                                   | `88a35ff`           | `c70334a`                |
| 13/10/2026       | Leads do site                                                      | `330c885`           | `e4bd2b4`                |
| 13/10/2026       | Modelos sem dia fixo                                               | `8dd3429`           | `3525b5b`                |
| 13/10/2026       | Leads: chave/teste                                                 | `cb57b45`           | `8dd3429`                |
| 13/10/2026       | Modelos \_v2                                                       | `726a216`           | `ff6838f`                |
| 13/10/2026       | Leads: 5 min e 24 h                                                | `7f074bd`           | `726a216`                |
| 13/10/2026       | Véspera todo dia                                                   | `d9bfba9`           | `52468cd`                |
| 13/10/2026       | Orçamento: Pix à parte                                             | `35bd321`           | `aede577`                |
| 13/10/2026       | Ads: venda pela OS                                                 | `c2d5c6e`           | `a7324bc`                |
| 13/10/2026       | Ads: LP do colchão                                                 | `00d9199`           | `c2d5c6e`                |
| 13/10/2026       | Ads: exportação diária                                             | `80af6e0`           | `ed44911`                |
| 13/10/2026       | OS → lead automático                                               | `8da17fb`           | `9fcb153`                |
| 13/10/2026       | Ads: valor como número                                             | `653c16c`           | `8da17fb`                |
| 14/10/2026       | Custo km tela + DRE                                                | `10cdec4`           | `19b6aac`                |
| 14/10/2026       | Repaginada fase 1 (só na `redesign`/`nexaos-teste`)                | `dcdcee3`…`5e5664c` | `ec181d0`                |
| 14/10/2026       | Repaginada fase 2 (só na `redesign`/`nexaos-teste`)                | `2608685`…`9c8ebbd` | `99f7a88`                |
| 14/10/2026 22:19 | Alice: Reagendado e OS de teste (produção)                         | `8b85f6d`           | `ec181d0`                |
| 14/10/2026       | Repaginada fase 3 (só na `redesign`/`nexaos-teste`)                | `d2ab520`…`a2b7099` | `ce3ff5d`                |
| 15/10/2026 02:00 | Repaginada fases 1, 2 e 3 (merge da `redesign`)                    | `db7a286`           | `8b85f6d`                |
| 15/10/2026 03:16 | Google Ads: planilha em en_US                                      | `af804c4`           | `0279885`                |
| 15/10/2026       | Marketing sem quem tem OS ou garantia                              | `8bc25cb`           | `fff5cb2`                |
| 18/10/2026       | Alice mais barata + painel Nexa › Alice                            | `9438aa0`…`caf0b6a` | `c935863`                |
| 18/10/2026       | Terceirizados (tapete e persiana)                                  | `6594530`           | `d93b042`                |
| 18/10/2026       | Funil e comissão pelo valor líquido                                | `58cd399`           | `a5fd147`                |
| 19/10/2026       | Orçamento enviado, proposta, origem Google Ads                     | `9efdd87`…`7503746` | `9cd38a0`                |
| 19/10/2026       | PDF da OS no app (Documentos, dados e logo)                        | `e96b898`…`4baad41` | `b3a28aa`                |
| 19/10/2026       | Cupons na Alice, origem Site x Blog e landing                      | `976ce44`           | `b60f3a9`                |
| 19/10/2026       | Correção: modo dos documentos (cache e servidor)                   | `fcbc246`           | `d6add27`                |
| 19/10/2026       | PDF do orçamento direto no app                                     | `15ca130`           | `61f50d0`                |
| 19/10/2026       | Correção: Início zerado e erros em português                       | `b300e7a`           | `04bb91d`                |
| 19/10/2026       | Número sequencial do orçamento (Nº 0153)                           | `43354bd`           | `879f892`                |
| 19/10/2026       | Notas fiscais: descrição dos serviços (NFS-e)                      | `60755c0`           | `2a7e1aa`                |
| 19/10/2026       | Alice responde em áudio (desligado)                                | `82d022b`           | `ee4cd9a`                |
| 19/10/2026       | Notas: Não emitir, Pedir nota, descrição simples                   | `16cff45`           | `0ca79a1`                |
| 20/10/2026       | Alice: áudio como mensagem de voz                                  | `056570b`           | `a198be9`                |
| 20/10/2026       | Notas: soma que não bate vira aviso                                | `3a5d85b`           | `056570b`                |
| 20/10/2026       | A: Vendido pela data do serviço (cheio)                            | `7a6fb96`           | `3a5d85b`                |
| 20/10/2026       | B: OS de teste fora e A receber por OS                             | `8d5322e`           | `e263014`                |
| 20/10/2026       | C: DRE pelo recebimento e Comissões a pagar                        | `b731429`           | `8d5322e`                |
| 21/10/2026       | Caixa de entrada 1: responder texto e modelo                       | `f946886`           | `ed18ced`                |
| 21/10/2026       | Caixa de entrada 2: tempo real e status                            | `2b48bb7`           | `7761283`                |
| 21/10/2026       | Caixa de entrada 1b: foto, documento e áudio (voz)                 | `bc88f85`           | `b371c77`                |
| 21/10/2026       | Conversas: abrir no fim, teclado, remetente, foto                  | `b248490`           | `a5a8771`                |
| 21/10/2026       | Empresa: logo/avatar, numeração de OS, PDF configurável            | `83e8145`           | `705ce65`                |
| 21/10/2026       | Caixa 2b: tempo real por empresa; voz como o Chatwoot              | `0e23814`           | `5325e8c`                |
| 21/10/2026       | Correção do gatilho do tempo real; voz sem marcação                | `6995a2a`           | `bbb4b21`                |
| 21/10/2026       | Voz: OGG normalizado (granules, pre-skip 0)                        | `ddf7900`           | `bed0829`                |
| 21/10/2026       | Conversas: busca, ordem, encerramento automático, teste 530        | `5513402`           | `ddf7900`                |
| 21/10/2026       | Voz a 40 kbit/s, balão otimista dos anexos, tempos                 | `f52b421`           | `a4bf278`                |
| 21/10/2026       | Encerramento automático ligado: regras 1-3, hora em hora           | `f2eb81c`           | `8f1101e`                |
| 21/10/2026       | Player de áudio, foto com orientação, Opus no navegador            | `2841475`           | `bf7d2f5`                |
| 21/10/2026       | Voz: OGG cru do gravador, trava de início duplo                    | `9967f00`           | `40740f2`                |
| 21/10/2026       | Encerramento: cliente por último nunca encerra; por tempo x equipe | `2272dd4`           | `8f98a46`                |
| 21/10/2026       | Caixa 3: Minhas, assumir, não lidas, digitando… e lido             | `a84c99c`           | `c0f0ec3`                |
| 21/10/2026       | Caixa 3b: largura travada, fonte 16 px, aba conta conversas        | `fb1e008`           | `76f86a4`                |
| 21/10/2026       | Caixa 4: duas atendentes (faixa, presença, assumir antes)          | `6705084`           | `5335ab0`                |

Para desfazer o merge da repaginada pelo código (sem force push): na branch principal,
`git revert -m 1 db7a286` (ensaiado em 15/10: aplica sem conflito) e enviar. O banco não precisa
voltar: as migrações das fases 1, 2 e 3 só acrescentam campos e funções que o app anterior ignora.

## Voltar rápido (cerca de 1 minuto, sem mexer no código)

No Google Cloud, abra o **Cloud Shell** (ícone `>_` no canto superior direito), cole e tecle
Enter. Troque o commit se for voltar uma publicação diferente (coluna "Versão anterior").

```bash
REGIAO=southamerica-east1
COMMIT=b84c49dd6fbac8411560bf0a9a42b1111451a857
REV=$(gcloud run revisions list --service nexaos --region "$REGIAO" \
  --filter="metadata.labels.commit-sha=$COMMIT" \
  --sort-by=~metadata.creationTimestamp --format='value(metadata.name)' --limit 1)
echo "Versão anterior: ${REV:-NÃO ENCONTRADA}"
if [ -n "$REV" ]; then
  gcloud run services update-traffic nexaos --region "$REGIAO" --to-revisions="$REV=100"
fi
```

Se aparecer **NÃO ENCONTRADA**, liste as últimas versões e escolha a de antes da publicação
(a coluna da direita mostra o commit):

```bash
gcloud run revisions list --service nexaos --region southamerica-east1 --limit 5 \
  --format='table(metadata.name, metadata.creationTimestamp, metadata.labels.commit-sha)'
gcloud run services update-traffic nexaos --region southamerica-east1 --to-revisions=NOME_DA_VERSAO=100
```

Pelo painel, o mesmo: **Cloud Run** → `nexaos` → aba **Revisões** → marque a versão anterior →
**Gerenciar tráfego** → 100% nela → **Salvar**.

Enquanto o tráfego estiver preso numa versão, as próximas publicações **não** entram no ar.
Para voltar a seguir a versão mais nova:

```bash
gcloud run services update-traffic nexaos --region southamerica-east1 --to-latest
```

## Voltar de vez (pelo código)

Peça ao Claude "desfaz a publicação". Ele cria na principal um commit que desfaz a etapa (sem
apagar histórico, sem problema com o Lovable) e o Cloud Run publica a versão antiga em ~5
minutos. Depois disso, solte o tráfego com `--to-latest` se tiver usado o caminho rápido.

## Pendências

### "Valor negociado" diferente da soma dos itens (anotado em 08/10/2026)

Na Nova OS/edição da OS, o campo "Valor negociado" aceita um total diferente da soma dos itens
(pede motivo do ajuste). Nesse caso os números se separam:

- a comissão prevista da OS (`commission_expected`) e as vendas do mês usam o **total digitado**
  (`work_orders.total_gross_value`);
- o valor de cada atendimento (`visits.visit_value`), o a receber, a receita do DRE e a comissão dos
  relatórios usam a **soma dos itens**.

Por enquanto (decisão de 08/10): o time edita o preço no próprio item (selo "editado"), não o
"Valor negociado". Sem mudança de código até nova decisão.

### Fuso horário por empresa (adiado em 03/10/2026)

Fazer só quando entrar uma empresa de **AM, RR, RO, MT, MS ou AC**. Até lá todas as empresas usam o
horário de São Paulo (os outros estados têm o mesmo horário).

Plano aprovado em linhas gerais (Etapa 2 do plano de 03/10):

- Coluna `fuso` em `empresas`, deduzida do estado sempre que ele muda, com São Paulo como padrão:
  AM `America/Manaus`, RR `America/Boa_Vista`, RO `America/Porto_Velho`, MT `America/Cuiaba`,
  MS `America/Campo_Grande`, AC `America/Rio_Branco`; demais estados `America/Sao_Paulo`.
- Funções `private.fuso_empresa(_emp)` e `private.hoje_empresa(_emp)` no lugar do horário fixo.
- Teste com uma empresa em Cuiabá: dispara às 10h de lá, a Alice respeita o horário local.
- Turbine continua com São Paulo: nada muda para ela.

Levantamento feito em 03/10/2026 (para não refazer):

**15 funções do banco com `America/Sao_Paulo` fixo**

| Função                            | Para que serve o horário                          |
| --------------------------------- | ------------------------------------------------- |
| `private.hoje_sp`                 | "hoje" usado por várias outras (contratos, datas) |
| `private.aplicar_evento_chatwoot` | data das mensagens e esperas                      |
| `private.atualizar_marcos_lead`   | datas do funil do lead                            |
| `public.indicadores_funil`        | agrupamento por dia/mês                           |
| `public.mkt_aprovar_campanha`     | véspera do disparo e horário agendado             |
| `public.mkt_calcular_grupos`      | "hoje" dos grupos de marketing                    |
| `public.mkt_confirmar_envio`      | janela de envio antes de mandar                   |
| `public.mkt_criar_promocao`       | datas da promoção                                 |
| `public.mkt_gerar_gatilhos`       | dia dos gatilhos (pós-venda, lembretes)           |
| `public.mkt_importar_contatos`    | datas dos contatos importados                     |
| `private.mkt_os_atualizada`       | data do serviço para os grupos                    |
| `public.mkt_preparar_campanha`    | "hoje" da preparação                              |
| `private.mkt_proximo_horario`     | próximo horário de disparo                        |
| `public.mkt_reservar_envios`      | janela das 8h às 21h, dia e hora do disparo       |
| `public.mkt_retomar`              | horário ao retomar campanha pausada               |

**14 arquivos do app com `America/Sao_Paulo` fixo**

| Arquivo                                                  | O que usa                                  |
| -------------------------------------------------------- | ------------------------------------------ |
| `src/lib/format.ts`                                      | `TZ` das datas mostradas nas telas         |
| `src/lib/alice/regras.ts`                                | `FUSO` do horário de atendimento da Alice  |
| `src/lib/alice/prompt.ts`                                | "hoje é…" no prompt da Alice               |
| `src/lib/alice/marketing.server.ts`                      | "hoje" das campanhas na Alice              |
| `src/lib/conversas.ts`                                   | horários na lista de conversas             |
| `src/lib/inicio.ts`                                      | "hoje" da tela Início                      |
| `src/lib/google-calendar.server.ts`                      | `TIMEZONE` dos eventos da Agenda do Google |
| `src/lib/mkt/campanhas.server.ts`                        | "hoje" das campanhas                       |
| `src/lib/push/notificacoes.server.ts`                    | resumo das 9h e "hoje" das notificações    |
| `src/routes/_authenticated/nexa/chatwoot.tsx`            | horário dos eventos do Chatwoot            |
| `src/routes/_authenticated/nexa/empresas.tsx`            | data inicial da comissão                   |
| `src/routes/_authenticated/orcamentos/index.tsx`         | mês atual dos orçamentos                   |
| `src/routes/api/public/hooks/monthly-mileage-closing.ts` | mês do fechamento de quilometragem         |
| `src/routes/api/public/hooks/recurring-expenses.ts`      | mês das despesas recorrentes               |

Conferir de novo antes de começar: `grep -rl "America/Sao_Paulo" src` e
`SELECT proname FROM pg_proc WHERE prosrc LIKE '%America/Sao_Paulo%'`.
