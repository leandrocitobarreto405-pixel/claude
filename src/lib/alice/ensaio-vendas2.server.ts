/**
 * Ensaio das fases 3 e 4 de "Alice e vendas" e do combo com cupom (pedido do dono em 13/11): a Alice
 * de verdade (mesmo modelo, instruções e ferramentas da empresa), com os textos das fases 2, 3 e 4
 * aplicados só na memória e as chaves ligadas só no ensaio. Sete conversas de mentira: cliente que
 * acha caro, cliente com preço de concorrente, combo com cupom que pede Pix, retomada das 8h (duas)
 * follow-up 5 e o retorno combinado às 11h. Os toques do sistema (volta da autorização, retomada,
 * follow-up 5, retorno) entram como no motor. Nada é enviado nem gravado, fora o resultado em
 * app_settings (alice_ensaio_vendas_2). Roda pela varredura: uma conversa por rodada.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  cuponsAtivos,
  ferramentasDisponiveis,
  PIX_COMBO_COM_CUPOM_PCT,
} from "./ferramentas.server";
import { avisoDoToque, contextoEmpresa, etapasAbertas, lerConfig } from "./motor.server";
import { rodarAliceEnsaio, type FalaEnsaio } from "./ensaio-rodar.server";
import {
  custoEstimadoUsd,
  instrucoesDoMomento,
  instrucoesDosModulos,
  instrucoesFixas,
  type ContextoLead,
  type MensagemHistorico,
  type Uso,
} from "./prompt";
import { chavesValidas } from "./modulos";
import { AVISO_PRECO_TRAVADO, precoLiberado } from "./preco-depois";
import {
  AVISO_ATALHO,
  AVISO_MOTIVO_JA_FEITO,
  atalhoDoApressado,
  jaPerguntouOMotivo,
} from "./atalho";
import { precificar, totalizar, type ItemTabela, type LinhaOrcamento } from "./orcamento-alice";
import { conferirCupom, valorDoCupom } from "./cupons";
import { validade } from "./regras";
import { chavesVendas } from "./chaves";
import { passoDaEtapa } from "./cadencia";
import { avisoDaVolta, calcularPedido, parametrosDaConfig } from "./negociacao";
import { TEXTO_COMBO_PARA_ESPECIALISTA } from "./negociacao.server";
import {
  avisoDaOferta5,
  calcularOferta5,
  chavesFase4,
  comRetomadaManha,
  diaDoPrazo,
  retornoBarraRetomada,
  textoOferta5,
  textoRetomadaManha,
} from "./vendas-fase4";
import {
  MD5_DEPOIS_FASE4,
  MD5_DEPOIS_FASE2,
  modulosComFase2,
  nucleoComFases,
} from "./textos-fase2";
import { diasCitados } from "./ensaio-vendas.server";
import { ehColchao } from "@/lib/dupla-face";
import { categoriaDeLimpeza } from "@/lib/unidade";
import { linhasPagamento } from "@/lib/texto-pagamento";
import { brl } from "@/lib/format";
import { descontoPorPct } from "@/lib/orcamento-regras";

type Db = SupabaseClient<Database>;

export const VERSAO_ENSAIO_VENDAS_2 = "fase34-1";
export const CHAVE_ENSAIO_VENDAS_2 = "alice_ensaio_vendas_2";
const RODANDO_MAX_MS = 20 * 60_000;
const md5 = (t: string) => createHash("md5").update(t, "utf8").digest("hex");

type Sistema = "volta" | "retomada" | "followup5" | "barrada" | "retorno_c";
type FalaRoteiro = {
  texto?: string;
  sistema?: Sistema;
  so?: "sem_orcamento" | "com_orcamento";
};
type Roteiro = {
  chave:
    | "caro"
    | "concorrente"
    | "combo_cupom"
    | "retomada"
    | "retomada_marido"
    | "followup5"
    | "followup5_cartao"
    | "retorno_11h";
  titulo: string;
  nome: string;
  /** Começa com o orçamento já mandado (sofá retrátil de 3 módulos). */
  comOrcamento?: boolean;
  /** Mensagens antes do ensaio, depois do orçamento (não passam pela Alice). */
  depoisDoOrcamento?: Array<{ de: "cliente" | "alice"; texto: string }>;
  falas: FalaRoteiro[];
};

