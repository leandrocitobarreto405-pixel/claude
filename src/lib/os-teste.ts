/** OS de teste fica fora de todas as listas (Serviços, Agenda) e totais, em todas as empresas. */
export function semOsDeTeste<T extends { work_order?: { eh_teste?: boolean } | null }>(v: T) {
  return !v.work_order?.eh_teste;
}
