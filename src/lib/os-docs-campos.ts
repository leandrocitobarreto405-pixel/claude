/** Modelos da OS no Google Docs: campos trocados pelo app (servidor e tela). */

/** Campos que o app troca em cada modelo (mostrados na tela de configuração). */
export const CAMPOS_MODELO_OS = [
  "{{NUMERO_OS}}",
  "{{NOME_CLIENTE}}",
  "{{NUMERO_CLIENTE_TEXTO}}",
  "{{RESUMO_VALOR}}",
  "{{FORMA_PAGAMENTO}}",
  "Tabela de itens: {{ITEM}}, {{QTD}}, {{VALOR}}, {{VALOR_HIG}}, {{VALOR_IMP}}",
];
export const CAMPOS_MODELO_GARANTIA = [
  "{{NUMERO_OS}}",
  "{{NOME_CLIENTE}}",
  "{{DATA_SERVICO}}",
  "{{TECNICO}}",
  "{{ESTOFADOS}}",
  "{{DATA_PROXIMA}}",
];
export const SEM_MODELO_GARANTIA = "Configure o modelo do termo de garantia";
