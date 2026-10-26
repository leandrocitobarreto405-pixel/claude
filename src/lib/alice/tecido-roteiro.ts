/**
 * Mudança no roteiro (Turbine e Modelo Nexa) para a regra do tecido não identificado: só a última
 * frase da linha do tecido. ANTES é o texto exato salvo hoje; DEPOIS entra no lugar, depois do ok.
 */
export const TRECHO_TECIDO = {
  titulo: "Linha do tecido (Etapa de orçamento)",
  antes: 'Se ficar em dúvida, não marque e transfira com o motivo "confirmar tecido".',
  depois:
    'Se o cliente não souber o tecido e a foto não deixar claro, siga a regra "Tecido não identificado" (nas regras do sistema, acima).',
};

/** Troca o trecho; se ele não aparecer exatamente uma vez, não altera nada. */
export function aplicarRoteiroTecido(instrucoes: string): string {
  const vezes = instrucoes.split(TRECHO_TECIDO.antes).length - 1;
  if (vezes !== 1)
    throw new Error(
      `Trecho "${TRECHO_TECIDO.titulo}" aparece ${vezes} vez(es) no roteiro: nada foi alterado.`,
    );
  return instrucoes.replace(TRECHO_TECIDO.antes, TRECHO_TECIDO.depois);
}
