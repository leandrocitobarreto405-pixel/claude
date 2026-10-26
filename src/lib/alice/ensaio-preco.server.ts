/**
 * Ensaio da regra nº 1 (nunca preço antes de valor) e do colchão dupla face, 26/10: reproduz a
 * conversa final 7975 (cotação de colchão queen para o irmão, tudo numa mensagem só, CEP, cupom
 * BLOG50 e a pergunta das faces e laterais), com nome e CEP trocados. A Alice de verdade responde
 * mensagem a mensagem, com a trava do motor; o orçamento é calculado pela tabela e pelas regras da
 * empresa, sem gravar. Nada é enviado; o resultado fica em app_settings (alice_ensaio_preco).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { cuponsAtivos, ferramentasDisponiveis } from "./ferramentas.server";
import { contextoEmpresa, etapasAbertas, lerConfig } from "./motor.server";
import { rodarAliceEnsaio, type FalaEnsaio } from "./ensaio-rodar.server";
import {
  instrucoesDoMomento,
  instrucoesDosModulos,
  instrucoesFixas,
  type ContextoLead,
} from "./prompt";
import { chavesValidas } from "./modulos";
import { AVISO_PRECO_TRAVADO, precoLiberado } from "./preco-depois";
import { precificar, totalizar, type ItemTabela, type LinhaOrcamento } from "./orcamento-alice";
import { conferirCupom, valorDoCupom } from "./cupons";
import { validade } from "./regras";
import { comDuplaFace } from "@/lib/dupla-face";
import { linhasPagamento } from "@/lib/texto-pagamento";
import { brl } from "@/lib/format";

type Db = SupabaseClient<Database>;

const NOME = "Rodrigo";

/** Mensagens do cliente, na ordem; a terceira só vai se a Alice ainda não mandou o orçamento. */
export const FALAS_CLIENTE = [
  "Boa tarde! Estou cotando para meu irmão a higienização avulsa de 1 colchão queen (aprox. 1,58 x 1,98 m), em domicílio, CEP 04101-000. Qual o valor final com deslocamento, no Pix e no cartão? Inclui as duas faces e as laterais? Qual o prazo de secagem e a garantia? Vocês têm disponibilidade amanhã? Se não, qual a próxima data e os horários disponíveis? Por enquanto é só cotação, sem reserva de horário. Vi no site o cupom BLOG50 de R$ 50; ele vale para esse serviço? Obrigado!",
  "Isso, é lá mesmo. Ele tem rinite e o colchão tem umas manchas amareladas. E ele usa os dois lados, vira o colchão de vez em quando.",
  "Pode me mandar o valor, por favor?",
];

export type PassoEnsaioPreco = {
  cliente: string;
  /** Preço travado nesta resposta (o cliente ainda não tinha respondido nenhuma pergunta). */
  travado: boolean;
  alice: string[];
  /** Textos com preço barrados pela trava (não iriam ao cliente). */
  retidos: string[];
  ferramentas: Array<{ nome: string; entrada: string }>;
  erro?: string;
};

export type EnsaioPreco = {
  executadoEm: string;
  modelo: string;
  passos: PassoEnsaioPreco[];
  /** Conferência automática: a primeira resposta sem preço e o orçamento só depois. */
  conferencia: { passou: boolean; motivo: string };
};

/** Conferência: 1ª resposta sem preço/orçamento; orçamento depois, com dupla face. */
export function conferirEnsaioPreco(passos: PassoEnsaioPreco[]): {
  passou: boolean;
  motivo: string;
} {
  const problemas: string[] = [];
  const p1 = passos[0];
  if (!p1) return { passou: false, motivo: "não rodou" };
  if (p1.alice.some((t) => /R\$\s?\d/.test(t))) problemas.push("preço na primeira resposta");
  if (p1.retidos.length) problemas.push("a trava precisou barrar preço na primeira resposta");
  if (!p1.alice.some((t) => /alice/i.test(t))) problemas.push("não se apresentou");
  if (/confirma[^.\n]*no local/i.test(p1.alice.join("\n")))
    problemas.push("disse que o técnico confirma no local");
  const orc = passos.flatMap((p) => p.ferramentas).find((f) => f.nome === "criar_orcamento");
  if (!orc) problemas.push("não chegou ao orçamento");
  else if (!/"dupla_face"\s*:\s*true/.test(orc.entrada))
    problemas.push("orçamento sem dupla face (o cliente usa os dois lados)");
  if (passos.slice(1).some((p) => p.alice.some((t) => /Eu sou a Alice|Aqui é a Alice/i.test(t))))
    problemas.push("repetiu a apresentação");
  return { passou: !problemas.length, motivo: problemas.join("; ") || "ok" };
}

