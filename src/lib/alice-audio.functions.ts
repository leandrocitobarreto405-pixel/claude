/**
 * Configurações › Alice › "Responder em áudio": vozes Chirp 3 HD pt-BR (ouvir e escolher), limites,
 * botão Ativar e o custo de hoje/do mês. Leitura por qualquer pessoa da empresa; alterar, ativar e
 * ouvir (que gera custo) só o admin.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  requireAdminEmpresa,
  requireEmpresa,
  requireEmpresaGravavel,
} from "@/lib/empresa.middleware";
import {
  FRASE_EXEMPLO,
  VOZES_CONHECIDAS,
  custoReais,
  inicioDoDiaBrasilia,
  inicioDoMesBrasilia,
  segundosEstimados,
  vozValida,
  type Voz,
} from "@/lib/alice/voz";

export const CHAVE_AUDIO_ALICE = ["alice-audio"] as const;

export type ConfigAudioForm = {
  voz: string | null;
  max_caracteres: number;
  max_segundos: number;
  limite_diario_reais: number;
  cotacao_dolar: number;
};

export type ResumoUsoAudio = {
  hojeReais: number;
  mesReais: number;
  audiosMes: number;
  minutosMes: number;
  falhasMes: number;
  conversasMes: number;
  mediaPorConversaReais: number;
};

export type SituacaoAudioAlice = {
  ativo: boolean;
  config: ConfigAudioForm;
  uso: ResumoUsoAudio;
};

const PADRAO: ConfigAudioForm = {
  voz: null,
  max_caracteres: 350,
  max_segundos: 25,
  limite_diario_reais: 5,
  cotacao_dolar: 5.5,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export const situacaoAudioAlice = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async ({ context }): Promise<SituacaoAudioAlice> => {
    const [{ data: cfg }, { data: usos }] = await Promise.all([
      context.supabase
        .from("ia_configuracoes")
        .select(
          "audio_ativo, audio_voz, audio_max_caracteres, audio_max_segundos, audio_limite_diario_reais, audio_cotacao_dolar",
        )
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      context.supabase
        .from("ia_audios_uso")
        .select("situacao, conversa_id, segundos, custo_reais, created_at")
        .eq("empresa_id", context.empresaId)
        .gte("created_at", inicioDoMesBrasilia())
        .limit(20000),
    ]);
    const lista = usos ?? [];
    const hoje = inicioDoDiaBrasilia();
    const enviados = lista.filter((u) => u.situacao === "enviado");
    const mesReais = lista.reduce((s, u) => s + Number(u.custo_reais ?? 0), 0);
    const conversas = new Set(enviados.map((u) => u.conversa_id).filter(Boolean)).size;
    const custoConversas = lista
      .filter((u) => u.situacao !== "teste")
      .reduce((s, u) => s + Number(u.custo_reais ?? 0), 0);
    return {
      ativo: Boolean(cfg?.audio_ativo),
      config: cfg
        ? {
            voz: cfg.audio_voz,
            max_caracteres: cfg.audio_max_caracteres,
            max_segundos: cfg.audio_max_segundos,
            limite_diario_reais: Number(cfg.audio_limite_diario_reais),
            cotacao_dolar: Number(cfg.audio_cotacao_dolar),
          }
        : PADRAO,
      uso: {
        hojeReais: r2(
          lista
            .filter((u) => u.created_at >= hoje)
            .reduce((s, u) => s + Number(u.custo_reais ?? 0), 0),
        ),
        mesReais: r2(mesReais),
        audiosMes: enviados.length,
        minutosMes: Math.round(enviados.reduce((s, u) => s + Number(u.segundos ?? 0), 0) / 6) / 10,
        falhasMes: lista.filter((u) => u.situacao === "falhou").length,
        conversasMes: conversas,
        mediaPorConversaReais: conversas ? r2(custoConversas / conversas) : 0,
      },
    };
  });

/** Vozes Chirp 3 HD pt-BR da API; se a API não responder, a lista conhecida (com aviso). */
export const vozesAlice = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async (): Promise<{ vozes: Voz[]; daApi: boolean; erro: string | null }> => {
    try {
      const { listarVozes } = await import("@/lib/alice/voz.server");
      const vozes = await listarVozes();
      if (vozes.length) return { vozes, daApi: true, erro: null };
      return { vozes: VOZES_CONHECIDAS, daApi: false, erro: "A API não listou vozes Chirp 3 HD." };
    } catch (e) {
      console.warn("Alice: lista de vozes indisponível", e);
      return {
        vozes: VOZES_CONHECIDAS,
        daApi: false,
        erro: "Não foi possível ler a lista de vozes do Google agora.",
      };
    }
  });