export const CONVERSAS_ENSAIO_2: Roteiro[] = [
  {
    chave: "caro",
    titulo: "Fase 3: cliente que acha caro",
    nome: "Fernanda",
    comOrcamento: true,
    falas: [
      { texto: "Achei caro, viu. Não tem como melhorar?" },
      { texto: "Se ficar melhor eu fecho sim" },
      { sistema: "volta" },
      { texto: "Sexta é ótimo!" },
    ],
  },
  {
    chave: "concorrente",
    titulo: "Fase 3: cliente com preço de concorrente",
    nome: "Rodrigo",
    comOrcamento: true,
    falas: [
      { texto: "Vou fechar com outra empresa, fizeram mais barato." },
      { texto: "Fizeram por R$ 250 na Limpa Já" },
      { sistema: "volta" },
    ],
  },
  {
    chave: "combo_cupom",
    titulo: "Combo com cupom que pede Pix",
    nome: "Juliana",
    falas: [
      {
        texto:
          "Oi! Quero higienizar e impermeabilizar meu sofá comum de 3 lugares, uns 2 metros. Tenho o cupom BLOG50. CEP 04101-000",
      },
      { texto: "Pode mandar o valor dos dois juntos", so: "sem_orcamento" },
      { texto: "E no Pix, tem desconto?", so: "com_orcamento" },
      { texto: "E não dá pra fazer mais barato?", so: "com_orcamento" },
    ],
  },
  {
    chave: "retomada",
    titulo: "Fase 4: retomada das 8h (cliente sumiu depois do orçamento)",
    nome: "Marcos",
    comOrcamento: true,
    falas: [{ sistema: "retomada" }],
  },
  {
    chave: "retomada_marido",
    titulo: "Fase 4: retomada das 8h (ia ver com o marido)",
    nome: "Patrícia",
    comOrcamento: true,
    depoisDoOrcamento: [
      { de: "cliente", texto: "Vou ver com meu marido e te falo" },
      { de: "alice", texto: "Tudo bem, Patrícia! Fico no aguardo 💙" },
    ],
    falas: [{ sistema: "retomada" }],
  },
  {
    chave: "followup5",
    titulo: "Fase 4: follow-up 5 com 20%",
    nome: "Ricardo",
    comOrcamento: true,
    falas: [{ sistema: "followup5" }, { texto: "Quero ver os horários sim" }],
  },
  {
    // 13/11: no primeiro ensaio o cartão saiu só com o valor final; refeito depois da correção.
    chave: "followup5_cartao",
    titulo: "Fase 4: follow-up 5 com 20% (cartão com o item, o cheio e a condição)",
    nome: "Ricardo",
    comOrcamento: true,
    falas: [{ sistema: "followup5" }, { texto: "Quero ver os horários sim" }],
  },
  {
    chave: "retorno_11h",
    titulo: "Fase 4: retorno combinado às 11h (a retomada das 8h não sai)",
    nome: "Camila",
    comOrcamento: true,
    falas: [
      { texto: "Vou ver com meu marido e te falo" },
      { texto: "Pode ser" },
      { sistema: "barrada" },
      { sistema: "retorno_c" },
    ],
  },
];

export type TurnoEnsaio2 = {
  cliente: string;
  sistema?: Sistema;
  alice: string[];
  ferramentas: Array<{ nome: string; entrada: string }>;
  /** Texto exato esperado (retomada, follow-up 5). */
  esperado?: string;
  erro?: string;
};

export type ConversaEnsaio2 = {
  chave: string;
  titulo: string;
  situacao: "pendente" | "rodando" | "feita" | "erro";
  inicio?: string;
  fim?: string;
  /** Mensagens que já estavam na conversa antes do ensaio (o orçamento). */
  antes?: Array<{ de: string; texto: string }>;
  turnos: TurnoEnsaio2[];
  conferencia?: { passou: boolean; problemas: string[] };
  custoUsd?: number;
  erro?: string;
};

export type EnsaioVendas2 = {
  versao: string;
  modelo: string;
  criadoEm: string;
  textos: { nucleoAntes: string; nucleoEnsaiado: string; nucleoEsperado: string; imperm: string };
  conversas: ConversaEnsaio2[];
};

// ---------------------------------------------------------------- conferência (pura)
const normal = (t: string) => t.replace(/\s+/g, " ").trim();
const DESPEDIDA = /boa sorte|espero que d[eê] certo|fico feliz que resolveu|\btudo bem\b/i;

