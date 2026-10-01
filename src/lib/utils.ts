import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Ensina o tailwind-merge os cantos do tema (src/styles.css), para que `rounded-botao`
// substitua o `rounded-lg` do botão base em vez de os dois ficarem juntos.
const twMerge = extendTailwindMerge({
  extend: { theme: { radius: ["card", "card-lg", "botao", "chip"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
