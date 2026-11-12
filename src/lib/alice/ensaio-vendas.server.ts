/**
 * Ensaio da fase 2 de "Alice e vendas" (pedido do dono em 12/11): a Alice de verdade (mesmo modelo,
 * instruções e ferramentas da empresa), com os textos novos da fase 2 aplicados só na memória e as
 * chaves atalho_apressado e combo_ligado ligadas só no ensaio, conversa com três clientes de mentira:
 * o apressado, o que pede combo e o que manda foto. Nada é enviado nem gravado, fora o resultado em
 * app_settings (alice_ensaio_vendas). Roda sozinho pela varredura: uma conversa por rodada.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { cuponsAtivos, ferramentasDisponiveis } from "./ferramentas.server";
import { contextoEmpresa, etapasAbertas, lerConfig } from "./motor.server";
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
import { AVISO_PRECO_TRAVADO, precoLiberado, temPreco } from "./preco-depois";
import {
  AVISO_ATALHO,
  AVISO_MOTIVO_JA_FEITO,
  REFAZER_ATALHO,
  RECUSA_AUDIO_NO_ATALHO,
  atalhoDoApressado,
  jaPerguntouOMotivo,
} from "./atalho";
import { precificar, totalizar, type ItemTabela, type LinhaOrcamento } from "./orcamento-alice";
import { conferirCupom, valorDoCupom } from "./cupons";
import { validade } from "./regras";
import { chavesVendas } from "./chaves";
import {
  MD5_DEPOIS_FASE2,
  MD5_NUCLEO_ANTES_FASE2,
  NUCLEO_FASE2,
  aplicarTrocas,
  modulosComFase2,
  vezesDosTrechos,
} from "./textos-fase2";
import { ehColchao } from "@/lib/dupla-face";
import { categoriaDeLimpeza } from "@/lib/unidade";
import { linhasPagamento } from "@/lib/texto-pagamento";
import { brl } from "@/lib/format";

type Db = SupabaseClient<Database>;

/** Mudou o ensaio (roteiro ou textos)? Troque a versão e ele roda de novo, uma vez. */
export const VERSAO_ENSAIO_VENDAS = "fase2-1";
export const CHAVE_ENSAIO_VENDAS = "alice_ensaio_vendas";
/** Fotos públicas de sofás (Wikimedia Commons), para o cliente que manda foto. */
const FOTO_SOFA_CHAISE =
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c5/Cozy_living_room_with_a_gray_sofa.jpg/1280px-Cozy_living_room_with_a_gray_sofa.jpg";
const FOTO_SOFA_COMUM =
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8c/Cozy_living_room_setup_with_a_warm_sofa%2C_coffee_cup%2C_and_an_open_book_in_a_softly_lit_environment.jpg/1280px-Cozy_living_room_setup_with_a_warm_sofa%2C_coffee_cup%2C_and_an_open_book_in_a_softly_lit_environment.jpg";
/** Conversa marcada "rodando" há mais tempo que isto não terminou (a rodada caiu). */
const RODANDO_MAX_MS = 20 * 60_000;

type FalaRoteiro = {
  texto: string;
  /** Endereço da foto que o cliente manda junto com o texto. */
  foto?: string;
  /** Só vai se a Alice ainda não mandou o orçamento / só depois do orçamento. */
  so?: "sem_orcamento" | "com_orcamento";
};