export function conferirConversa2(
  chave: Roteiro["chave"],
  turnos: TurnoEnsaio2[],
  pix?: number | null,
): { passou: boolean; problemas: string[] } {
  const p: string[] = [];
  const texto = (t: TurnoEnsaio2 | undefined) => (t?.alice ?? []).join("\n");
  const usou = (t: TurnoEnsaio2 | undefined, nome: string) =>
    (t?.ferramentas ?? []).some((f) => f.nome === nome);
  const entrada = (nome: string) =>
    turnos.flatMap((t) => t.ferramentas).find((f) => f.nome === nome)?.entrada ?? "";
  const sis = (s: Sistema) => turnos.find((t) => t.sistema === s);
  if (turnos.some((t) => t.erro)) p.push("erro numa resposta");
  if (chave === "caro") {
    if (!/"motivo"\s*:\s*"caro"/.test(entrada("pedir_autorizacao_desconto")))
      p.push("não pediu a autorização (motivo caro)");
    if (/R\$/.test(texto(turnos[0]))) p.push("falou de valor antes da autorização");
    const v = sis("volta");
    if (!v) p.push("não houve a volta da autorização");
    else {
      if (!/Consegui liberar/i.test(texto(v))) p.push("a volta não usou a frase aprovada");
      if (!usou(v, "criar_orcamento")) p.push("a volta não refez o orçamento");
      if (diasCitados(texto(v)) < 2) p.push("a volta não ofereceu dois horários");
    }
  }
  if (chave === "concorrente") {
    const e = entrada("pedir_autorizacao_desconto");
    if (!/"motivo"\s*:\s*"concorrente"/.test(e) || !/concorrente_valor/.test(e))
      p.push("não pediu a autorização com o valor do concorrente");
    if (turnos.some((t) => DESPEDIDA.test(texto(t)))) p.push("usou frase de despedida proibida");
    const v = sis("volta");
    if (v && !/Consegui chegar em/i.test(texto(v))) p.push("a volta não usou a frase aprovada");
  }
  if (chave === "combo_cupom") {
    const orc = entrada("criar_orcamento");
    if (!/"combo"\s*:\s*true/.test(orc)) p.push("orçou sem o combo");
    if (!/BLOG50/i.test(orc)) p.push("orçou sem o cupom");
    const i = turnos.findIndex((t) => usou(t, "criar_orcamento"));
    if (i >= 0 && /No Pix/i.test(texto(turnos[i]))) p.push("o cartão mostrou o Pix");
    const pergunta = turnos.find((t) => /pix/i.test(t.cliente));
    if (pergunta && pix && !normal(texto(pergunta)).includes(brl(pix).replace(/\u00a0/g, " ")))
      p.push(`não passou o valor do Pix com ${PIX_COMBO_COM_CUPOM_PCT}% a mais`);
    const barato = turnos.find((t) => /mais barato/i.test(t.cliente));
    if (barato && !usou(barato, "transferir_para_humano"))
      p.push("não transferiu para a especialista o pedido de desconto no combo");
    if (turnos.some((t) => /12\s?%|teto/i.test(texto(t)))) p.push("falou em teto ou 12%");
  }
  if (
    chave === "retomada" ||
    chave === "retomada_marido" ||
    chave === "followup5" ||
    chave === "followup5_cartao"
  ) {
    const s = turnos.find((t) => t.esperado);
    if (!s) p.push("o toque não rodou");
    else if (normal(texto(s)) !== normal(s.esperado!))
      p.push("o toque não saiu exatamente com o texto aprovado");
  }
  if (chave === "followup5_cartao") {
    const depois = turnos.find((t) => t.cliente.startsWith("Quero ver"));
    const cartao = texto(depois);
    if (!/Valor cheio/i.test(cartao)) p.push("o cartão não mostrou o valor cheio");
    if (!/Condição especial/i.test(cartao))
      p.push("o cartão não mostrou a linha da condição especial");
    if (!/•[^\n]*R\$/.test(cartao)) p.push("o cartão não mostrou o item com o preço");
  }
  if (chave === "followup5" || chave === "followup5_cartao") {
    const depois = turnos.find((t) => t.cliente.startsWith("Quero ver"));
    if (depois && !/oferta_followup/.test(depois.ferramentas.map((f) => f.entrada).join(" ")))
      p.push("não refez o orçamento com a condição do follow-up");
    if (depois && diasCitados(texto(depois)) < 2) p.push("não ofereceu dois horários");
  }
  if (chave === "retorno_11h") {
    const t0 = texto(turnos[0]);
    if (!/11\s?h/i.test(t0) || !/garantido/i.test(t0))
      p.push("não propôs a hora marcada com a validade");
    if (!/"trilha"\s*:\s*"C"/.test(entrada("agendar_followup"))) p.push("não agendou o retorno");
    const b = sis("barrada");
    if (!b || !/não saiu/.test(texto(b))) p.push("a retomada das 8h sairia");
    const c = sis("retorno_c");
    if (!c || !/conseguiu (conversar|ver)/i.test(texto(c))) p.push("o retorno das 11h não retomou");
  }
  return { passou: p.length === 0, problemas: p };
}

// ---------------------------------------------------------------- uma conversa
function agendaDeEnsaio(agora: Date): string {
  const dias: string[] = [];
  const horas = [["14h"], ["9h", "11h"], ["8h", "14h"]];
  for (let i = 1; dias.length < 3 && i < 8; i++) {
    const d = new Date(agora.getTime() + i * 86_400_000);
    const sem = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" });
    if (/domingo/i.test(sem)) continue;
    const data = d.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
    });
    dias.push(`${sem}, ${data}: ${horas[dias.length]!.join(" e ")} livres`);
  }
  return `Horários livres (ensaio): ${dias.join("; ")}.`;
}

/** "AAAA-MM-DD HH:MM" (São Paulo) ou em_minutos → instante. */
function quandoDoRetorno(entrada: string, agora: Date): Date | null {
  try {
    const e = JSON.parse(entrada) as { data_hora?: string; em_minutos?: number };
    if (e.em_minutos) return new Date(agora.getTime() + e.em_minutos * 60_000);
    const m = e.data_hora?.match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
    return m ? new Date(`${m[1]}T${m[2]!.padStart(2, "0")}:${m[3]}:00-03:00`) : null;
  } catch {
    return null;
  }
}

