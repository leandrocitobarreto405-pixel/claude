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
servidor(PORTA_CHATWOOT, (req, body) => {
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
  if (req.url.endsWith("/messages")) return { corpo: { id: ++idMensagem } };
  return { corpo: {} };
});

console.log(`fakes: claude ${PORTA_CLAUDE}, chatwoot ${PORTA_CHATWOOT}`);
