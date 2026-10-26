import {
  Building2,
  CalendarDays,
  ClipboardList,
  HandCoins,
  Home,
  Menu,
  MessageCircle,
  Receipt,
} from "lucide-react";
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

/** Painel Nexa (só nexa_admin): telas da plataforma. */
const ABAS_PAINEL_NEXA: ItemDeNavegacao[] = [
  { to: "/nexa/empresas", rotulo: "Empresas", icone: Building2 },
  { to: "/nexa/assinaturas", rotulo: "Assinaturas", icone: Receipt },
  { to: "/nexa/comissoes", rotulo: "Comissão", icone: HandCoins },
  { to: ABA_MAIS, rotulo: "Mais", icone: Menu },
];

/** Abas do papel, já filtradas pelo `podeAcessar()` (sem papel, nenhuma). */
export function abasDoPapel(
  papel: Papel | null,
  souNexa = false,
  painelNexa = false,
): ItemDeNavegacao[] {
  if (painelNexa) return souNexa ? ABAS_PAINEL_NEXA : [];
  if (!papel) return [];
  const abas = papel === "tecnico" ? ABAS_TECNICO : ABAS_ESCRITORIO;
  return abas.filter((a) => a.to === ABA_MAIS || podeAcessar(papel, a.to, souNexa));
}