export const CONVERSAS_ENSAIO: Array<{
  chave: "apressado" | "combo" | "foto" | "foto2";
  titulo: string;
  nome: string;
  falas: FalaRoteiro[];
}> = [
  {
    chave: "apressado",
    titulo: "Cliente apressado",
    nome: "Eduardo",
    falas: [
      {
        texto:
          "Oi! Quanto fica pra higienizar meu sofá retrátil de 2 módulos, uns 2 metros? Meu CEP é 04101-000",
      },
      { texto: "Mas me fala o valor, por favor", so: "sem_orcamento" },
      { texto: "Faz sim! Quando vocês conseguem vir?", so: "com_orcamento" },
    ],
  },
  {
    chave: "combo",
    titulo: "Cliente que pede combo",
    nome: "Bianca",
    falas: [
      {
        texto:
          "Boa tarde! Quero higienizar e impermeabilizar meu sofá de 3 lugares. Tenho dois cachorros que sobem nele direto.",
      },
      {
        texto:
          "Foto agora não consigo, tô no trabalho. É um sofá comum de 3 lugares, uns 2 metros. CEP 04101-000",
      },
      { texto: "Pode mandar o valor dos dois juntos", so: "sem_orcamento" },
      { texto: "Fechado! Quais dias vocês têm?", so: "com_orcamento" },
    ],
  },
  {
    chave: "foto",
    titulo: "Cliente que manda foto",
    nome: "Carla",
    falas: [
      { texto: "Oi, boa tarde! Quanto fica pra limpar esse sofá?", foto: FOTO_SOFA_CHAISE },
      { texto: "04101-000" },
      { texto: "Só queria saber o valor mesmo", so: "sem_orcamento" },
      { texto: "Entendi. Tem horário essa semana?", so: "com_orcamento" },
    ],
  },
  {
    // A primeira foto era de um sofá com chaise (fora da tabela: a Alice transferiu, certo).
    chave: "foto2",
    titulo: "Cliente que manda foto (sofá comum)",
    nome: "Paula",
    falas: [
      { texto: "Oi, boa tarde! Quanto fica pra limpar esse sofá?", foto: FOTO_SOFA_COMUM },
      { texto: "04101-000" },
      { texto: "Só queria saber o valor mesmo", so: "sem_orcamento" },
      { texto: "Entendi. Tem horário essa semana?", so: "com_orcamento" },
    ],
  },
];

export type TurnoEnsaio = {
  cliente: string;
  foto: boolean;
  /** O atalho do apressado valeu nesta resposta. */
  atalho: boolean;
  /** A trava de preço (regra nº 1) valeu nesta resposta. */
  travado: boolean;
  alice: string[];
  /** Textos que não iriam ao cliente (trava de preço ou resposta refeita do atalho). */
  retidos: string[];
  ferramentas: Array<{ nome: string; entrada: string }>;
  refeita: boolean;
  erro?: string;
};

export type ConversaEnsaio = {
  chave: string;
  titulo: string;
  situacao: "pendente" | "rodando" | "feita" | "erro";
  inicio?: string;
  fim?: string;
  turnos: TurnoEnsaio[];
  conferencia?: { passou: boolean; problemas: string[] };
  custoUsd?: number;
  erro?: string;
};

export type EnsaioVendas = {
  versao: string;
  modelo: string;
  criadoEm: string;
  /** Conferência de que o ensaio usou exatamente o texto do SQL da fase 2. */
  textos: {
    nucleoAntes: string;
    nucleoEnsaiado: string;
    nucleoEsperado: string;
    trechos: number[];
    modulos: Record<string, { ensaiado: string; esperado: string }>;
  };
  conversas: ConversaEnsaio[];
};

const md5 = (t: string) => createHash("md5").update(t, "utf8").digest("hex");

// ---------------------------------------------------------------- conferência (pura)
const DIAS =
  /\b(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|amanh[aã])\b|\b\d{1,2}\/\d{1,2}\b/gi;