export async function rodarConversaEnsaio2(
  db: Db,
  empresaId: string,
  roteiro: Roteiro,
): Promise<{
  turnos: TurnoEnsaio2[];
  antes: Array<{ de: string; texto: string }>;
  custoUsd: number;
  modelo: string;
  pix: number | null;
}> {
  const cfgReal = await lerConfig(db, empresaId);
  if (!cfgReal) throw new Error("Esta empresa não tem a Alice configurada.");
  const cfg = {
    ...cfgReal,
    instrucoes: nucleoComFases(cfgReal.instrucoes ?? "", md5),
    modulos: modulosComFase2(cfgReal.modulos) as never,
    atalho_apressado: true,
    combo_ligado: true,
    negociacao_ligada: true,
    retomada_manha_alice: true,
    followup5_novo: true,
    retorno_alice_cobre: true,
    fora_area_regra: true,
  };
  const chaves = chavesVendas(cfg);
  const fase4 = chavesFase4(cfg);
  const etapas = await etapasAbertas(db, empresaId);
  const ferramentas = ferramentasDisponiveis(cfg as never, etapas, { regraNome: true });
  const empresa = await contextoEmpresa(
    db,
    empresaId,
    cfg as never,
    ferramentas.map((f) => f.name),
  );
  const fixas = instrucoesFixas({
    ...empresa,
    regraNome: true,
    regraRespostas: true,
    regraPreco: true,
  });
  const { regrasOrcamento } = await import("@/lib/quotes.server");
  const regras = await regrasOrcamento(db, empresaId);
  const [{ data: itens }, cupons] = await Promise.all([
    db
      .from("tabela_precos_itens")
      .select("id, nome, preco_higienizacao, preco_impermeabilizacao, categoria")
      .eq("empresa_id", empresaId)
      .eq("ativo", true),
    cuponsAtivos(db, empresaId),
  ]);
  const tabela = (itens ?? []) as ItemTabela[];
  const cliente = new Anthropic();
  const agora = new Date();
  const estado: {
    cheio: number;
    total: number;
    valorFixo: number | null;
    pedido: { motivo?: string; concorrente_valor?: number } | null;
    combo: boolean;
    pix: number | null;
  } = { cheio: 0, total: 0, valorFixo: null, pedido: null, combo: false, pix: null };

  /** criar_orcamento de ensaio: mesma conta da ferramenta (combo com cupom e valor fixo), sem gravar. */
  function orcamento(entrada: unknown): { texto: string; bruto: number; total: number } {
    const e = entrada as {
      servico?: "higienizacao" | "impermeabilizacao";
      itens?: Array<{
        item: string;
        quantidade?: number;
        almofadas_soltas?: boolean;
        classe?: "A" | "B" | "C";
        muito_encardido?: boolean;
        dupla_face?: boolean;
      }>;
      cupom?: string;
      combo?: boolean;
      desconto?: string;
    };
    const combo = Boolean(e.combo) && chaves.comboLigado;
    const servicos = combo
      ? (["higienizacao", "impermeabilizacao"] as const)
      : ([e.servico ?? "higienizacao"] as const);
    const linhas: Array<LinhaOrcamento & { servico: string }> = [];
    const erro = (texto: string) => ({ texto, bruto: 0, total: 0 });
    for (const p of e.itens ?? []) {
      const item = tabela.find((t) => t.nome.trim().toLowerCase() === p.item.trim().toLowerCase());
      if (!item)
        return erro(
          `Item "${p.item}" não está na tabela. Itens válidos: ${tabela.map((i) => i.nome).join("; ")}. Se nenhum servir, transfira para a equipe.`,
        );
      if (combo && (ehColchao(item.categoria ?? item.nome) || categoriaDeLimpeza(item.categoria)))
        return erro(`"${item.nome}" não entra no combo.`);
      for (const s of servicos) {
        const l = precificar(
          {
            item,
            quantidade: p.quantidade ?? 1,
            dupla_face: p.dupla_face,
            classe: p.classe,
            almofadas_soltas: p.almofadas_soltas,
            muito_encardido: p.muito_encardido,
          },
          s,
          regras,
        );
        if (!l) return erro(`"${item.nome}" não tem preço desse serviço na tabela.`);
        linhas.push({ ...l, servico: s });
      }
    }
    const base = Math.round(linhas.reduce((s, l) => s + l.preco * l.quantidade, 0) * 100) / 100;
    const c = e.cupom ? conferirCupom(e.cupom, servicos[0], cupons) : null;
    const cupom = c && c.ok ? c.cupom : null;
    const fixo =
      (e.desconto === "negociacao" || e.desconto === "oferta_followup") && estado.valorFixo
        ? estado.valorFixo
        : null;
    if ((e.desconto === "negociacao" || e.desconto === "oferta_followup") && !fixo)
      return erro("Não há valor liberado nesta conversa: refaça sem esse desconto.");
    const comboComCupom = combo && Boolean(cupom) && !fixo;
    const valorCombo = combo ? descontoPorPct(base, chaves.comboPct) : 0;
    const valorCupom = cupom ? valorDoCupom(cupom, comboComCupom ? base - valorCombo : base) : 0;
    const desconto = fixo
      ? {
          valor: Math.max(0, base - fixo),
          rotulo:
            e.desconto === "negociacao"
              ? "Desconto especial (autorizado)"
              : "Condição especial (vaga nesta semana)",
        }
      : comboComCupom
        ? { valor: valorCombo + valorCupom, rotulo: "combo + cupom" }
        : combo
          ? { pct: chaves.comboPct, rotulo: "Combo higienização + impermeabilização" }
          : cupom
            ? { valor: valorCupom, rotulo: `Cupom ${cupom.codigo}` }
            : null;
    const pixPct = fixo || comboComCupom ? 0 : Number(cfg.desconto_pix_percentual);
    const t = totalizar(linhas, desconto, cfg.parcelas_max, pixPct, 0);
    if (comboComCupom)
      estado.pix = Math.round(t.cond.total * (1 - PIX_COMBO_COM_CUPOM_PCT / 100) * 100) / 100;
    estado.combo = combo;
    const itensTexto = combo
      ? (e.itens ?? []).map((_, k) => {
          const h = linhas[k * 2]!;
          const i = linhas[k * 2 + 1]!;
          return `• ${h.item.nome}: higienização ${brl(h.preco * h.quantidade)} + impermeabilização ${brl(i.preco * i.quantidade)}`;
        })
      : linhas.map((l) => `• ${l.item.nome} — ${brl(l.preco * l.quantidade)}`);
    const linhasDesconto = !t.desconto
      ? []
      : comboComCupom
        ? [
            `Valor cheio: ${brl(t.bruto)}`,
            `Combo higienização + impermeabilização (${chaves.comboPct}%): -${brl(valorCombo)}`,
            `Cupom ${cupom!.codigo}: -${brl(valorCupom)}`,
          ]
        : [
            `${combo || fixo ? "Valor cheio" : "Subtotal"}: ${brl(t.bruto)}`,
            t.desconto.pct !== null
              ? `${t.desconto.rotulo} (${t.desconto.pct}%): -${brl(t.desconto.valor)}`
              : `${t.desconto.rotulo}: −${brl(t.desconto.valor)}`,
          ];
    const texto = [
      "Orçamento criado no sistema (ensaio, não gravado) — Nº 0000. Use exatamente estes valores:",
      combo
        ? "Serviço: Higienização + Impermeabilização (combo: use o cartão do combo das instruções)"
        : "Serviço: Higienização",
      ...itensTexto,
      ...linhasDesconto,
      ...(comboComCupom
        ? [
            `(Para você, não copie: Combo com cupom: os dois descontos juntos, e o cartão vai sem a linha do Pix. Se o cliente perguntar do Pix, diga que no Pix tem um desconto a mais: fica ${brl(estado.pix!)}. Não ofereça o Pix antes.)`,
          ]
        : []),
      ...(fixo && t.desconto
        ? [
            `(Para você, não copie: no cartão, copie as linhas acima nesta ordem: cada item com o preço, "Valor cheio: ${brl(t.bruto)}" e "${t.desconto.rotulo}: −${brl(t.desconto.valor)}", e depois o total. Nunca mande só o valor final.)`,
          ]
        : []),
      `Total${t.desconto ? " com desconto" : ""}: ${brl(t.cond.total)}`,
      "Pagamento para o cliente (copie exatamente assim, nestas linhas):",
      linhasPagamento({
        total: t.cond.total,
        parcelas: t.cond.parcelas,
        pix: t.cond.pix,
        pixPct: t.cond.descontoPixPercentual,
      }),
      `Válido até ${validade(agora, cfg.validade_orcamento_dias).texto}`,
    ].join("\n");
    return { texto, bruto: t.bruto, total: t.cond.total };
  }

  const carregados: string[] = [];
  function respostaDeEnsaio(nome: string, entrada: unknown): string {
    switch (nome) {
      case "carregar_modulo": {
        const pedidas = ((entrada as { modulos?: string[] }).modulos ?? []).filter(
          (c) => !carregados.includes(c),
        );
        carregados.push(...chavesValidas(empresa.modulos ?? [], pedidas));
        return instrucoesDosModulos(empresa, pedidas) || "Módulo já carregado.";
      }
      case "consultar_cliente":
        return "IA desligada: não; sem pós-venda: não. Cliente novo, sem serviços anteriores.";
      case "consultar_cep":
        return "CEP 04101-000: Vila Mariana, São Paulo/SP. Distância até a base: ~8 km. Área atendida: DENTRO (ensaio).";
      case "consultar_agenda":
        return agendaDeEnsaio(agora);
      case "criar_orcamento":
        return orcamento(entrada).texto;
      case "pedir_autorizacao_desconto":
        if (estado.combo) return TEXTO_COMBO_PARA_ESPECIALISTA;
        estado.pedido = entrada as { motivo?: string; concorrente_valor?: number };
        return 'Pedido de autorização registrado (o gestor vai responder). Responda ao cliente com esta frase, exatamente assim, e não escreva mais nada depois dela: "Me dá uns minutinhos que eu já volto com a resposta, tá bom? 💙"';
      case "agendar_followup":
        return "Retorno agendado (ensaio).";
      case "enviar_video":
        return "Vídeo será enviado neste ponto da conversa.";
      case "falar_em_audio":
      case "enviar_audio_padrao":
        return "Áudio será enviado neste ponto da conversa.";
      case "transferir_para_humano":
        return 'Transferência registrada: a equipe assume depois desta resposta. Avise o cliente com esta frase, exatamente assim, e não escreva mais nada depois dela: "Vou chamar a Maria, nossa especialista, e ela te responde em até 10 minutos, tá bom? Ela já está com todas as informações aqui 💙"';
      default:
        return "Ok (ensaio).";
    }
  }
  function marcador(nome: string, entrada: unknown): string | null {
    const e = entrada as { servico?: string; texto?: string };
    if (nome === "enviar_video") return `🎬 [vídeo: ${e.servico ?? "serviço"}]`;
    if (nome === "enviar_audio_padrao") return `🔊 [áudio padrão: ${e.servico ?? "serviço"}]`;
    if (nome === "falar_em_audio") return `🔊 [áudio] ${e.texto ?? ""}`;
    return null;
  }

  const lead: ContextoLead = {
    nome: roteiro.nome,
    telefone: null,
    origem: "Google",
    campanha: null,
    servicoInteresse: null,
    descricaoEstofados: null,
    resumo: null,
    etapa: null,
    clienteExistente: false,
    semPosVenda: false,
    nomeCliente: {
      confirmado: roteiro.nome,
      origem: "perfil",
      perfil: roteiro.nome,
      perguntas: 0,
    } as never,
  };
  const historico: FalaEnsaio[] = [];
  // Orçamento já mandado (sofá retrátil de 3 módulos), como se a Alice tivesse feito antes.
  if (roteiro.comOrcamento) {
    const item =
      tabela.find((t) => /retr[aá]til/i.test(t.nome) && /3 m[oó]dulos/i.test(t.nome)) ??
      tabela.find((t) => /sof[aá]/i.test(t.nome));
    if (!item) throw new Error("tabela sem sofá para o orçamento do ensaio");
    const o = orcamento({ servico: "higienizacao", itens: [{ item: item.nome }] });
    estado.cheio = o.bruto;
    estado.total = o.total;
    estado.combo = false;
    const cartao = o.texto
      .split("\n")
      .filter((l) => !/^Orçamento criado|^Pagamento para o cliente|^Serviço:/.test(l))
      .join("\n");
    historico.push({
      de: "cliente",
      texto: `Oi! Quanto fica pra higienizar meu sofá retrátil de 3 módulos? Meu CEP é 04101-000`,
    });
    historico.push({
      de: "alice",
      texto: `*Higienização Premium*\n${cartao}\n\nProntinho, ${roteiro.nome}! Te enviei a proposta ☺️ Ela faz sentido pro que você está buscando?`,
    });
  }
  for (const m of roteiro.depoisDoOrcamento ?? []) historico.push({ de: m.de, texto: m.texto });
  const antes = historico.map((m) => ({ de: m.de, texto: m.texto }));

  const turnos: TurnoEnsaio2[] = [];
  const uso: Uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, cacheEscrita1h: 0 };
  const comoHistorico = (): MensagemHistorico[] =>
    historico.map((m) => ({
      direcao: m.de === "cliente" ? "Recebida" : "Enviada",
      texto: m.texto,
      tipo: "Texto",
      remetente: m.de === "cliente" ? null : "agent_bot",
      imagens: [],
    }));

  for (const fala of roteiro.falas) {
    const jaOrcou =
      roteiro.comOrcamento ||
      turnos.some((t) => t.ferramentas.some((f) => f.nome === "criar_orcamento"));
    if (fala.so === "sem_orcamento" && jaOrcou) continue;
    if (fala.so === "com_orcamento" && !jaOrcou) continue;
    let aviso: string | undefined;
    let esperado: string | undefined;
    let rotulo = fala.texto ?? "";
    if (fala.sistema === "barrada") {
      // O retorno que a Alice agendou; às 8h do dia seguinte a retomada confere e não sai.
      const ag = turnos.flatMap((t) => t.ferramentas).find((f) => f.nome === "agendar_followup");
      const quando = ag ? quandoDoRetorno(ag.entrada, agora) : null;
      const dia = new Date(agora.getTime() + 86_400_000).toLocaleDateString("sv-SE", {
        timeZone: "America/Sao_Paulo",
      });
      const as8 = new Date(`${dia}T08:00:00-03:00`);
      const barra = quando
        ? retornoBarraRetomada([{ scheduled_at: quando.toISOString(), trilha: "C" }], as8)
        : false;
      turnos.push({
        cliente: "[sistema] 8h do dia seguinte: hora da retomada da manhã",
        sistema: "barrada",
        alice: [
          barra
            ? `(não saiu: o cliente tem retorno combinado às ${quando!.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })})`
            : quando
              ? "(SAIRIA: a trava não pegou o retorno)"
              : "(a Alice não agendou o retorno, então não há o que barrar)",
        ],
        ferramentas: [],
      });
      continue;
    }
    if (fala.sistema === "volta") {
      if (!estado.pedido) {
        turnos.push({
          cliente: "[sistema] volta da autorização",
          sistema: "volta",
          alice: ["(sem pedido de autorização para voltar)"],
          ferramentas: [],
        });
        continue;
      }
      const p = parametrosDaConfig(cfg);
      const concorrente =
        Number(estado.pedido.concorrente_valor) > 0
          ? Number(estado.pedido.concorrente_valor)
          : null;
      const pedido = calcularPedido(
        {
          valorCheio: estado.cheio,
          descontoAtual: estado.cheio - estado.total,
          temCupom: false,
          concorrente,
          foraDoHorario: false,
        },
        p,
      );
      // Caro: o gestor autoriza o sugerido. Concorrente abaixo do teto: ninguém respondeu e a Alice
      // segue sozinha com os 12% depois de 10 minutos.
      const situacao = concorrente ? "automatico" : "autorizado";
      estado.valorFixo = pedido.valorSugerido;
      aviso = avisoDaVolta({
        situacao,
        valorFinal: pedido.valorSugerido,
        valorAtual: estado.total,
        valorCheio: estado.cheio,
        nome: roteiro.nome,
        acimaDoTeto: pedido.acimaDoTeto,
        combo: false,
      });
      rotulo = concorrente
        ? `[sistema] 10 min sem resposta do gestor: a Alice segue sozinha com ${brl(pedido.valorSugerido)}`
        : `[sistema] o gestor autorizou ${brl(pedido.valorSugerido)}`;
    }
    if (fala.sistema === "retomada") {
      const passo = comRetomadaManha(passoDaEtapa("A3"), true)!;
      aviso = avisoDoToque(passo, cfg as never, false);
      esperado = textoRetomadaManha(
        roteiro.nome,
        roteiro.chave === "retomada_marido" ? "marido" : null,
      );
      rotulo = "[sistema] 8h do dia seguinte: retomada da manhã (toque 3)";
    }
    if (fala.sistema === "followup5") {
      const oferta = calcularOferta5({
        cheio: estado.cheio,
        descontoAtual: estado.cheio - estado.total,
        negociou: false,
        pct: fase4.followup5Pct,
        piso: fase4.followup5Piso,
      });
      esperado = textoOferta5({
        nome: roteiro.nome,
        oferta,
        comVaga: true,
        pct: fase4.followup5Pct,
        prazo: diaDoPrazo(agora),
      });
      estado.valorFixo = oferta.valor;
      aviso = avisoDaOferta5(esperado, oferta);
      rotulo = "[sistema] D2 16h: follow-up 5 (com vaga na semana)";
    }
    if (fala.sistema === "retorno_c") {
      const ag = turnos.flatMap((t) => t.ferramentas).find((f) => f.nome === "agendar_followup");
      const e = ag
        ? (JSON.parse(ag.entrada) as { motivo?: string; mensagem_sugerida?: string })
        : {};
      aviso = [
        `Hora do follow-up agendado (trilha C): ${e.motivo ?? "retorno combinado"}.`,
        e.mensagem_sugerida ? `Sugestão anotada: "${e.mensagem_sugerida}".` : null,
        "O cliente não respondeu desde a última mensagem da empresa. Faça agora o toque de follow-up, seguindo as instruções (algo novo, uma pergunta só). Se as instruções mandarem fazer algo neste toque (ex.: mandar o orçamento), use as ferramentas normalmente.",
        "Se não fizer sentido mandar nada (por exemplo, o atendimento já foi encerrado), responda exatamente NADA.",
        "Não agende o próximo toque: o sistema agenda sozinho.",
      ]
        .filter(Boolean)
        .join(" ");
      rotulo = "[sistema] hora do retorno combinado";
    }
    if (!fala.sistema) historico.push({ de: "cliente", texto: fala.texto ?? "" });
    const h = comoHistorico();
    const atalhoAgora = !fala.sistema && chaves.atalhoApressado && atalhoDoApressado(h).ativo;
    const travado = !fala.sistema && !atalhoAgora && !precoLiberado(h);
    const momento = [
      instrucoesDoMomento(new Date(), lead),
      travado ? AVISO_PRECO_TRAVADO : null,
      atalhoAgora ? AVISO_ATALHO : null,
      !fala.sistema && !atalhoAgora && jaPerguntouOMotivo(h) ? AVISO_MOTIVO_JA_FEITO : null,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const r = await rodarAliceEnsaio({
        empresaId,
        cliente,
        modelo: cfg.modelo,
        esforco: cfg.esforco,
        ferramentas,
        fixas: [fixas, instrucoesDosModulos(empresa, carregados)].filter(Boolean).join("\n\n"),
        momento,
        historico: [...historico],
        respostaDeEnsaio,
        precoTravado: travado,
        cacheComoProducao: true,
        marcador,
        ...(aviso ? { aviso } : {}),
      });
      for (const k of Object.keys(uso) as Array<keyof Uso>)
        uso[k] = (uso[k] ?? 0) + (r.uso[k] ?? 0);
      turnos.push({
        cliente: rotulo,
        ...(fala.sistema ? { sistema: fala.sistema } : {}),
        alice: r.resposta.filter((t) => t.trim() !== "NADA"),
        ferramentas: r.ferramentas.map((u) => ({
          nome: u.nome,
          entrada: JSON.stringify(u.entrada).slice(0, 600),
        })),
        ...(esperado ? { esperado } : {}),
      });
      historico.push({ de: "alice", texto: r.resposta.join("\n\n") || "(sem resposta)" });
      if (r.ferramentas.some((u) => u.nome === "transferir_para_humano")) break;
    } catch (e) {
      turnos.push({
        cliente: rotulo,
        alice: [],
        ferramentas: [],
        erro: e instanceof Error ? e.message.slice(0, 300) : String(e),
      });
      break;
    }
  }
  return {
    turnos,
    antes,
    custoUsd: Math.round(custoEstimadoUsd(cfg.modelo, uso) * 10000) / 10000,
    modelo: cfg.modelo,
    pix: estado.pix,
  };
}

