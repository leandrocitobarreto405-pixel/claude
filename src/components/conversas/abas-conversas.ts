import type { AbaConversas } from "@/lib/conversas-tela";

export const CHAVE_CONVERSAS = ["conversas", "lista"] as const;

/** Abas: os grupos da conversa mais "Minhas" (as que eu assumi, em qualquer grupo aberto). */
export type Aba = AbaConversas;

export const ABAS: { id: Aba; rotulo: string; vazio: string }[] = [
  {
    id: "precisam",
    rotulo: "Precisam",
    vazio: "Nenhum cliente esperando a equipe. A Alice está dando conta.",
  },
  {
    id: "minhas",
    rotulo: "Minhas",
    vazio: "Nenhuma conversa assumida por você. Toque em Assumir dentro de uma conversa.",
  },
  { id: "alice", rotulo: "Alice", vazio: "Nenhuma conversa com a Alice agora." },
  { id: "equipe", rotulo: "Equipe", vazio: "Nenhuma conversa com a equipe nos últimos 7 dias." },
  {
    id: "finalizadas",
    rotulo: "Encerradas",
    vazio: "Nenhuma conversa encerrada nos últimos 7 dias.",
  },
];
