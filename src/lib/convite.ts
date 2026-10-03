/**
 * Texto pronto do convite (o Nexa não manda e-mail de convite: o admin envia pelo WhatsApp ou cola
 * onde quiser). Sem banco nem rede, para poder testar.
 */
import type { Papel } from "@/lib/tenant";

const ROTULO_PAPEL: Record<Papel, string> = {
  admin: "Administrador",
  atendente: "Atendente",
  tecnico: "Técnico",
};

export function mensagemConvite(c: {
  empresa: string;
  email: string;
  papel: Papel;
  /** Endereço do Nexa (ex.: https://nexaos-….run.app), sem barra no fim. */
  endereco: string;
}): string {
  const endereco = c.endereco.replace(/\/+$/, "");
  return [
    `Olá! Você recebeu um convite para usar o Nexa OS na empresa ${c.empresa}, com o papel ${ROTULO_PAPEL[c.papel]}.`,
    "",
    "Para criar sua conta:",
    `1. Abra ${endereco}/auth`,
    '2. Toque em "Criar conta".',
    `3. Use exatamente este e-mail: ${c.email}`,
    '4. Escreva seu nome, escolha uma senha (mínimo de 6 caracteres) e toque em "Criar conta".',
    '5. Se chegar um e-mail de confirmação, toque no link dele e depois entre pela aba "Entrar".',
    "",
    `Pronto: a empresa ${c.empresa} já aparece para você.`,
    'Dica: no celular, use "Adicionar à tela de início" para abrir o Nexa como um aplicativo.',
  ].join("\n");
}

/** Link do WhatsApp com o texto pronto (a pessoa escolhe o contato). */
export function linkWhatsAppConvite(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}
