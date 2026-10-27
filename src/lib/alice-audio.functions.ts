/**
 * Configurações › Alice › "Responder em áudio": provedor (Google ou ElevenLabs), vozes (ouvir e
 * escolher), limites, botão Ativar e o custo de hoje/do mês. Leitura por qualquer pessoa da
 * empresa; alterar, ativar e ouvir (que gera custo) só o admin. O padrão é o Google.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  requireAdminEmpresa,
  requireEmpresa,
  requireEmpresaGravavel,
} from "@/lib/empresa.middleware";
import {
  FRASE_EXEMPLO,
  MAX_CARACTERES_EXPLICACAO,
  MODELOS_ELEVEN,
  USD_POR_MIL_CREDITOS_PADRAO,
  creditosEleven,
  paraFala,
  VOZES_CONHECIDAS,
  custoElevenReais,
  custoReais,
  modeloEleven,
  vozElevenValida,
  type ModeloEleven,
  type Provedor,
  inicioDoDiaBrasilia,
  inicioDoMesBrasilia,
  segundosEstimados,
  vozValida,
  type Voz,
} from "@/lib/alice/voz";
import { requireRecurso } from "@/lib/recurso.middleware";

/** alice: recurso do plano (Essencial não tem). */
const comRecurso = requireRecurso("alice");

export const CHAVE_AUDIO_ALICE = ["alice-audio"] as const;

export type ConfigAudioForm = {
  provedor: Provedor;
  /** Voz do Google (também é a reserva quando a ElevenLabs recusa). */
  voz: string | null;
  eleven_voz: string | null;
  eleven_modelo: ModeloEleven;
  max_caracteres: number;
  max_segundos: number;
  limite_diario_reais: number;
  /** Teto diário em créditos da ElevenLabs (0 = sem teto em créditos). */
  limite_diario_creditos: number;
  cotacao_dolar: number;
};

export type ResumoUsoAudio = {
  hojeReais: number;
  /** Créditos da ElevenLabs usados hoje e no mês. */
  hojeCreditos: number;
  mesCreditos: number;
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
  /** Chave da ElevenLabs no servidor e preço por mil créditos (plano da conta da Nexa). */
  eleven: { configurada: boolean; usdPorMilCreditos: number };
};

/** US$ por mil créditos da ElevenLabs (Painel Nexa; padrão do plano Creator). */
async function usdPorMilCreditos(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("configuracoes_plataforma")
    .select("valor")
    .eq("chave", "elevenlabs_usd_por_mil_creditos")
    .maybeSingle();
  const n = Number(data?.valor);
  return Number.isFinite(n) && n > 0 ? n : USD_POR_MIL_CREDITOS_PADRAO;
}

const PADRAO: ConfigAudioForm = {
  provedor: "google",
  voz: null,
  eleven_voz: null,
  eleven_modelo: "eleven_flash_v2_5",
  max_caracteres: 350,
  max_segundos: 25,
  limite_diario_reais: 5,
  limite_diario_creditos: 0,
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
          "audio_ativo, audio_voz, audio_max_caracteres, audio_max_segundos, audio_limite_diario_reais, audio_limite_diario_creditos, audio_cotacao_dolar, audio_provedor, audio_eleven_voz, audio_eleven_modelo",
        )
        .eq("empresa_id", context.empresaId)
        .maybeSingle(),
      context.supabase
        .from("ia_audios_uso")
        .select("situacao, conversa_id, segundos, custo_reais, creditos, created_at")
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
            provedor: cfg.audio_provedor === "elevenlabs" ? "elevenlabs" : "google",
            voz: cfg.audio_voz,
            eleven_voz: cfg.audio_eleven_voz,
            eleven_modelo: modeloEleven(cfg.audio_eleven_modelo),
            max_caracteres: cfg.audio_max_caracteres,
            max_segundos: cfg.audio_max_segundos,
            limite_diario_reais: Number(cfg.audio_limite_diario_reais),
            limite_diario_creditos: Number(cfg.audio_limite_diario_creditos ?? 0),
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
        hojeCreditos: Math.round(
          lista
            .filter((u) => u.created_at >= hoje)
            .reduce((s, u) => s + Number(u.creditos ?? 0), 0),
        ),
        mesCreditos: Math.round(lista.reduce((s, u) => s + Number(u.creditos ?? 0), 0)),
        audiosMes: enviados.length,
        minutosMes: Math.round(enviados.reduce((s, u) => s + Number(u.segundos ?? 0), 0) / 6) / 10,
        falhasMes: lista.filter((u) => u.situacao === "falhou").length,
        conversasMes: conversas,
        mediaPorConversaReais: conversas ? r2(custoConversas / conversas) : 0,
      },
      eleven: {
        configurada: Boolean(process.env["ELEVENLABS_API_KEY"]),
        usdPorMilCreditos: await usdPorMilCreditos(),
      },
    };
  });