/** Dias diferentes citados num texto ("sexta", "sábado", "16/11"...). */
export function diasCitados(texto: string): number {
  const vistos = new Set(
    [...texto.matchAll(DIAS)].map((m) => m[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")),
  );
  return vistos.size;
}
const PEDE_FOTO = /(manda|mandar|envia|enviar|tira|tirar|consegue|pode)[^.?!\n]{0,40}\bfotos?\b/i;
const AUDIO = ["falar_em_audio", "enviar_audio_padrao"];

export function conferirConversa(
  chave: string,
  turnos: TurnoEnsaio[],
): NonNullable<ConversaEnsaio["conferencia"]> {
  const problemas: string[] = [];
  const texto = (t: TurnoEnsaio) => t.alice.join("\n");
  const usou = (t: TurnoEnsaio, nome: string) => t.ferramentas.some((f) => f.nome === nome);
  const tudo = turnos.map(texto).join("\n");
  if (turnos.some((t) => t.erro)) problemas.push("erro numa resposta");
  if ((tudo.match(/mais te incomoda/gi) ?? []).length > 1)
    problemas.push("repetiu a pergunta do motivo");
  if (turnos.slice(1).some((t) => /Eu sou a Alice/i.test(texto(t))))
    problemas.push("repetiu a apresentação");
  const comOrcamento = turnos.findIndex((t) => usou(t, "criar_orcamento"));
  if (comOrcamento < 0) problemas.push("não chegou ao orçamento");
  const depois = comOrcamento >= 0 ? turnos.slice(comOrcamento + 1) : [];
  const agenda = depois.find((t) => usou(t, "consultar_agenda") || diasCitados(texto(t)) > 0);
  if (depois.length && (!agenda || diasCitados(texto(agenda)) < 2))
    problemas.push("não ofereceu dois horários em dias diferentes");
  if (chave === "apressado") {
    const t0 = turnos[0];
    if (!t0?.atalho) problemas.push("o atalho não valeu na primeira mensagem");
    if (t0 && !temPreco(texto(t0))) problemas.push("a primeira resposta saiu sem o valor");
    if (t0 && !usou(t0, "enviar_video")) problemas.push("não mandou o vídeo junto");
    if (t0 && AUDIO.some((a) => usou(t0, a))) problemas.push("tentou mandar áudio no atalho");
    if (t0?.refeita) problemas.push("precisou refazer a resposta (veio sem o valor)");
  }
  if (chave === "combo") {
    const orc = turnos.flatMap((t) => t.ferramentas).find((f) => f.nome === "criar_orcamento");
    if (orc && !/"combo"\s*:\s*true/.test(orc.entrada)) problemas.push("orçou sem o combo");
    if (comOrcamento >= 0 && !/combo/i.test(texto(turnos[comOrcamento]!)))
      problemas.push("o cartão não fala do combo");
    if (turnos.slice(1).some((t) => PEDE_FOTO.test(texto(t))))
      problemas.push("pediu a foto de novo depois de o cliente dizer que não conseguia");
  }
  if (chave === "foto" || chave === "foto2") {
    const t0 = turnos[0];
    if (t0 && temPreco(texto(t0))) problemas.push("passou preço antes do CEP");
    if (t0 && !/\bcep\b/i.test(texto(t0))) problemas.push("não pediu o CEP");
    if (turnos.slice(1).some((t) => PEDE_FOTO.test(texto(t))))
      problemas.push("pediu foto de novo (o cliente já mandou)");
  }
  return { passou: problemas.length === 0, problemas };
}

// ---------------------------------------------------------------- uma conversa
async function baixarFoto(url: string): Promise<FalaEnsaio["imagem"]> {
  const r = await fetch(url, { headers: { "User-Agent": "NexaOS-ensaio/1.0" } });
  if (!r.ok) throw new Error(`foto do ensaio não baixou (${r.status})`);
  return { mediaType: "image/jpeg", base64: Buffer.from(await r.arrayBuffer()).toString("base64") };
}

/** Próximos dias de atendimento (segunda a sábado), para a agenda de mentira. */
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

export async function rodarConversaEnsaio(
  db: Db,
  empresaId: string,
  roteiro: (typeof CONVERSAS_ENSAIO)[number],
): Promise<{ turnos: TurnoEnsaio[]; custoUsd: number; modelo: string }> {
  const cfgReal = await lerConfig(db, empresaId);
  if (!cfgReal) throw new Error("Esta empresa não tem a Alice configurada.");
  // Textos e chaves da fase 2 só na memória do ensaio.
  const base = cfgReal.instrucoes ?? "";
  const cfg = {
    ...cfgReal,
    instrucoes: md5(base) === MD5_DEPOIS_FASE2.nucleo ? base : aplicarTrocas(base, NUCLEO_FASE2),
    modulos: modulosComFase2(cfgReal.modulos) as never,
    atalho_apressado: true,
    combo_ligado: true,
  };
  const chaves = chavesVendas(cfg);
  const etapas = await etapasAbertas(db, empresaId);
  const ferramentas = ferramentasDisponiveis(cfg, etapas, { regraNome: true });
  const empresa = await contextoEmpresa(
    db,
    empresaId,
    cfg,
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

  /** criar_orcamento de ensaio: mesma conta e mesmo texto da ferramenta (com combo), sem gravar. */
  function orcamentoDeEnsaio(entrada: unknown): string {
    const e = entrada as {
      servico?: "higienizacao" | "impermeabilizacao";
      itens?: Array<{
        item: string;
        quantidade?: number;
        dupla_face?: boolean;
        classe?: "A" | "B" | "C";
        almofadas_soltas?: boolean;
        muito_encardido?: boolean;
      }>;
      cupom?: string;
      combo?: boolean;
    };
    const combo = Boolean(e.combo) && chaves.comboLigado;
    const servicos = combo
      ? (["higienizacao", "impermeabilizacao"] as const)
      : ([e.servico ?? "higienizacao"] as const);
    const linhas: Array<LinhaOrcamento & { servico: string }> = [];
    for (const p of e.itens ?? []) {
      const item = tabela.find((t) => t.nome.trim().toLowerCase() === p.item.trim().toLowerCase());
      if (!item)
        return `Item "${p.item}" não está na tabela. Itens válidos: ${tabela.map((i) => i.nome).join("; ")}. Se nenhum servir, transfira para a equipe.`;
      if (combo && (ehColchao(item.categoria ?? item.nome) || categoriaDeLimpeza(item.categoria)))
        return `"${item.nome}" não entra no combo (não fazemos impermeabilização desse item).`;
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
        if (!l) return `"${item.nome}" não tem preço desse serviço na tabela.`;
        linhas.push({ ...l, servico: s });
      }
    }
    const base = linhas.reduce((s, l) => s + l.preco * l.quantidade, 0);
    const c = e.cupom ? conferirCupom(e.cupom, servicos[0], cupons) : null;
    const valorCupom = c && c.ok ? valorDoCupom(c.cupom, base) : 0;
    const valorCombo = combo ? Math.round(base * chaves.comboPct) / 100 : 0;
    const desconto =
      combo && valorCombo >= valorCupom
        ? { pct: chaves.comboPct, rotulo: "Combo higienização + impermeabilização" }
        : c && c.ok
          ? { valor: valorCupom, rotulo: `Cupom ${c.cupom.codigo}` }
          : null;
    const t = totalizar(linhas, desconto, cfg.parcelas_max, Number(cfg.desconto_pix_percentual), 0);
    const itensTexto = combo
      ? (e.itens ?? []).map((_, k) => {
          const h = linhas[k * 2]!;
          const i = linhas[k * 2 + 1]!;
          return `• ${h.quantidade > 1 ? `${h.quantidade}x ` : ""}${h.item.nome}: higienização ${brl(h.preco * h.quantidade)} + impermeabilização ${brl(i.preco * i.quantidade)}`;
        })
      : linhas.map((l) => `• ${l.item.nome} — ${brl(l.preco * l.quantidade)}`);
    return [
      "Orçamento criado no sistema (ensaio, não gravado) — Nº 0000. Use exatamente estes valores:",
      combo
        ? "Serviço: Higienização + Impermeabilização (combo: use o cartão do combo das instruções)"
        : `Serviço: ${servicos[0] === "higienizacao" ? "Higienização" : "Impermeabilização"}`,
      ...itensTexto,
      ...(t.desconto
        ? [
            `${combo ? "Valor cheio" : "Subtotal"}: ${brl(t.bruto)}`,
            t.desconto.pct !== null
              ? `${t.desconto.rotulo} (${t.desconto.pct}%): -${brl(t.desconto.valor)}`
              : `${t.desconto.rotulo}: −${brl(t.desconto.valor)}`,
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
  }

  const carregados: string[] = [];
  let atalhoAgora = false;
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
        return "CEP 04101-000: Vila Mariana, São Paulo/SP. Dentro da área atendida (ensaio).";
      case "consultar_agenda":
        return agendaDeEnsaio(agora);
      case "criar_orcamento":
        return orcamentoDeEnsaio(entrada);
      case "enviar_video":
        return "Vídeo será enviado neste ponto da conversa.";
      case "falar_em_audio":
      case "enviar_audio_padrao":
        return atalhoAgora ? RECUSA_AUDIO_NO_ATALHO : "Áudio será enviado neste ponto da conversa.";
      case "transferir_para_humano":
        return 'Transferência registrada: a equipe assume depois desta resposta. Avise o cliente com esta frase, exatamente assim, e não escreva mais nada depois dela: "Vou chamar a Maria, nossa especialista, e ela te responde em até 10 minutos, tá bom? Ela já está com todas as informações aqui 💙"';
      default:
        return "Ok (ensaio).";
    }
  }
  function marcador(nome: string, entrada: unknown): string | null {
    const e = entrada as { servico?: string; texto?: string };
    if (nome === "enviar_video") return `🎬 [vídeo: ${e.servico ?? "serviço"}]`;
    if (AUDIO.includes(nome) && atalhoAgora) return null;
    if (nome === "enviar_audio_padrao") return `🔊 [áudio padrão: ${e.servico ?? "serviço"}]`;
    if (nome === "falar_em_audio") return `🔊 [áudio] ${e.texto ?? ""}`;
    if (nome === "enviar_dados_tecnico") return "📷 [foto e nome do técnico]";
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
  const urlFoto = roteiro.falas.find((f) => f.foto)?.foto;
  const foto = urlFoto ? await baixarFoto(urlFoto) : undefined;
  const historico: FalaEnsaio[] = [];
  const turnos: TurnoEnsaio[] = [];
  const uso: Uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, cacheEscrita1h: 0 };
  const comoHistorico = (): MensagemHistorico[] =>
    historico.map((m) => ({
      direcao: m.de === "cliente" ? "Recebida" : "Enviada",
      texto: m.texto,
      tipo: m.imagem ? "Imagem" : "Texto",
      remetente: m.de === "cliente" ? null : "agent_bot",
      imagens: m.imagem ? [m.imagem] : [],
    }));
  for (const fala of roteiro.falas) {
    const jaOrcou = turnos.some((t) => t.ferramentas.some((f) => f.nome === "criar_orcamento"));
    if (fala.so === "sem_orcamento" && jaOrcou) continue;
    if (fala.so === "com_orcamento" && !jaOrcou) continue;
    historico.push({
      de: "cliente",
      texto: fala.texto,
      ...(fala.foto && foto ? { imagem: foto } : {}),
    });
    const h = comoHistorico();
    atalhoAgora = chaves.atalhoApressado && atalhoDoApressado(h).ativo;
    const travado = !atalhoAgora && !precoLiberado(h);
    const momento = [
      instrucoesDoMomento(new Date(), lead),
      travado ? AVISO_PRECO_TRAVADO : null,
      atalhoAgora ? AVISO_ATALHO : null,
      !atalhoAgora && jaPerguntouOMotivo(h) ? AVISO_MOTIVO_JA_FEITO : null,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const r = await rodarAliceEnsaio({
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
        ...(atalhoAgora ? { refazerSemValor: REFAZER_ATALHO } : {}),
      });
      for (const k of Object.keys(uso) as Array<keyof Uso>)
        uso[k] = (uso[k] ?? 0) + (r.uso[k] ?? 0);
      turnos.push({
        cliente: fala.texto,
        foto: Boolean(fala.foto),
        atalho: atalhoAgora,
        travado,
        alice: r.resposta.filter((t) => t.trim() !== "NADA"),
        retidos: r.retidos,
        ferramentas: r.ferramentas.map((u) => ({
          nome: u.nome,
          entrada: JSON.stringify(u.entrada).slice(0, 600),
        })),
        refeita: Boolean(r.refeita),
      });
      historico.push({ de: "alice", texto: r.resposta.join("\n\n") || "(sem resposta)" });
      if (r.ferramentas.some((u) => u.nome === "transferir_para_humano")) break;
    } catch (e) {
      turnos.push({
        cliente: fala.texto,
        foto: Boolean(fala.foto),
        atalho: atalhoAgora,
        travado,
        alice: [],
        retidos: [],
        ferramentas: [],
        refeita: false,
        erro: e instanceof Error ? e.message.slice(0, 300) : String(e),
      });
      break;
    }
  }
  return {
    turnos,
    custoUsd: Math.round(custoEstimadoUsd(cfg.modelo, uso) * 10000) / 10000,
    modelo: cfg.modelo,
  };
}

// ---------------------------------------------------------------- pela varredura
function ensaioNovo(cfg: {
  instrucoes: string | null;
  modulos: unknown;
  modelo: string;
}): EnsaioVendas {
  const base = cfg.instrucoes ?? "";
  const ensaiado = md5(base) === MD5_DEPOIS_FASE2.nucleo ? base : aplicarTrocas(base, NUCLEO_FASE2);
  const modulos: EnsaioVendas["textos"]["modulos"] = {};
  for (const m of modulosComFase2(cfg.modulos))
    if (m.chave && m.chave in MD5_DEPOIS_FASE2 && m.chave !== "nucleo")
      modulos[m.chave] = {
        ensaiado: md5(String(m.texto ?? "")),
        esperado: MD5_DEPOIS_FASE2[m.chave as keyof typeof MD5_DEPOIS_FASE2],
      };
  return {
    versao: VERSAO_ENSAIO_VENDAS,
    modelo: cfg.modelo,
    criadoEm: new Date().toISOString(),
    textos: {
      nucleoAntes: md5(base),
      nucleoEnsaiado: md5(ensaiado),
      nucleoEsperado: MD5_DEPOIS_FASE2.nucleo,
      trechos: md5(base) === MD5_NUCLEO_ANTES_FASE2 ? vezesDosTrechos(base, NUCLEO_FASE2) : [],
      modulos,
    },
    conversas: CONVERSAS_ENSAIO.map((c) => ({
      chave: c.chave,
      titulo: c.titulo,
      situacao: "pendente",
      turnos: [],
    })),
  };
}

async function salvar(db: Db, empresaId: string, e: EnsaioVendas) {
  await db
    .from("app_settings")
    .upsert(
      { empresa_id: empresaId, key: CHAVE_ENSAIO_VENDAS, value: e as never },
      { onConflict: "empresa_id,key" },
    );
}

/**
 * Chamada pela varredura: roda a próxima conversa pendente do ensaio (uma por chamada, em uma
 * empresa só), nas empresas com a Alice ligada. Depois das três, não faz mais nada até a versão mudar.
 */
export async function rodarEnsaioVendasPendente(
  agora = new Date(),
): Promise<{ empresa: string; conversa: string; situacao: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  const { data: cfgs } = await db.from("ia_configuracoes").select("empresa_id").eq("ativo", true);
  for (const { empresa_id: emp } of (cfgs ?? []) as Array<{ empresa_id: string }>) {
    const cfg = await lerConfig(db, emp);
    if (!cfg?.ativo) continue;
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("empresa_id", emp)
      .eq("key", CHAVE_ENSAIO_VENDAS)
      .maybeSingle();
    let e = (data as { value?: EnsaioVendas } | null)?.value ?? null;
    if (!e || e.versao !== VERSAO_ENSAIO_VENDAS) e = ensaioNovo(cfg);
    // Conversa nova no roteiro (mesma versão): entra como pendente, sem refazer as já feitas.
    for (const c of CONVERSAS_ENSAIO)
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
    const roteiro = CONVERSAS_ENSAIO.find((c) => c.chave === proxima.chave)!;
    proxima.situacao = "rodando";
    proxima.inicio = agora.toISOString();
    await salvar(db, emp, e);
    try {
      const r = await rodarConversaEnsaio(db, emp, roteiro);
      proxima.turnos = r.turnos;
      proxima.custoUsd = r.custoUsd;
      proxima.conferencia = conferirConversa(proxima.chave, r.turnos);
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
