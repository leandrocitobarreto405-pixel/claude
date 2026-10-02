import { Bell, CalendarDays, FileText, Home, Megaphone, MessageCircle } from "lucide-react";
import type { ItemDeNavegacao } from "@/components/nexa";
import { podeAcessar, type Papel } from "@/lib/tenant";

/**
 * Abas da barra inferior (celular). O resto do menu fica no "Mais".
 * Admin e atendente: Início, Agenda, Conversas, Marketing, Avisos.
 * Técnico: Agenda, Serviços (a página da OS abre pelo serviço), Avisos.
 */
const ABAS_ESCRITORIO: ItemDeNavegacao[] = [
  { to: "/inicio", rotulo: "Início", icone: Home },
  { to: "/agenda", rotulo: "Agenda", icone: CalendarDays },
  { to: "/conversas", rotulo: "Conversas", icone: MessageCircle },
  { to: "/marketing", rotulo: "Marketing", icone: Megaphone },
  { to: "/avisos", rotulo: "Avisos", icone: Bell },
];

const ABAS_TECNICO: ItemDeNavegacao[] = [
  { to: "/agenda", rotulo: "Agenda", icone: CalendarDays },
  { to: "/servicos", rotulo: "Serviços", icone: FileText, ativoEm: ["/os"] },
  { to: "/avisos", rotulo: "Avisos", icone: Bell },
];

/** Abas do papel, já filtradas pelo `podeAcessar()` (sem papel, nenhuma). */
export function abasDoPapel(papel: Papel | null, souNexa = false): ItemDeNavegacao[] {
  if (!papel) return [];
  const abas = papel === "tecnico" ? ABAS_TECNICO : ABAS_ESCRITORIO;
  return abas.filter((a) => podeAcessar(papel, a.to, souNexa));
}
