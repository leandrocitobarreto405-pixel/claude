/**
 * Campos do roteiro da Alice, preenchidos na configuração da Alice de cada empresa. O roteiro-base
 * (Modelo Nexa) usa os marcadores no lugar do que era específico da Turbine; a empresa preenche os
 * valores dela. {nome_empresa} vem do cadastro da empresa.
 */
export type CamposRoteiro = {
  regiao_atendida: string;
  nomes_atendentes: string;
  anos_experiencia: string;
};

export const CAMPOS_ROTEIRO: Array<{
  chave: keyof CamposRoteiro;
  marcador: string;
  rotulo: string;
  exemplo: string;
  max: number;
}> = [
  {
    chave: "regiao_atendida",
    marcador: "{regiao_atendida}",
    rotulo: "Região atendida",
    exemplo: "Grande São Paulo",
    max: 120,
  },
  {
    chave: "nomes_atendentes",
    marcador: "{nomes_atendentes}",
    rotulo: "Nomes das atendentes",
    exemplo: "a Maria e a Carol",
    max: 120,
  },
  {
    chave: "anos_experiencia",
    marcador: "{anos_experiencia}",
    rotulo: "Anos de experiência do técnico",
    exemplo: "7",
    max: 10,
  },
];

export const SEM_CAMPOS: CamposRoteiro = {
  regiao_atendida: "",
  nomes_atendentes: "",
  anos_experiencia: "",
};

/** Campo usado no roteiro e não preenchido: a Alice lê isto e não cita o dado. */
export const CAMPO_VAZIO = "[não informado: não cite]";

/** Troca {nome_empresa} e os campos da empresa no texto do roteiro (ou das perguntas frequentes). */
export function aplicarCamposDoRoteiro(
  texto: string,
  empresa: string,
  campos: CamposRoteiro = SEM_CAMPOS,
): string {
  let t = texto.replaceAll("{nome_empresa}", empresa);
  for (const c of CAMPOS_ROTEIRO)
    t = t.replaceAll(c.marcador, campos[c.chave].trim() || CAMPO_VAZIO);
  return t;
}

/** Campos que o texto usa e a empresa ainda não preencheu (a Alice não liga sem eles). */
export function camposFaltando(texto: string, campos: CamposRoteiro): string[] {
  return CAMPOS_ROTEIRO.filter((c) => texto.includes(c.marcador) && !campos[c.chave].trim()).map(
    (c) => c.rotulo,
  );
}

/** Confere tamanho e limpa os campos vindos da tela. */
export function limparCampos(entrada: Partial<CamposRoteiro> | undefined): CamposRoteiro {
  const r = { ...SEM_CAMPOS };
  for (const c of CAMPOS_ROTEIRO) {
    const v = String(entrada?.[c.chave] ?? "").trim();
    if (v.length > c.max) throw new Error(`${c.rotulo}: no máximo ${c.max} caracteres.`);
    r[c.chave] = v;
  }
  return r;
}
