/**
 * Dados das páginas públicas (Privacidade, Termos, Exclusão de dados). Um lugar só para trocar.
 * Endereço do app: https://app.nexaperformanceos.com.br.
 */
export const EMPRESA_LEGAL = "Nexa Performance";
/** Como no cadastro verificado da Meta. */
export const RAZAO_SOCIAL = "MARIA FERNANDA GONCALVES GERMANO";
export const CNPJ = "50.529.101/0001-22";
export const ENDERECO = "Rua Doutor Augusto do Amaral, 94, Vila Nina, São Paulo/SP, CEP 02831-030";
/** Responsável, numa linha (rodapé e páginas legais). */
export const RESPONSAVEL = `${EMPRESA_LEGAL} (${RAZAO_SOCIAL}, CNPJ ${CNPJ}), ${ENDERECO}`;
/** Guarda dos eventos brutos do WhatsApp (webhook), em dias. */
export const GUARDA_EVENTOS_DIAS = 90;
/** E-mail do encarregado (LGPD) e dos pedidos de exclusão. */
export const CONTATO_PRIVACIDADE = "contato@nexaperformanceos.com.br";
/** Prazo para atender pedidos de exclusão (dias). */
export const PRAZO_EXCLUSAO_DIAS = 15;
export const ATUALIZADA_EM = "6 de novembro de 2026";

/** Edge Function que responde a situação de um pedido feito pelo Facebook. */
export const URL_SITUACAO_EXCLUSAO =
  "https://avvxapeplhuiruijyyed.supabase.co/functions/v1/nexa-meta-exclusao";