// ---------------------------------------------------------------- pela varredura
function ensaioNovo(cfg: {
  instrucoes: string | null;
  modulos: unknown;
  modelo: string;
}): EnsaioVendas2 {
  const base = cfg.instrucoes ?? "";
  const imperm = modulosComFase2(cfg.modulos).find((m) => m.chave === "impermeabilizacao");
  return {
    versao: VERSAO_ENSAIO_VENDAS_2,
    modelo: cfg.modelo,
    criadoEm: new Date().toISOString(),
    textos: {
      nucleoAntes: md5(base),
      nucleoEnsaiado: md5(nucleoComFases(base, md5)),
      nucleoEsperado: MD5_DEPOIS_FASE4,
      imperm: `${md5(String(imperm?.texto ?? ""))} (esperado ${MD5_DEPOIS_FASE2.impermeabilizacao})`,
    },
    conversas: CONVERSAS_ENSAIO_2.map((c) => ({
      chave: c.chave,
      titulo: c.titulo,
      situacao: "pendente",
      turnos: [],
    })),
  };
}

async function salvar(db: Db, empresaId: string, e: EnsaioVendas2) {
  await db
    .from("app_settings")
    .upsert(
      { empresa_id: empresaId, key: CHAVE_ENSAIO_VENDAS_2, value: e as never },
      { onConflict: "empresa_id,key" },
    );
}