/** Ouvir uma voz: gera a frase de exemplo (registrada como teste, com o custo). */
export const ouvirVozAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { voz: string; frase?: string }) => {
    if (!vozValida(i?.voz)) throw new Error("Voz inválida.");
    const frase = String(i.frase ?? "").trim() || FRASE_EXEMPLO;
    if (frase.length > 300) throw new Error("Frase de exemplo: até 300 caracteres.");
    return { voz: i.voz, frase };
  })
  .handler(async ({ data, context }): Promise<{ base64: string }> => {
    const { sintetizar } = await import("@/lib/alice/voz.server");
    const r = await sintetizar(data.frase, data.voz, 15_000);
    const { data: cfg } = await context.supabase
      .from("ia_configuracoes")
      .select("audio_cotacao_dolar")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ok = "bytes" in r;
    await supabaseAdmin.from("ia_audios_uso").insert({
      empresa_id: context.empresaId,
      voz: data.voz,
      situacao: ok ? "teste" : "falhou",
      caracteres: data.frase.length,
      segundos: ok ? segundosEstimados(data.frase.length) : null,
      custo_reais: ok ? custoReais(data.frase.length, Number(cfg?.audio_cotacao_dolar ?? 5.5)) : 0,
      texto_falado: data.frase,
      erro: ok ? null : r.erro.slice(0, 500),
    });
    if (!ok) {
      console.warn("Alice: teste de voz falhou", r.erro);
      throw new Error(
        r.erro.includes("403")
          ? "O Google recusou (sem permissão para a API de voz). Confira a ativação da API texttospeech."
          : "Não foi possível gerar o áudio agora. Tente de novo.",
      );
    }
    return { base64: Buffer.from(r.bytes).toString("base64") };
  });

const faixa = (v: unknown, min: number, max: number, nome: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`${nome}: use de ${min} a ${max}.`);
  return n;
};

export const salvarAudioAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: ConfigAudioForm) => {
    if (i.voz !== null && !vozValida(i.voz)) throw new Error("Voz inválida.");
    return {
      voz: i.voz,
      max_caracteres: Math.round(faixa(i.max_caracteres, 50, 1500, "Máximo de caracteres")),
      max_segundos: Math.round(faixa(i.max_segundos, 5, 120, "Máximo de segundos")),
      limite_diario_reais: r2(faixa(i.limite_diario_reais, 0, 1000, "Limite diário (R$)")),
      cotacao_dolar: r2(faixa(i.cotacao_dolar, 1, 20, "Cotação do dólar")),
    };
  })
  .handler(async ({ data, context }) => {
    const { data: atual } = await context.supabase
      .from("ia_configuracoes")
      .select("audio_ativo")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!atual) throw new Error("Configure a Alice antes (salve a configuração dela).");
    if (atual.audio_ativo && !data.voz)
      throw new Error("Desative o áudio antes de tirar a voz escolhida.");
    const { error } = await context.supabase
      .from("ia_configuracoes")
      .update({
        audio_voz: data.voz,
        audio_max_caracteres: data.max_caracteres,
        audio_max_segundos: data.max_segundos,
        audio_limite_diario_reais: data.limite_diario_reais,
        audio_cotacao_dolar: data.cotacao_dolar,
      })
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível salvar a resposta em áudio.");
    return { ok: true };
  });

export const ativarAudioAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator((i: { ativo: boolean }) => ({ ativo: i?.ativo === true }))
  .handler(async ({ data, context }) => {
    const { data: atual } = await context.supabase
      .from("ia_configuracoes")
      .select("audio_voz")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (data.ativo && !vozValida(atual?.audio_voz))
      throw new Error("Escolha e salve a voz antes de ativar.");
    const { error } = await context.supabase
      .from("ia_configuracoes")
      .update({ audio_ativo: data.ativo })
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível mudar a resposta em áudio.");
    return { ok: true };
  });

// ---------------------------------------------------------------- teste de envio (só equipe)

export type ContatoTeste = { id: string; nome: string; final: string; temConversa: boolean };

