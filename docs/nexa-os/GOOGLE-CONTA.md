# Conta Google por empresa (Drive, Docs e Agenda)

## O que mudou

No Lovable, o Google funcionava por um conector do próprio Lovable, que não existe fora dele. Por
isso, depois da migração, documentos da OS, pastas no Drive e agenda pararam.

O código dessas funções continua o mesmo:
- modelos de Higienização, Impermeabilização e combinado;
- pasta `Materiais dos clientes / ano / mês / OS nº - Cliente`, com subpastas;
- documento preenchido;
- termo de garantia;
- compartilhamento com o cliente;
- eventos na agenda.

Mudou só **como o app entra no Google**. Agora cada empresa conecta a própria conta Google em
**Configurações → Modelos de ordem de serviço**, sem código:

1. Um administrador da empresa clica **Conectar conta Google**.
2. Na tela do Google, entra com a conta que tem os modelos e a pasta, e marca todas as permissões.
3. Volta para o Nexa OS com a conta conectada. O mesmo cartão aparece na aba **Google Agenda**.

Detalhes técnicos:
- **Permissões pedidas:**
  - Google Drive: copiar os modelos, criar pastas e documentos, compartilhar com o cliente. A API
    do Docs usa a mesma permissão.
  - Eventos do Google Agenda.
  - E-mail da conta, só para mostrar qual está conectada.
- **Token:** o token de renovação fica em `google_conexao_segredos`, que nenhum usuário lê; só o
  servidor lê.
- **Tela:** mostra a conta, o aviso quando falta alguma permissão, **Trocar conta** e
  **Desconectar**. Desconectar também revoga o acesso no Google.
- **Autorização revogada ou vencida:** a tela passa a pedir "Conectar de novo".

## Configuração única da Nexa (Google Cloud)

Feita uma vez só, no mesmo projeto do Google Cloud onde está o Cloud Run. Nenhuma chave passa por
chat: elas são coladas direto no Cloud Shell.

### Parte A: ligar as APIs (Cloud Shell)

```bash
gcloud services enable drive.googleapis.com docs.googleapis.com calendar-json.googleapis.com
```

### Parte B: tela de consentimento e cliente OAuth (console)

Menu **APIs e serviços → Tela de consentimento OAuth** (ou **Google Auth Platform**):

1. **Branding**:
   - nome do app `Nexa OS`;
   - e-mail de suporte;
   - e-mail de contato do desenvolvedor;
   - **Página inicial**: `https://nexaos-980094719320.southamerica-east1.run.app`;
   - **Política de Privacidade**: `https://nexaos-980094719320.southamerica-east1.run.app/privacidade`;
   - **Termos de Serviço**: `https://nexaos-980094719320.southamerica-east1.run.app/termos`;
   - **Domínios autorizados**: `nexaos-980094719320.southamerica-east1.run.app`. Use o endereço
     completo: `run.app` é um sufixo público, como `.com.br`, então o domínio "próprio" do app é o
     endereço inteiro.
2. **Público-alvo (Audience)**: tipo **Externo**. Depois clique **Publicar aplicativo** (*Publish
   app*) para ficar "Em produção".
   **Importante:** em "Teste", a autorização expira em 7 dias.
3. **Clientes** → **Criar cliente**:
   - tipo **Aplicativo da Web**, nome `Nexa OS`;
   - em **URIs de redirecionamento autorizados**, adicione:
     `https://nexaos-980094719320.southamerica-east1.run.app/api/public/google/retorno`
   - clique **Criar** e deixe a janela aberta com o **ID do cliente** e a **Chave secreta do
     cliente**.

Enquanto o Google não verificar o app, a tela de autorização mostra "O Google não verificou este
app". Basta clicar **Avançado → Acessar Nexa OS**. A verificação é opcional e pode ser pedida
depois. Sem ela, o limite é de 100 contas Google.

### Parte C: guardar as chaves e ligar ao Cloud Run (Cloud Shell)

```bash
read -p "Cole o ID do cliente e tecle Enter: " ID
printf '%s' "$ID" | gcloud secrets create google-client-id --data-file=-
read -s -p "Cole a chave secreta do cliente e tecle Enter: " SEG; echo
printf '%s' "$SEG" | gcloud secrets create google-client-secret --data-file=-
unset ID SEG
NUM=$(gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)')
for S in google-client-id google-client-secret; do
  gcloud secrets add-iam-policy-binding "$S" --role=roles/secretmanager.secretAccessor \
    --member="serviceAccount:${NUM}-compute@developer.gserviceaccount.com" >/dev/null
done
gcloud run services update nexaos --region southamerica-east1 \
  --update-secrets=GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest
echo "Pronto."
```

### Parte D: conectar a Turbine (no app)

1. **Configurações → Modelos de ordem de serviço → Conectar conta Google**. Use a conta onde estão
   os 3 modelos.
2. Cole os links:
   - dos 3 modelos;
   - da **pasta de destino**: a pasta onde fica (ou vai ficar) "Materiais dos clientes".
3. Marque **Integração ativa**, clique **Salvar integração** e depois **Testar integração**.
4. Aba **Google Agenda**: escolha a agenda, ligue a integração, **Salvar** e **Testar conexão**.

## Testes

| Teste | O que verifica |
|---|---|
| `supabase/tests/050_google.sql` | Cada empresa vê só a própria conexão. Ninguém lê o token. Usuário não cria, altera nem apaga conexão. O token sai junto ao desconectar. Validado com mutação. |
| `src/lib/google-auth.server.test.ts` | "State" da autorização assinado: outro segredo, empresa trocada, prazo vencido e lixo são recusados. Endereço de retorno só https (ou local). E-mail lido do id_token. |
| Navegador (banco real, usuário temporário) | O botão leva ao Google com o cliente, o retorno e as permissões certas. Um "state" adulterado e o cancelamento voltam com aviso. O cartão aparece nas duas abas. |
