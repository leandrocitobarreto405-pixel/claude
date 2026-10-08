/**
 * Textos da empresa na tela (orçamento, mensagens prontas do CRM): o texto editado em Modelos de
 * mensagem ou o padrão, já com o nome da empresa. Leitura pela sessão (RLS da empresa ativa).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { textoOuPadrao } from "@/lib/modelos-mensagem";
import { useContextoTenant } from "@/lib/tenant";

export type TextosEmpresa = {
  empresa: string;
  parcelasMax: number;
  validadeDias: number;
  /** Texto da chave (editado ou padrão), sem preencher as variáveis. */
  texto: (chave: string) => string;
};

export function useTextosEmpresa(): TextosEmpresa | null {
  const { data: tenant } = useContextoTenant();
  const empresaId = tenant?.ativa?.empresa.id ?? null;
  const q = useQuery({
    queryKey: ["textos-empresa", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const [{ data: textos }, { data: ia }, { data: orc }] = await Promise.all([
        supabase.from("mensagens_textos").select("chave, texto").eq("empresa_id", empresaId!),
        supabase
          .from("ia_configuracoes")
          .select("parcelas_max, validade_orcamento_dias")
          .eq("empresa_id", empresaId!)
          .maybeSingle(),
        // Regras de orçamento da empresa: parcelas e validade próprias têm prioridade.
        supabase
          .from("orcamento_configuracoes")
          .select("parcelas_max, validade_dias")
          .eq("empresa_id", empresaId!)
          .maybeSingle(),
      ]);
      return {
        textos: Object.fromEntries((textos ?? []).map((t) => [t.chave, t.texto])),
        parcelasMax: orc?.parcelas_max ?? ia?.parcelas_max ?? 5,
        validadeDias: orc?.validade_dias ?? ia?.validade_orcamento_dias ?? 7,
      };
    },
  });
  if (!q.data || !tenant?.ativa) return null;
  const d = q.data;
  return {
    empresa: tenant.ativa.empresa.nome,
    parcelasMax: d.parcelasMax,
    validadeDias: d.validadeDias,
    texto: (chave) => textoOuPadrao(chave, d.textos) ?? "",
  };
}
