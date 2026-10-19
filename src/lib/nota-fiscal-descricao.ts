/**
 * "Discriminação dos Serviços" da NFS-e (Prefeitura de São Paulo), montada a partir dos itens da
 * OS (service_items de cada visita não cancelada). Só texto simples, até 2.000 caracteres:
 *
 *   Serviço de higienização de estofados realizado em 20/10/2026:
 *   - 01 Sofá comum 3 lugares - Higienização: R$ 286,00
 *
 *   Desconto: -R$ 50,00
 *   Valor total: R$ 236,00
 *
 * O desconto é a soma dos itens menos o valor da OS (Pix, cupom, ajuste) mais o saldo dispensado
 * nas visitas; se itens − desconto não bater com o valor da nota, não sai descrição (aviso).
 */

export const MAX_DESCRICAO = 2000;

export type ItemDescricao = {
  description: string | null;
  quantity: number;
  unidade?: string | null;
  subtotal: number;
  item_group_id: string | null;
  display_order: number;
  active: boolean;
};

export type VisitaDescricao = {
  status: string;
  completion_date: string | null;
  scheduled_date: string | null;
  visit_value: number | null;
  final_value: number | null;
  discount_amount: number | null;
  item_quantity: number | null;
  upholstery_description: string | null;
  service_type: { name: string } | null;
  service_items: ItemDescricao[] | null;
};

export type EntradaDescricao = {
  /** Valor da nota (invoice_amount; sem ele, o da OS). */
  valorNota: number;
  /** Valor da OS (total_gross_value). */
  valorOs: number;
  /** Data do pedido de nota (usada se nenhuma visita foi concluída). */
  dataServico: string | null;
  visitas: VisitaDescricao[];
};

export type Descricao =
  { ok: true; texto: string; agrupado: boolean } | { ok: false; aviso: string };

type Categoria = "estofado" | "colchao" | "tapete" | "persiana";

type Linha = {
  chave: string;
  nome: string;
  servicos: string[];
  quantidade: number;
  unidade: "un" | "m2";
  valor: number;
  categoria: Categoria;
};

const centavos = (n: number) => Math.round(Number(n || 0) * 100);

