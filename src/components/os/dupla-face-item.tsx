import { alternarDuplaFace, ehColchao, temDuplaFace } from "@/lib/dupla-face";
import { useConfigOrcamento } from "@/lib/orcamento-config";
import { parseNumberBR } from "@/lib/format";

/**
 * Colchão dupla face no item da OS (com a regra ligada em Regras de orçamento): marca a descrição
 * ("… – dupla face (2 faces + laterais)") e soma o acréscimo no valor unitário.
 */
export function DuplaFaceItem({
  descricao,
  estofado,
  valorUnitario,
  precoBase,
  aoMudar,
}: {
  descricao: string;
  estofado?: string | null | undefined;
  valorUnitario: string;
  precoBase?: number | null;
  aoMudar: (patch: {
    description: string;
    unit_price: string;
    preco_sem_dupla_face: number | null;
  }) => void;
}) {
  const { regras } = useConfigOrcamento();
  if (!regras.duplaFace.ligada || !(ehColchao(descricao) || ehColchao(estofado))) return null;
  const marcado = temDuplaFace(descricao);
  const pct = regras.duplaFace.pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return (
    <label className="flex min-h-11 w-fit items-center gap-2 rounded-full border border-border px-3 text-sm">
      <input
        type="checkbox"
        className="h-5 w-5"
        checked={marcado}
        onChange={(e) => {
          const r = alternarDuplaFace(
            {
              // Sem descrição, parte do estofado escolhido (ex.: "Colchão queen").
              descricao: descricao.trim() || estofado || "Colchão",
              preco: parseNumberBR(valorUnitario),
              precoBase: precoBase ?? null,
            },
            regras.duplaFace.pct,
            e.target.checked,
          );
          aoMudar({
            description: r.descricao,
            unit_price: r.preco.toFixed(2).replace(".", ","),
            preco_sem_dupla_face: r.precoBase,
          });
        }}
      />
      Dupla face (+{pct}%)
    </label>
  );
}