export async function rodarEnsaioPreco(db: Db, empresaId: string): Promise<EnsaioPreco> {
  const cfg = await lerConfig(db, empresaId);
  if (!cfg) throw new Error("Esta empresa não tem a Alice configurada.");
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

  /** criar_orcamento de ensaio: mesma conta da ferramenta (tabela, regras, cupom), sem gravar. */
  function orcamentoDeEnsaio(entrada: unknown): string {
    const e = entrada as {
      servico?: "higienizacao" | "impermeabilizacao";
      itens?: Array<{ item: string; quantidade?: number; dupla_face?: boolean }>;
      cupom?: string;
    };
    const servico = e.servico ?? "higienizacao";
    const linhas: LinhaOrcamento[] = [];
    for (const p of e.itens ?? []) {
      const item = tabela.find((t) => t.nome.trim().toLowerCase() === p.item.trim().toLowerCase());
      if (!item) return `Item "${p.item}" não está na tabela (ensaio).`;
      const l = precificar(
        { item, quantidade: p.quantidade ?? 1, dupla_face: p.dupla_face },
        servico,
        regras,
      );
      if (l) linhas.push(l);
    }
    const base = linhas.reduce((s, l) => s + l.preco * l.quantidade, 0);
    const c = e.cupom ? conferirCupom(e.cupom, servico, cupons) : null;
    const desconto =
      c && c.ok ? { valor: valorDoCupom(c.cupom, base), rotulo: `Cupom ${c.cupom.codigo}` } : null;
    const t = totalizar(
      linhas,
      desconto,
      cfg!.parcelas_max,
      Number(cfg!.desconto_pix_percentual),
      0,
    );
    return [
      "Orçamento criado no sistema (ensaio, não gravado) — Nº 0000. Use exatamente estes valores:",
      ...linhas.map(
        (l) =>
          `• ${comDuplaFace(l.item.nome, Boolean(l.duplaFace))} — ${brl(l.preco * l.quantidade)}${l.rotulos.length ? ` (${l.rotulos.join(" + ")})` : ""}`,
      ),
      ...(t.desconto
        ? [`Subtotal: ${brl(t.bruto)}`, `${t.desconto.rotulo}: −${brl(t.desconto.valor)}`]
        : []),
      ...(c && !c.ok ? [`(Para você: ${c.texto})`] : []),
      `Total${t.desconto ? " com desconto" : ""}: ${brl(t.cond.total)}`,
      "Pagamento para o cliente (copie exatamente assim, nestas linhas):",
      linhasPagamento({
        total: t.cond.total,
        parcelas: t.cond.parcelas,
        pix: t.cond.pix,
        pixPct: t.cond.descontoPixPercentual,
      }),
      `Válido até ${validade(new Date(), cfg!.validade_orcamento_dias).texto}`,
    ].join("\n");
  }

  // Roteiro por serviço: módulos carregados valem nas respostas seguintes (como no motor).
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
        return "CEP 04101-000: Vila Mariana, São Paulo/SP. Dentro da área atendida, sem taxa de deslocamento (ensaio).";
      case "consultar_agenda":
        return "Amanhã: 8h e 14h livres. Depois de amanhã: 8h, 11h e 14h livres (ensaio).";
      case "criar_orcamento":
        return orcamentoDeEnsaio(entrada);
      case "transferir_para_humano":
        return "Transferência registrada: a equipe assume depois desta resposta.";
      default:
        return "Ok (ensaio).";
    }
  }

  const lead: ContextoLead = {
    nome: NOME,
    telefone: null,
    origem: "Google",
    campanha: null,
    servicoInteresse: "higienização",
    descricaoEstofados: null,
    resumo: null,
    etapa: null,
    clienteExistente: false,
    semPosVenda: false,
    cupomCitado: "BLOG50",
    nomeCliente: { confirmado: NOME, origem: "perfil", perfil: NOME, perguntas: 0 },
  };

  const historico: FalaEnsaio[] = [];
  const passos: PassoEnsaioPreco[] = [];
  for (const [i, fala] of FALAS_CLIENTE.entries()) {
    // A terceira mensagem só vai se a Alice ainda não mandou o orçamento.
    if (i === 2 && passos.some((p) => p.ferramentas.some((f) => f.nome === "criar_orcamento")))
      break;
    historico.push({ de: "cliente", texto: fala });
    const travado = !precoLiberado(
      historico.map((m) => ({
        direcao: m.de === "cliente" ? "Recebida" : "Enviada",
        texto: m.texto,
        tipo: "Texto",
        remetente: m.de === "cliente" ? null : "agent_bot",
        imagens: [],
      })),
    );
    try {
      const r = await rodarAliceEnsaio({
        cliente,
        modelo: cfg.modelo,
        esforco: cfg.esforco,
        ferramentas,
        fixas: [fixas, instrucoesDosModulos(empresa, carregados)].filter(Boolean).join("\n\n"),
        momento: [instrucoesDoMomento(new Date(), lead), travado ? AVISO_PRECO_TRAVADO : null]
          .filter(Boolean)
          .join("\n"),
        historico: [...historico],
        respostaDeEnsaio,
        precoTravado: travado,
      });
      passos.push({
        cliente: fala,
        travado,
        alice: r.resposta,
        retidos: r.retidos,
        ferramentas: r.ferramentas.map((u) => ({
          nome: u.nome,
          entrada: JSON.stringify(u.entrada),
        })),
      });
      historico.push({ de: "alice", texto: r.resposta.join("\n\n") || "(sem resposta)" });
    } catch (e) {
      passos.push({
        cliente: fala,
        travado,
        alice: [],
        retidos: [],
        ferramentas: [],
        erro: e instanceof Error ? e.message.slice(0, 300) : String(e),
      });
      break;
    }
  }

  const resultado: EnsaioPreco = {
    executadoEm: new Date().toISOString(),
    modelo: cfg.modelo,
    passos,
    conferencia: conferirEnsaioPreco(passos),
  };
  await db
    .from("app_settings")
    .upsert(
      { empresa_id: empresaId, key: "alice_ensaio_preco", value: resultado as never },
      { onConflict: "empresa_id,key" },
    );
  return resultado;
}
