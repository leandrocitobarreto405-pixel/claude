// Servidores falsos para o teste da Alice: "Claude" (API de mensagens) e "Chatwoot" (API da conta),
// que também faz o papel do Google (metadados da conta de serviço e Speech-to-Text).
// Cada um guarda as requisições recebidas; GET /__log devolve a lista.
import http from "node:http";

const PORTA_CLAUDE = Number(process.env.PORTA_CLAUDE ?? 3995);
const PORTA_CHATWOOT = Number(process.env.PORTA_CHATWOOT ?? 3994);

function servidor(porta, tratar) {
  const log = [];
  http
    .createServer(async (req, res) => {
      const partes = [];
      for await (const parte of req) partes.push(parte);
      const bruto = Buffer.concat(partes);
      if (req.method === "GET" && req.url === "/__log") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(log));
      }
      let json = null;
      const tipo = String(req.headers["content-type"] ?? "");
      if (tipo.includes("application/json") && bruto.length) {
        try {
          json = JSON.parse(bruto.toString("utf8"));
        } catch {
          /* corpo não-JSON */
        }
      }
      log.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: json,
        // Multipart (anexo): guarda o texto para achar nome do arquivo e campos.
        multipart: tipo.startsWith("multipart/") ? bruto.toString("latin1") : null,
        // Notificação no celular (corpo cifrado): guarda os bytes para o teste abrir.
        bruto64: tipo === "application/octet-stream" ? bruto.toString("base64") : null,
      });
      const r = tratar(req, json);
      res.writeHead(r.status ?? 200, { "Content-Type": r.tipo ?? "application/json" });
      res.end(r.bruto ?? JSON.stringify(r.corpo ?? {}));
    })
    .listen(porta, "127.0.0.1");
}

