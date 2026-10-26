// Configurações › Empresa › Assinatura e faturas: o que a empresa contratou, a situação e as
// faturas (com o link de pagamento do Asaas). Só leitura: quem altera é a Nexa.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ListaFaturas } from "@/components/assinatura/lista-faturas";
import { textoAvisoAssinatura, useSituacaoAssinatura } from "@/lib/assinatura-situacao";
import { useFaturas } from "@/lib/faturas";
import { resumoAssinatura, usePlanos, type Assinatura } from "@/lib/planos";
import { useMinhaEmpresa } from "@/lib/tenant";

export function AssinaturaDaEmpresa() {
  const { data: ativa } = useMinhaEmpresa();
  const empresaId = ativa?.empresa.id ?? null;
  const planos = usePlanos(Boolean(empresaId));
  const situacao = useSituacaoAssinatura(empresaId);
  const faturas = useFaturas(empresaId, Boolean(empresaId));
  const assinatura = useQuery({
    queryKey: ["assinatura_vigente", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async (): Promise<Assinatura | null> => {
      const { data, error } = await supabase
        .from("assinaturas")
        .select(
          "id, empresa_id, plano_id, valor_mensal, status, vigencia_inicio, vigencia_fim, gratis_ate, proximo_vencimento, contrato_pdf_path, contrato_pdf_em, isenta",
        )
        .eq("empresa_id", empresaId as string)
        .is("vigencia_fim", null)
        .maybeSingle();
      if (error) throw error;
      return (data as Assinatura | null) ?? null;
    },
  });

  const aviso = textoAvisoAssinatura(situacao.data);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-bold">Plano: </span>
        {assinatura.isLoading
          ? "carregando…"
          : resumoAssinatura(assinatura.data ?? null, planos.data ?? [])}
      </p>
      {aviso && (
        <p
          role="status"
          className="rounded-md bg-atencao px-4 py-3 text-sm text-atencao-foreground"
        >
          {aviso}
        </p>
      )}
      <ListaFaturas faturas={faturas.data ?? []} />
      <p className="text-xs text-muted-foreground">
        Dúvidas sobre plano ou cobrança: fale com a Nexa.
      </p>
    </div>
  );
}
