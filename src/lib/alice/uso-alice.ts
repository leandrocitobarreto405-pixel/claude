// Medidor da franquia da Alice da empresa aberta (Configurações › Alice e Início).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lerUso, type UsoAlice } from "@/lib/alice/franquia";

export const CHAVE_USO_ALICE = ["alice_uso_do_mes"];

export function useUsoAlice() {
  return useQuery({
    queryKey: CHAVE_USO_ALICE,
    queryFn: async (): Promise<UsoAlice | null> => {
      const { data, error } = await supabase.rpc("alice_uso_do_mes");
      if (error) throw error;
      return lerUso(data);
    },
  });
}