// ---------------------------------------------------------------- Claude
function ultimoUsuario(msgs) {
  const ultimo = [...msgs].reverse().find((m) => m.role === "user");
  return Array.isArray(ultimo?.content)
    ? ultimo.content
    : [{ type: "text", text: ultimo?.content ?? "" }];
}
function resposta(content, stop_reason) {
  return {
    corpo: {
      id: `msg_${Math.random().toString(36).slice(2)}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content,
      stop_reason,
      stop_sequence: null,
      usage: {
        input_tokens: 1200,
        output_tokens: 80,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 0,
      },
    },
  };
}
const texto = (t) => ({ type: "text", text: t });
const ferramenta = (id, name, input) => ({ type: "tool_use", id, name, input });

servidor(PORTA_CLAUDE, (req, body) => {
  if (!req.url.startsWith("/v1/messages")) return { status: 404, corpo: { error: "not found" } };
  const blocos = ultimoUsuario(body.messages);
  const resultados = blocos.filter((b) => b.type === "tool_result");
  const tudo = JSON.stringify(body.messages);

  // Rodadas seguintes: reage ao resultado da ferramenta.
  if (resultados.length) {
    const conteudo = resultados.map((r) => String(r.content)).join("\n");
    if (conteudo.includes("Orçamento criado")) {
      const total = /Total: (R\$\s?[\d.,]+)/.exec(conteudo)?.[1] ?? "?";
      const pix = /Pix \(5% off\): (R\$\s?[\d.,]+)/.exec(conteudo)?.[1] ?? "?";
      return resposta(
        [
          ferramenta("toolu_orcmsg", "enviar_mensagem", {
            texto: `*Higienização Premium*\n✔️ Higienização profunda\n\nTotal: ${total} ou ${pix} no Pix`,
          }),
          ferramenta("toolu_follow", "agendar_followup", {
            em_minutos: 10,
            trilha: "A",
            motivo: "sem resposta ao orçamento",
            mensagem_sugerida: "Conseguiu dar uma olhadinha no orçamento?",
          }),
        ],
        "tool_use",
      );
    }
    if (conteudo.includes("Follow-up agendado")) {
      return resposta(
        [texto("Prontinho! Te enviei a proposta!\nEla faz sentido pra você?")],
        "end_turn",
      );
    }
    if (tudo.includes("transferir_para_humano")) {
      return resposta(
        [texto("Claro! Vou chamar uma especialista da equipe, só um instante.")],
        "end_turn",
      );
    }
    return resposta(
      [
        texto(
          "Oi! Sou a Alice IA da Turbine Clean 😊\n\nA higienização do **sofá de 3 lugares** sai por R$ 180,00. Qual o seu bairro?",
        ),
      ],
      "end_turn",
    );
  }

  const pedido = JSON.stringify(blocos);
  if (pedido.includes("Hora do follow-up")) {
    return resposta([texto("Conseguiu dar uma olhadinha no orçamento, Cliente?")], "end_turn");
  }
  if (pedido.includes("pessoa")) {
    return resposta(
      [
        ferramenta("toolu_passar", "transferir_para_humano", {
          motivo: "cliente pediu uma pessoa",
          resumo: "Quer falar com atendente.",
        }),
      ],
      "tool_use",
    );
  }
  if (pedido.includes("ficou manchado")) {
    return resposta(
      [
        texto("Poxa, sinto muito! Já estou chamando a equipe para resolver com prioridade."),
        ferramenta("toolu_pv_cli", "consultar_cliente", {}),
        ferramenta("toolu_pv", "transferir_para_humano", {
          motivo: "reclamou do resultado",
          resumo: "Cliente disse que o sofá ficou manchado depois do serviço.",
          problema_pos_venda: true,
        }),
      ],
      "tool_use",
    );
  }
  if (pedido.includes("condição da campanha")) {
    return resposta(
      [
        ferramenta("toolu_cli", "consultar_cliente", {}),
        ferramenta("toolu_orc_camp", "criar_orcamento", {
          servico: "higienizacao",
          itens: [{ item: "Sofá 3 lugares", quantidade: 1 }],
          desconto: "campanha",
        }),
        ferramenta("toolu_ind", "registrar_indicacao", {
          nome: "Paula",
          telefone: "(11) 95555-7777",
        }),
      ],
      "tool_use",
    );
  }
  if (pedido.includes("orçamento do sofá")) {
    return resposta(
      [
        ferramenta("toolu_msg", "enviar_mensagem", {
          texto: "Enquanto eu preparo seu orçamento, vou te mandar um vídeo curtinho, tá bom?",
        }),
        ferramenta("toolu_video", "enviar_video", { servico: "higienizacao" }),
        ferramenta("toolu_orc", "criar_orcamento", {
          servico: "higienizacao",
          itens: [{ item: "sofa 3 LUGARES", quantidade: 1 }],
        }),
      ],
      "tool_use",
    );
  }
  if (pedido.includes("transcrição automática")) {
    return resposta([texto("Entendi pelo seu áudio! Me manda uma foto do sofá?")], "end_turn");
  }
  return resposta(
    [
      ferramenta("toolu_lead", "atualizar_lead", {
        descricao_estofados: "Sofá 3 lugares com mancha",
        servico_interesse: "Higienização",
      }),
    ],
    "tool_use",
  );
});

// ---------------------------------------------------------------- Chatwoot (+ Google)
// JPEG mínimo (1x1).
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z",
  "base64",
);
let idMensagem = 7000;
// Google Sheets falso (exportação das conversões): uma planilha em memória por ID.
const planilhas = new Map();
// Marketing: contatos, conversas, modelos da caixa 4242 e etiquetas (em memória).
// POST /__modelos troca a lista de modelos. Telefone terminado em 0999: o envio falha (131026).
const mktModelos = {
  lista: [
    {
      name: "tc_oferta_trimestral",
      language: "pt_BR",
      status: "APPROVED",
      category: "MARKETING",
      components: [
        { type: "BODY", text: "Oi, {{1}}! {{2}} nesta semana." },
        {
          type: "BUTTONS",
          buttons: [{ text: "Quero ver as datas" }, { text: "Não quero mais ofertas" }],
        },
      ],
    },
    {
      name: "tc_oferta_trimestral_sn",
      language: "pt_BR",
      status: "APPROVED",
      category: "MARKETING",
      components: [{ type: "BODY", text: "Oi! {{1}} nesta semana." }],
    },
    {
      name: "tc_orcamento_retomada",
      language: "pt_BR",
      status: "APPROVED",
      category: "MARKETING",
      components: [{ type: "BODY", text: "Oi, {{1}}! Ainda quer aquele orçamento? {{2}}." }],
    },
    {
      name: "tc_orcamento_retomada_sn",
      language: "pt_BR",
      status: "APPROVED",
      category: "MARKETING",
      components: [{ type: "BODY", text: "Oi! Ainda quer aquele orçamento? {{1}}." }],
    },
    {
      name: "tc_sazonal_nov",
      language: "pt_BR",
      status: "PENDING",
      category: "MARKETING",
      components: [{ type: "BODY", text: "Black Friday: {{2}}" }],
    },
    {
      name: "tc_posvenda_resultado",
      language: "pt_BR",
      status: "APPROVED",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Oi, {{1}}! Aqui é a Alice, da Turbine Clean. Como ficou o seu estofado depois do serviço?",
        },
      ],
    },
    {
      name: "tc_posvenda_resultado_sn",
      language: "pt_BR",
      status: "APPROVED",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Oi! Aqui é a Alice, da Turbine Clean. Como ficou o seu estofado depois do serviço?",
        },
      ],
    },
    {
      name: "tc_promocao_agenda",
      language: "pt_BR",
      status: "APPROVED",
      category: "MARKETING",
      components: [
        {
          type: "BODY",
          text: "Oi, {{1}}! Aqui é da Turbine Clean. Abriu um horário amanhã e consigo fazer o seu serviço com {{2}} de desconto, e mais {{3}} se pagar no Pix. Quer que eu reserve para você?",
        },
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Quero reservar" },
            { type: "QUICK_REPLY", text: "Não quero mais ofertas" },
          ],
        },
      ],
    },
    {
      name: "nexa_aviso",
      language: "pt_BR",
      status: "APPROVED",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Aviso do Nexa: {{1}}" }],
    },
  ],
};
const mktContatos = [];
const mktConversas = [];
const mktEtiquetas = new Map();
let mktId = 900;
const digitos = (t) => String(t ?? "").replace(/\D/g, "");
function chatwootMarketing(req, body) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/^\/api\/v1\/accounts\/\d+/, "");
  const token = req.headers["api_access_token"];
  if (p === "/__modelos" && req.method === "POST") {
    mktModelos.lista = body;
    return { corpo: {} };
  }
  if (p === "/inboxes/4242" && req.method === "GET") {
    if (token !== "token-admin") return { status: 401, corpo: { error: "admin" } };
    return {
      corpo: { id: 4242, channel_type: "Channel::Whatsapp", message_templates: mktModelos.lista },
    };
  }
  if (p === "/contacts/search") {
    if (token !== "token-admin") return { status: 401, corpo: { error: "admin" } };
    const q = digitos(url.searchParams.get("q"));
    return { corpo: { payload: mktContatos.filter((c) => digitos(c.phone_number).endsWith(q)) } };
  }
  if (p === "/contacts" && req.method === "POST") {
    if (token !== "token-admin") return { status: 401, corpo: { error: "admin" } };
    const c = {
      id: ++mktId,
      name: body.name ?? null,
      phone_number: body.phone_number,
      contact_inboxes: [{ source_id: digitos(body.phone_number), inbox: { id: body.inbox_id } }],
    };
    mktContatos.push(c);
    return { corpo: { payload: { contact: c, contact_inbox: c.contact_inboxes[0] } } };
  }
  let m = /^\/contacts\/(\d+)(\/conversations|\/contact_inboxes|\/labels)?$/.exec(p);
  if (m) {
    if (token !== "token-admin") return { status: 401, corpo: { error: "admin" } };
    const c = mktContatos.find((x) => x.id === Number(m[1]));
    if (!m[2]) return c ? { corpo: { payload: c } } : { status: 404, corpo: {} };
    if (m[2] === "/conversations")
      return { corpo: { payload: mktConversas.filter((v) => v.contact_id === Number(m[1])) } };
    if (m[2] === "/contact_inboxes") {
      c?.contact_inboxes.push({ source_id: body.source_id, inbox: { id: body.inbox_id } });
      return { corpo: { source_id: body.source_id } };
    }
    const chave = `contato:${m[1]}`;
    if (req.method === "POST") mktEtiquetas.set(chave, body.labels);
    return { corpo: { payload: mktEtiquetas.get(chave) ?? ["cliente", "camp-2026-01-l1"] } };
  }
  if (p === "/conversations" && req.method === "POST") {
    if (token !== "token-robo") return { status: 401, corpo: { error: "robo" } };
    const v = {
      id: ++mktId,
      inbox_id: body.inbox_id,
      contact_id: body.contact_id,
      status: body.status,
      last_activity_at: Date.now(),
    };
    mktConversas.push(v);
    return { corpo: v };
  }
  m = /^\/conversations\/(\d+)\/(labels|toggle_priority|messages)$/.exec(p);
  if (m && m[2] === "labels") {
    const chave = `conversa:${m[1]}`;
    if (req.method === "POST") mktEtiquetas.set(chave, body.labels);
    return { corpo: { payload: mktEtiquetas.get(chave) ?? ["lead", "camp-2025-12-l1"] } };
  }
  if (m && m[2] === "messages" && body?.template_params) {
    if (token !== "token-robo") return { status: 401, corpo: { error: "robo" } };
    const v = mktConversas.find((x) => x.id === Number(m[1]));
    const c = v && mktContatos.find((x) => x.id === v.contact_id);
    if (c && digitos(c.phone_number).endsWith("0999"))
      return { status: 422, corpo: { error: "(#131026) Message undeliverable" } };
    return { corpo: { id: ++idMensagem } };
  }
  return null;
}

servidor(PORTA_CHATWOOT, (req, body) => {
  // Serviço de push falso: /push/velho = celular que cancelou (410).
  if (req.url.startsWith("/push/")) return { status: req.url === "/push/velho" ? 410 : 201 };
  if (req.url === "/oauth/token")
    return { corpo: { access_token: "token-oauth-empresa", expires_in: 3600 } };
  const sh = /^\/v4\/spreadsheets\/([^/?]+)(\/values\/([^?:]+))?(:clear)?/.exec(req.url);
  if (sh) {
    if (req.headers.authorization !== "Bearer token-oauth-empresa")
      return { status: 401, corpo: { error: "sem token" } };
    const id = decodeURIComponent(sh[1]);
    if (id === "planilha-sem-acesso-0000000000")
      return { status: 403, corpo: { error: "forbidden" } };
    if (!sh[2]) return { corpo: { sheets: [{ properties: { title: "Página1" } }] } };
    if (sh[4]) {
      planilhas.set(id, []);
      return { corpo: {} };
    }
    if (req.method === "PUT") {
      planilhas.set(id, body.values);
      return { corpo: { updatedRows: body.values.length } };
    }
    return { corpo: { values: planilhas.get(id) ?? [] } };
  }
  if (req.method === "GET" && req.url === "/foto-sofa.jpg")
    return { tipo: "image/jpeg", bruto: JPEG };
  if (req.method === "GET" && req.url === "/audio-cliente.ogg")
    return { tipo: "audio/ogg", bruto: Buffer.from("OggS-audio-falso") };
  if (req.method === "GET" && req.url === "/audio-mudo.ogg")
    return { tipo: "audio/ogg", bruto: Buffer.from("OggS-mudo") };
  if (req.url === "/computeMetadata/v1/instance/service-accounts/default/token")
    return { corpo: { access_token: "token-google", expires_in: 3600 } };
  if (req.url === "/computeMetadata/v1/project/project-id")
    return { tipo: "text/plain", bruto: "projeto-teste" };
  if (req.url === "/v2/projects/projeto-teste/locations/global/recognizers/_:recognize") {
    if (Buffer.from(body?.content ?? "", "base64").toString() === "OggS-mudo")
      return { corpo: { results: [] } };
    return {
      corpo: { results: [{ alternatives: [{ transcript: "quero higienizar meu sofá amanhã" }] }] },
    };
  }
  const mkt = chatwootMarketing(req, body);
  if (mkt) return mkt;
  if (req.url.endsWith("/messages")) return { corpo: { id: ++idMensagem } };
  return { corpo: {} };
});

console.log(`fakes: claude ${PORTA_CLAUDE}, chatwoot ${PORTA_CHATWOOT}`);
