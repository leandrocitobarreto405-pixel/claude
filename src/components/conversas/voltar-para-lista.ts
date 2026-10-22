import { useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { abertaPelaLista } from "@/lib/conversas-tela";

/** Voltar: pela história do navegador quando veio da lista (mesma aba e rolagem); senão, à lista. */
export function useVoltarParaLista() {
  const router = useRouter();
  const navigate = useNavigate();
  const [veio] = useState(() => abertaPelaLista());
  return () => {
    if (veio && window.history.length > 1) router.history.back();
    else void navigate({ to: "/conversas", search: { aba: undefined }, replace: true });
  };
}
