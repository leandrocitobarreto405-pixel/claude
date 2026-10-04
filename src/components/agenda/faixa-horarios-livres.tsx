import { CartaoPromocao } from "@/components/promocao/cartao-promocao";

/**
 * "Amanhã: N horários livres" com a chave e as listas da promoção e "Preencher com promoção".
 * Só aparece quando há horários base cadastrados e algum deles está vago. Para admin e atendente
 * (o técnico não vê).
 */
export function FaixaHorariosLivres() {
  return <CartaoPromocao faixa />;
}
