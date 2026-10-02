// Regras da tela Início (sem acesso a banco, para poder testar).
import { monthLabelPT } from "@/lib/format";

/** Hora atual (0 a 23) em São Paulo. */
export function horaEmSaoPaulo(agora = new Date()): number {
  return (
    Number(
      agora.toLocaleString("en-US", {
        timeZone: "America/Sao_Paulo",
        hour: "numeric",
        hour12: false,
      }),
    ) % 24
  );
}

/** "Bom dia" até 11h59, "Boa tarde" até 17h59, depois "Boa noite". */
export function saudacao(hora: number): string {
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}

/** Primeiro nome, com a inicial maiúscula ("maria souza" -> "Maria"). */
export function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  return primeiro ? primeiro[0]!.toUpperCase() + primeiro.slice(1) : "";
}

/** "1 de outubro" */
export function dataPorExtenso(iso: string): string {
  const mes = monthLabelPT(iso).split(" de ")[0];
  return `${Number(iso.slice(8, 10))} de ${mes}`;
}

/** Quanto da meta já foi feito, de 0 a 100 (sem meta, 0). */
export function percentualDaMeta(realizado: number, meta: number): number {
  if (!(meta > 0)) return 0;
  return Math.max(0, Math.min(100, (realizado / meta) * 100));
}