/** Vozes da conta da ElevenLabs em português do Brasil (com a prévia gratuita para ouvir). */
export const vozesElevenAlice = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(
    async (): Promise<{
      vozes: Array<{ id: string; nome: string; descricao: string; previa: string | null }>;
      erro: string | null;
    }> => {
      const { elevenConfigurada, listarVozesEleven } = await import("@/lib/alice/eleven.server");
      if (!elevenConfigurada())
        return { vozes: [], erro: "A chave da ElevenLabs ainda não está no servidor." };
      try {
        return { vozes: await listarVozesEleven(), erro: null };
      } catch (e) {
        console.warn(
          "Alice: vozes da ElevenLabs indisponíveis",
          e instanceof Error ? e.message : e,
        );
        return { vozes: [], erro: "Não foi possível ler as vozes da ElevenLabs agora." };
      }
    },
  );

/** Ouvir uma voz da ElevenLabs com a frase de exemplo (gera custo; registrado como teste). */
export const ouvirVozElevenAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comRecurso])
  .inputValidator((i: { voz: string; modelo: string; frase?: string }) => {
    if (!vozElevenValida(i?.voz)) throw new Error("Voz inválida.");
    if (!(MODELOS_ELEVEN as readonly string[]).includes(i.modelo))
      throw new Error("Modelo inválido.");
    // O mesmo preparo do áudio de verdade (valores, horários e abreviações por extenso).
    const frase = paraFala(String(i.frase ?? "").trim() || FRASE_EXEMPLO);
    if (frase.length > MAX_CARACTERES_EXPLICACAO)
      throw new Error(`Frase de exemplo: até ${MAX_CARACTERES_EXPLICACAO} caracteres.`);
    return { voz: i.voz, modelo: i.modelo as ModeloEleven, frase };
  })
  .handler(async ({ data, context }): Promise<{ base64: string; tipo: string }> => {
    const { sintetizarEleven } = await import("@/lib/alice/eleven.server");
    const r = await sintetizarEleven(data.frase, data.voz, data.modelo, 15_000);
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
      provedor: "elevenlabs",
      modelo: data.modelo,
      situacao: ok ? "teste" : "falhou",
      caracteres: data.frase.length,
      creditos: ok ? creditosEleven(data.frase.length, data.modelo) : 0,
      segundos: ok ? segundosEstimados(data.frase.length) : null,
      custo_reais: ok
        ? custoElevenReais(
            data.frase.length,
            data.modelo,
            await usdPorMilCreditos(),
            Number(cfg?.audio_cotacao_dolar ?? 5.5),
          )
        : 0,
      texto_falado: data.frase,
      erro: ok ? null : r.erro.slice(0, 500),
    });
    if (!ok) {
      console.warn("Alice: teste de voz da ElevenLabs falhou", r.erro);
      throw new Error(
        r.erro.includes("(429)")
          ? "A ElevenLabs recusou por muitos pedidos seguidos (ou limite do plano). Espere um pouco e tente de novo."
          : "Não foi possível gerar o áudio na ElevenLabs agora. Tente de novo.",
      );
    }
    return { base64: Buffer.from(r.bytes).toString("base64"), tipo: "audio/mpeg" };
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
  .middleware([requireAdminEmpresa, comRecurso])
  .inputValidator((i: { voz: string; frase?: string }) => {
    if (!vozValida(i?.voz)) throw new Error("Voz inválida.");
    const frase = String(i.frase ?? "").trim() || FRASE_EXEMPLO;
    if (frase.length > MAX_CARACTERES_EXPLICACAO)
      throw new Error(`Frase de exemplo: até ${MAX_CARACTERES_EXPLICACAO} caracteres.`);
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
  .middleware([requireAdminEmpresa, comRecurso])
  .inputValidator((i: ConfigAudioForm) => {
    if (i.voz !== null && !vozValida(i.voz)) throw new Error("Voz inválida.");
    if (i.eleven_voz !== null && !vozElevenValida(i.eleven_voz))
      throw new Error("Voz da ElevenLabs inválida.");
    if (i.provedor === "elevenlabs" && !i.eleven_voz)
      throw new Error("Escolha a voz da ElevenLabs antes de trocar o provedor.");
    return {
      provedor: (i.provedor === "elevenlabs" ? "elevenlabs" : "google") as Provedor,
      voz: i.voz,
      eleven_voz: i.eleven_voz,
      eleven_modelo: modeloEleven(i.eleven_modelo),
      max_caracteres: Math.round(faixa(i.max_caracteres, 50, 1500, "Máximo de caracteres")),
      max_segundos: Math.round(faixa(i.max_segundos, 5, 120, "Máximo de segundos")),
      limite_diario_reais: r2(faixa(i.limite_diario_reais, 0, 1000, "Limite diário (R$)")),
      limite_diario_creditos: Math.round(
        faixa(i.limite_diario_creditos ?? 0, 0, 1_000_000, "Teto diário (créditos)"),
      ),
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
    if (atual.audio_ativo && !(data.provedor === "elevenlabs" ? data.eleven_voz : data.voz))
      throw new Error("Desative o áudio antes de tirar a voz escolhida.");
    const { error } = await context.supabase
      .from("ia_configuracoes")
      .update({
        audio_provedor: data.provedor,
        audio_voz: data.voz,
        audio_eleven_voz: data.eleven_voz,
        audio_eleven_modelo: data.eleven_modelo,
        audio_max_caracteres: data.max_caracteres,
        audio_max_segundos: data.max_segundos,
        audio_limite_diario_reais: data.limite_diario_reais,
        audio_limite_diario_creditos: data.limite_diario_creditos || null,
        audio_cotacao_dolar: data.cotacao_dolar,
      })
      .eq("empresa_id", context.empresaId);
    if (error) throw new Error("Não foi possível salvar a resposta em áudio.");
    return { ok: true };
  });

export const ativarAudioAlice = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa, comRecurso])
  .inputValidator((i: { ativo: boolean }) => ({ ativo: i?.ativo === true }))
  .handler(async ({ data, context }) => {
    const { data: atual } = await context.supabase
      .from("ia_configuracoes")
      .select("audio_voz, audio_provedor, audio_eleven_voz")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    const pronta =
      atual?.audio_provedor === "elevenlabs"
        ? vozElevenValida(atual.audio_eleven_voz)
        : vozValida(atual?.audio_voz);
    if (data.ativo && !pronta) throw new Error("Escolha e salve a voz antes de ativar.");
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
  .middleware([requireAdminEmpresa, comRecurso])
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
  .middleware([requireAdminEmpresa, requireEmpresaGravavel, comRecurso])
  .inputValidator((i: { contatoId: string; frase?: string; provedor?: Provedor }) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(i?.contatoId ?? ""))) throw new Error("Contato inválido.");
    const frase = String(i.frase ?? "").trim() || FRASE_EXEMPLO;
    if (frase.length > MAX_CARACTERES_EXPLICACAO)
      throw new Error(`Frase de exemplo: até ${MAX_CARACTERES_EXPLICACAO} caracteres.`);
    const provedor: Provedor = i.provedor === "elevenlabs" ? "elevenlabs" : "google";
    return { contatoId: i.contatoId, frase, provedor };
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
      .select("audio_voz, audio_cotacao_dolar, audio_eleven_voz, audio_eleven_modelo")
      .eq("empresa_id", context.empresaId)
      .maybeSingle();
    const eleven = data.provedor === "elevenlabs";
    if (eleven ? !vozElevenValida(cfg?.audio_eleven_voz) : !vozValida(cfg?.audio_voz))
      throw new Error("Escolha e salve a voz antes do teste.");
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
    const { sintetizarEleven } = await import("@/lib/alice/eleven.server");
    const { duracaoOggOpus } = await import("@/lib/alice/ogg-opus");
    const { paraOggOpus } = await import("@/lib/audio-voz.server");
    const { enviarAnexo, enviarMensagem } = await import("@/lib/alice/chatwoot-api.server");
    const modelo = modeloEleven(cfg?.audio_eleven_modelo);
    const voz = eleven ? cfg!.audio_eleven_voz! : cfg!.audio_voz!;
    const gerado = eleven
      ? await sintetizarEleven(data.frase, voz, modelo, 15_000)
      : await sintetizar(data.frase, voz, 15_000);
    const registro = {
      empresa_id: context.empresaId,
      conversa_id: conversa.id,
      voz,
      provedor: data.provedor,
      modelo: eleven ? modelo : null,
      caracteres: data.frase.length,
      texto_falado: data.frase,
    };
    if (!("bytes" in gerado)) {
      await db.from("ia_audios_uso").insert({ ...registro, situacao: "falhou", erro: gerado.erro });
      throw new Error(
        eleven && gerado.erro.includes("(429)")
          ? "A ElevenLabs recusou por muitos pedidos seguidos (ou limite do plano). Espere um pouco e tente de novo."
          : "Não foi possível gerar o áudio agora. Tente de novo.",
      );
    }
    // ElevenLabs devolve MP3: vira mensagem de voz OGG/Opus mono, como a barra de resposta.
    const r = eleven ? { bytes: await paraOggOpus(gerado.bytes) } : gerado;
    const cotacao = Number(cfg?.audio_cotacao_dolar ?? 5.5);
    const custo = eleven
      ? custoElevenReais(data.frase.length, modelo, await usdPorMilCreditos(), cotacao)
      : custoReais(data.frase.length, cotacao);
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
        `🔊 Áudio de teste da Alice (${eleven ? "ElevenLabs" : "Google"}): ${data.frase}`,
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