/** Conversa mais recente do contato interno no Chatwoot (pelo telefone). */
async function conversaDoContato(empresaId: string, telefone: string) {
  const { chaveTelefone } = await import("@/lib/avisos");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const chave = chaveTelefone(telefone);
  if (!chave) return null;
  const { data: contatos } = await db
    .from("whatsapp_contacts")
    .select("id, normalized_phone")
    .eq("empresa_id", empresaId)
    .like("normalized_phone", `%${chave.slice(-8)}`)
    .limit(20);
  const ids = (contatos ?? [])
    .filter((c) => chaveTelefone(c.normalized_phone) === chave)
    .map((c) => c.id);
  if (!ids.length) return null;
  const { data: conversa } = await db
    .from("conversas")
    .select("id, chatwoot_conversation_id, conexao_id")
    .eq("empresa_id", empresaId)
    .in("whatsapp_contact_id", ids)
    .order("ultima_atividade_em", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return conversa;
}

/** Contatos internos (equipe) para o teste de envio: nome e os 4 últimos dígitos. */
export const contatosTesteAudio = createServerFn({ method: "GET" })
  .middleware([requireAdminEmpresa])
  .handler(async ({ context }): Promise<ContatoTeste[]> => {
    const { data } = await context.supabase
      .from("contatos_internos")
      .select("id, nome, telefone")
      .eq("empresa_id", context.empresaId)
      .order("nome");
    return Promise.all(
      (data ?? []).map(async (c) => ({
        id: c.id,
        nome: c.nome?.trim() || "Contato da equipe",
        final: c.telefone.replace(/\D/g, "").slice(-4),
        temConversa: Boolean(await conversaDoContato(context.empresaId, c.telefone)),
      })),
    );
  });

/**
 * Teste de envio: a frase de exemplo, na voz salva, para a conversa de um contato interno (equipe),
 * pelo mesmo caminho das respostas (anexo .ogg + nota privada). Nunca vai para cliente.
 */
export const enviarTesteAudioAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, requireEmpresaGravavel])
  .inputValidator((i: { contatoId: string; frase?: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(i?.contatoId ?? ""))) throw new Error("Contato inválido.");
    const frase = String(i.frase ?? "").trim() || FRASE_EXEMPLO;
    if (frase.length > 300) throw new Error("Frase de exemplo: até 300 caracteres.");
    return { contatoId: i.contatoId, frase };
  })
  .handler(async ({ data, context }) => {
    const { data: contato } = await context.supabase
      .from("contatos_internos")
      .select("telefone")
      .eq("id", data.contatoId)
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!contato) throw new Error("O teste só vai para contatos internos da equipe.");
    const { data: cfg } = await context.supabase
      .from("ia_configuracoes")
      .select("audio_voz, audio_cotacao_dolar")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    if (!vozValida(cfg?.audio_voz)) throw new Error("Escolha e salve a voz antes do teste.");
    const conversa = await conversaDoContato(context.empresaId, contato.telefone);
    if (!conversa)
      throw new Error(
        "Este número ainda não tem conversa no WhatsApp da empresa. Mande um “oi” dele para o número da empresa e tente de novo.",
      );
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const [{ data: cx }, { data: sg }] = await Promise.all([
      db
        .from("chatwoot_conexoes")
        .select("base_url, account_id")
        .eq("id", conversa.conexao_id)
        .maybeSingle(),
      db
        .from("chatwoot_conexao_segredos")
        .select("alice_bot_token, api_token")
        .eq("conexao_id", conversa.conexao_id)
        .maybeSingle(),
    ]);
    const token = sg?.alice_bot_token ?? sg?.api_token;
    if (!cx || !token) throw new Error("Chatwoot da empresa não configurado.");
    const conta = { baseUrl: cx.base_url, accountId: Number(cx.account_id) };

    const { sintetizar } = await import("@/lib/alice/voz.server");
    const { duracaoOggOpus } = await import("@/lib/alice/ogg-opus");
    const { enviarAnexo, enviarMensagem } = await import("@/lib/alice/chatwoot-api.server");
    const r = await sintetizar(data.frase, cfg!.audio_voz!, 15_000);
    const registro = {
      empresa_id: context.empresaId,
      conversa_id: conversa.id,
      voz: cfg!.audio_voz!,
      caracteres: data.frase.length,
      texto_falado: data.frase,
    };
    if (!("bytes" in r)) {
      await db.from("ia_audios_uso").insert({ ...registro, situacao: "falhou", erro: r.erro });
      throw new Error("Não foi possível gerar o áudio agora. Tente de novo.");
    }
    const custo = custoReais(data.frase.length, Number(cfg?.audio_cotacao_dolar ?? 5.5));
    const segundos = duracaoOggOpus(r.bytes) ?? segundosEstimados(data.frase.length);
    try {
      const msg = await enviarAnexo(
        conta,
        token,
        conversa.chatwoot_conversation_id,
        new Blob([new Uint8Array(r.bytes)], { type: "audio/ogg" }),
        "audio.ogg",
        "",
        true,
      );
      await enviarMensagem(
        conta,
        token,
        conversa.chatwoot_conversation_id,
        `🔊 Áudio de teste da Alice: ${data.frase}`,
        true,
      ).catch(() => undefined);
      await db.from("ia_audios_uso").insert({
        ...registro,
        situacao: "teste",
        chatwoot_message_id: msg.id ?? null,
        segundos,
        custo_reais: custo,
      });
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await db.from("ia_audios_uso").insert({
        ...registro,
        situacao: "falhou",
        segundos,
        custo_reais: custo,
        erro: `envio pelo Chatwoot: ${erro}`.slice(0, 500),
      });
      console.warn("Alice: teste de áudio não enviado", erro);
      throw new Error(
        "O Chatwoot não aceitou o áudio. Se o número não escreveu nas últimas 24 h, mande um “oi” dele e tente de novo.",
      );
    }
    return { ok: true };
  });