/**
 * Chamada pela varredura: roda a próxima conversa pendente (uma por chamada), só na empresa que
 * tem os textos de partida conferidos (a Turbine). Depois das sete, não faz mais nada até a versão
 * mudar.
 */
export async function rodarEnsaioVendas2Pendente(
  agora = new Date(),
): Promise<{ empresa: string; conversa: string; situacao: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  const { data: cfgs } = await db.from("ia_configuracoes").select("empresa_id").eq("ativo", true);
  for (const { empresa_id: emp } of (cfgs ?? []) as Array<{ empresa_id: string }>) {
    const cfg = await lerConfig(db, emp);
    if (!cfg?.ativo) continue;
    // Só onde o texto de hoje é o de partida dos SQL (ou já com alguma fase gravada).
    if (md5(nucleoComFases(cfg.instrucoes ?? "", md5)) !== MD5_DEPOIS_FASE4) continue;
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("empresa_id", emp)
      .eq("key", CHAVE_ENSAIO_VENDAS_2)
      .maybeSingle();
    let e = (data as { value?: EnsaioVendas2 } | null)?.value ?? null;
    if (!e || e.versao !== VERSAO_ENSAIO_VENDAS_2) e = ensaioNovo(cfg);
    // Conversa nova no roteiro (mesma versão): entra como pendente, sem refazer as já feitas.
    for (const c of CONVERSAS_ENSAIO_2)
      if (!e.conversas.some((x) => x.chave === c.chave))
        e.conversas.push({ chave: c.chave, titulo: c.titulo, situacao: "pendente", turnos: [] });
    const rodando = e.conversas.find((c) => c.situacao === "rodando");
    if (rodando) {
      if (agora.getTime() - Date.parse(rodando.inicio ?? "") < RODANDO_MAX_MS) continue;
      rodando.situacao = "erro";
      rodando.erro = "a rodada caiu antes de terminar";
    }
    const proxima = e.conversas.find((c) => c.situacao === "pendente");
    if (!proxima) {
      if (rodando) await salvar(db, emp, e);
      continue;
    }
    const roteiro = CONVERSAS_ENSAIO_2.find((c) => c.chave === proxima.chave)!;
    proxima.situacao = "rodando";
    proxima.inicio = agora.toISOString();
    await salvar(db, emp, e);
    try {
      const r = await rodarConversaEnsaio2(db, emp, roteiro);
      proxima.turnos = r.turnos;
      proxima.antes = r.antes;
      proxima.custoUsd = r.custoUsd;
      proxima.conferencia = conferirConversa2(roteiro.chave, r.turnos, r.pix);
      proxima.situacao = r.turnos.some((t) => t.erro) ? "erro" : "feita";
      e.modelo = r.modelo;
    } catch (err) {
      proxima.situacao = "erro";
      proxima.erro = err instanceof Error ? err.message.slice(0, 300) : String(err);
    }
    proxima.fim = new Date().toISOString();
    await salvar(db, emp, e);
    return { empresa: emp, conversa: proxima.chave, situacao: proxima.situacao };
  }
  return null;
}
