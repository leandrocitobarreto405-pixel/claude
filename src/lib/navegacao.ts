import { CalendarDays, ClipboardList, Home, Menu, MessageCircle } from "lucide-react";
import type { ItemDeNavegacao } from "@/components/nexa";
import { podeAcessar, type Papel } from "@/lib/tenant";

/** A aba "Mais" não é um endereço: abre o menu completo. */
export const ABA_MAIS = "mais";

/**
 * Abas da barra inferior (celular). O resto do menu fica no "Mais".
 * Admin e atendente: Início, Conversas, Agenda, OS, Mais.
 * Técnico: Agenda, Serviços (a OS e o serviço abrem por ela), Mais.
 */
const ABAS_ESCRITORIO: ItemDeNavegacao[] = [
  { to: "/inicio", rotulo: "Início", icone: Home },
  { to: "/conversas", rotulo: "Conversas", icone: MessageCircle },
  { to: "/agenda", rotulo: "Agenda", icone: CalendarDays, ativoEm: ["/servicos", "/servico"] },
  { to: "/oss", rotulo: "OS", icone: ClipboardList, ativoEm: ["/orcamentos", "/nova-os", "/os"] },
  { to: ABA_MAIS, rotulo: "Mais", icone: Menu },
];

const ABAS_TECNICO: ItemDeNavegacao[] = [
  { to: "/agenda", rotulo: "Agenda", icone: CalendarDays },
  { to: "/servicos", rotulo: "Serviços", icone: ClipboardList, ativoEm: ["/os", "/servico"] },
  { to: ABA_MAIS, rotulo: "Mais", icone: Menu },
];

/** Abas do papel, já filtradas pelo `podeAcessar()` (sem papel, nenhuma). */
export function abasDoPapel(papel: Papel | null, souNexa = false): ItemDeNavegacao[] {
  if (!papel) return [];
  const abas = papel === "tecnico" ? ABAS_TECNICO : ABAS_ESCRITORIO;
  return abas.filter((a) => a.to === ABA_MAIS || podeAcessar(papel, a.to, souNexa));
}