/** R$ 1.139,00 (espaço comum, nada de espaço especial). */
export function reais(n: number): string {
  const v = Math.abs(n).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${v}`;
}

const numero = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function juntar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

const SERVICO = /higien|impermeab|limpeza|hidrata/i;

/** "Sofá de couro — Higienização e Hidratação" → nome e serviço; sem serviço, o da visita. */
function separar(descricao: string, servicoVisita: string): { nome: string; servico: string } {
  const partes = descricao.split(/\s+—\s+/);
  let nome = descricao;
  let servico = servicoVisita;
  if (partes.length > 1 && SERVICO.test(partes[partes.length - 1]!)) {
    servico = partes.pop()!.trim();
    nome = partes.join(" — ");
  }
  nome = nome
    .replace(/\(\s*por\s*m(?:²|2)\s*\)/gi, "")
    .replace(/\s+[–-]\s+limpeza\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return { nome: nome || "Item", servico: servico.trim() || "Higienização" };
}

function categoriaDe(nome: string, unidade: string): Categoria {
  const n = nome.toLowerCase();
  if (unidade === "m2" || n.includes("tapete")) return "tapete";
  if (n.includes("persiana")) return "persiana";
  if (n.includes("colch")) return "colchao";
  return "estofado";
}

/** Medidas no nome do tapete ("Tapete 5,06 x 3,90") → "Tapete 5,06 m x 3,90 m". */
function nomeTapete(nome: string, area: number): string {
  const re = /(\d+(?:[.,]\d+)?)\s*m?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*m?\b/i;
  const m = nome.match(re);
  const areaTxt = `(${numero(area)} m²)`;
  if (!m) return `${nome} ${areaTxt}`;
  const med = (s: string) => numero(Number(s.replace(",", ".")));
  const base = nome.replace(re, "").replace(/\s+/g, " ").trim();
  return `${base} ${med(m[1]!)} m x ${med(m[2]!)} m ${areaTxt}`.trim();
}

function linhasDasVisitas(visitas: VisitaDescricao[]): Linha[] {
  const linhas: Linha[] = [];
  let avulso = 0;
  for (const v of visitas) {
    const servicoVisita = v.service_type?.name ?? "";
    const itens = (v.service_items ?? [])
      .filter((i) => i.active !== false && Number(i.quantity) > 0)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const lista = itens.length
      ? itens.map((i) => ({
          ...separar(i.description || "Item", servicoVisita),
          chave: i.item_group_id || "",
          quantidade: Number(i.quantity),
          unidade: (i.unidade === "m2" ? "m2" : "un") as "un" | "m2",
          valor: Number(i.subtotal ?? 0),
        }))
      : [
          {
            ...separar(
              (v.upholstery_description || "Item").replace(/^\d+x\s*/i, ""),
              servicoVisita,
            ),
            chave: "",
            quantidade: Number(v.item_quantity ?? 1) || 1,
            unidade: "un" as const,
            valor: Number(v.visit_value ?? 0),
          },
        ];
    for (const l of lista) {
      const chave = l.chave || `nome:${l.nome.toLowerCase()}`;
      // O mesmo item em higienização e em impermeabilização (visitas diferentes) vira uma linha.
      const junto = linhas.find(
        (x) =>
          x.chave === chave &&
          x.unidade === l.unidade &&
          !x.servicos.some((s) => s.toLowerCase() === l.servico.toLowerCase()),
      );
      if (junto) {
        junto.servicos.push(l.servico);
        junto.valor += l.valor;
        junto.quantidade = Math.max(junto.quantidade, l.quantidade);
        continue;
      }
      linhas.push({
        chave: chave || `avulso-${avulso++}`,
        nome: l.nome,
        servicos: [l.servico],
        quantidade: l.quantidade,
        unidade: l.unidade,
        valor: l.valor,
        categoria: categoriaDe(l.nome, l.unidade),
      });
    }
  }
  return linhas;
}

function servicoDaLinha(l: Linha): string {
  // "Higienização e Impermeabilização" (higienização sempre primeiro).
  const ordem = (s: string) => (/impermeab/i.test(s) ? 1 : 0);
  return juntar([...l.servicos].sort((a, b) => ordem(a) - ordem(b)));
}

function textoLinha(l: Linha): string {
  const nome = l.unidade === "m2" ? nomeTapete(l.nome, l.quantidade) : l.nome;
  const qtd = l.unidade === "m2" ? "01" : String(Math.round(l.quantidade)).padStart(2, "0");
  return `- ${qtd} ${nome} - ${servicoDaLinha(l)}: ${reais(l.valor)}`;
}

const OBJETO: Record<Categoria, [string, string]> = {
  estofado: ["estofados", "estofados"],
  colchao: ["colchão", "colchões"],
  tapete: ["tapete", "tapetes"],
  persiana: ["persiana", "persianas"],
};

function titulo(linhas: Linha[], datas: string[]): string {
  const servicos = linhas.flatMap((l) => l.servicos.map((s) => s.toLowerCase()));
  const temImp = servicos.some((s) => s.includes("impermeab"));
  const soImp = servicos.every((s) => s.includes("impermeab"));
  const soLimpeza = servicos.every((s) => s.includes("limpeza"));
  const verbo = soImp
    ? "impermeabilização"
    : temImp
      ? "higienização e impermeabilização"
      : soLimpeza
        ? "limpeza"
        : "higienização";
  const cats = Array.from(new Set(linhas.map((l) => l.categoria)));
  let objeto = "";
  if (cats.length === 1) {
    const qtd = linhas.reduce((s, l) => s + (l.unidade === "m2" ? 1 : Math.round(l.quantidade)), 0);
    const [um, varios] = OBJETO[cats[0]!];
    objeto = ` de ${qtd > 1 ? varios : um}`;
  }
  const quando = datas.length ? ` realizado em ${juntar(datas)}` : "";
  return `Serviço de ${verbo}${objeto}${quando}:`;
}

/** Itens iguais (mesmo nome, serviço e valor unitário) numa linha só. */
function agrupar(linhas: Linha[]): Linha[] {
  const grupos: Linha[] = [];
  for (const l of linhas) {
    const unit = l.unidade === "m2" ? null : centavos(l.valor / (Math.round(l.quantidade) || 1));
    const igual =
      unit === null
        ? undefined
        : grupos.find(
            (g) =>
              g.unidade === "un" &&
              g.nome.toLowerCase() === l.nome.toLowerCase() &&
              servicoDaLinha(g) === servicoDaLinha(l) &&
              centavos(g.valor / (Math.round(g.quantidade) || 1)) === unit,
          );
    if (igual) {
      igual.quantidade += l.quantidade;
      igual.valor += l.valor;
    } else grupos.push({ ...l, servicos: [...l.servicos] });
  }
  return grupos;
}

function datasDoServico(visitas: VisitaDescricao[], dataServico: string | null): string[] {
  const concluidas = visitas
    .filter((v) => v.status === "Concluído")
    .map((v) => v.completion_date || v.scheduled_date)
    .filter((d): d is string => Boolean(d))
    .map((d) => d.slice(0, 10));
  const lista = concluidas.length ? concluidas : dataServico ? [dataServico.slice(0, 10)] : [];
  return Array.from(new Set(lista)).sort().map(dataBR);
}

export function descricaoServicos(e: EntradaDescricao): Descricao {
  const visitas = e.visitas.filter((v) => v.status !== "Cancelado");
  const linhas = linhasDasVisitas(visitas);
  if (!linhas.length) return { ok: false, aviso: "A OS não tem itens para descrever na nota." };

  const somaItens = linhas.reduce((s, l) => s + centavos(l.valor), 0);
  const dispensado = visitas.reduce((s, v) => s + centavos(Number(v.discount_amount ?? 0)), 0);
  const desconto = Math.max(0, somaItens - centavos(e.valorOs)) + dispensado;
  const valorNota = centavos(e.valorNota);
  if (somaItens - desconto !== valorNota) {
    const partes = [`itens ${reais(somaItens / 100)}`];
    if (desconto) partes.push(`desconto ${reais(desconto / 100)}`);
    return {
      ok: false,
      aviso: `A soma dos itens não bate com o valor da nota (${partes.join(", ")} = ${reais((somaItens - desconto) / 100)}; nota ${reais(valorNota / 100)}). Confira a OS ou o valor do pedido antes de copiar.`,
    };
  }

  const datas = datasDoServico(visitas, e.dataServico);
  const montar = (ls: Linha[]) =>
    [
      titulo(ls, datas),
      ...ls.map(textoLinha),
      "",
      ...(desconto ? [`Desconto: -${reais(desconto / 100)}`] : []),
      `Valor total: ${reais(valorNota / 100)}`,
    ].join("\n");

  let texto = montar(linhas);
  let agrupado = false;
  if (texto.length > MAX_DESCRICAO) {
    texto = montar(agrupar(linhas));
    agrupado = true;
  }
  if (texto.length > MAX_DESCRICAO)
    return {
      ok: false,
      aviso: `A descrição passa de ${MAX_DESCRICAO.toLocaleString("pt-BR")} caracteres mesmo agrupando os itens iguais (${texto.length}). Escreva a discriminação à mão.`,
    };
  return { ok: true, texto, agrupado };
}
