// Lista de faturas da assinatura (Configurações › Empresa e Painel Nexa › Assinaturas).
import { ExternalLink } from "lucide-react";
import { Chip, type TomChip } from "@/components/nexa";
import { STATUS_FATURA } from "@/lib/asaas";
import type { Fatura } from "@/lib/faturas";
import { brl, dateBR } from "@/lib/format";

const TOM: Record<string, TomChip> = {
  pendente: "neutro",
  paga: "sucesso",
  vencida: "problema",
  cancelada: "neutro",
  estornada: "atencao",
};

function mesAno(competencia: string) {
  const [ano, mes] = competencia.split("-");
  return `${mes}/${ano}`;
}

export function ListaFaturas({ faturas, vazio }: { faturas: Fatura[]; vazio?: string }) {
  if (faturas.length === 0)
    return <p className="text-sm text-muted-foreground">{vazio ?? "Nenhuma fatura ainda."}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {faturas.map((f) => (
        <li key={f.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-bold">
              {mesAno(f.competencia)} · {brl(f.valor)}
            </span>
            <span className="text-xs text-muted-foreground">
              {f.status === "paga" && f.pago_em
                ? `Paga em ${dateBR(f.pago_em)}`
                : `Vence em ${dateBR(f.vencimento)}`}
            </span>
          </span>
          <Chip tom={TOM[f.status] ?? "neutro"}>{STATUS_FATURA[f.status] ?? f.status}</Chip>
          {f.link_pagamento && (f.status === "pendente" || f.status === "vencida") && (
            <a
              href={f.link_pagamento}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 rounded-botao px-3 text-sm font-bold text-marca hover:bg-marca-claro"
            >
              Pagar <ExternalLink className="size-4" aria-hidden />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
