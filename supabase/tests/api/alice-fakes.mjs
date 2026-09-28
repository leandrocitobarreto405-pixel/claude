// Servidores falsos para o teste da Alice: "Claude" (API de mensagens) e "Chatwoot" (API da conta).
// Cada um guarda as requisições recebidas; GET /__log devolve a lista.
import http from "node:http";

const PORTA_CLAUDE = Number(process.env.PORTA_CLAUDE ?? 3995);
const PORTA_CHATWOOT = Number(process.env.PORTA_CHATWOOT ?? 3994);

function servidor(porta, tratar) {
  const log = [];
  http
    .createServer(async (req, res) => {
      let corpo = "";
      for await (const parte of req) corpo += parte;
      if (req.method === "GET" && req.url === "/__log") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(log));
      }
      let json = null;
      try {
        json = corpo ? JSON.parse(corpo) : null;
      } catch {
        /* corpo não-JSON */
      }
      log.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      const r = tratar(req, json);
      res.writeHead(r.status ?? 200, { "Content-Type": r.tipo ?? "application/json" });
      res.end(r.bruto ?? JSON.stringify(r.corpo ?? {}));
    })
    .listen(porta, "127.0.0.1");
}

// ---------------------------------------------------------------- Claude
function textoDoUltimoUsuario(msgs) {
  const ultimo = [...msgs].reverse().find((m) => m.role === "user");
  const blocos = Array.isArray(ultimo?.content)
    ? ultimo.content
    : [{ type: "text", text: ultimo?.content ?? "" }];
  return blocos;
}
function resposta(content, stop_reason) {
  return {
    corpo: {
      id: `msg_${Math.random().toString(36).slice(2)}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
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
servidor(PORTA_CLAUDE, (req, body) => {
  if (!req.url.startsWith("/v1/messages")) return { status: 404, corpo: { error: "not found" } };
  const blocos = textoDoUltimoUsuario(body.messages);
  if (blocos.some((b) => b.type === "tool_result")) {
    const passou = JSON.stringify(body.messages).includes("passar_para_atendente");
    return resposta(
      [
        {
          type: "text",
          text: passou
            ? "Claro! Vou chamar uma especialista da equipe, só um instante."
            : "Oi! Sou a Alice, assistente virtual da Turbine Clean 😊\n\nA higienização do **sofá de 3 lugares** sai por R$ 180,00. Qual o seu bairro?",
        },
      ],
      "end_turn",
    );
  }
  const texto = JSON.stringify(blocos);
  if (texto.includes("pessoa")) {
    return resposta(
      [
        {
          type: "tool_use",
          id: "toolu_passar",
          name: "passar_para_atendente",
          input: { motivo: "cliente pediu uma pessoa", resumo: "Quer falar com atendente." },
        },
      ],
      "tool_use",
    );
  }
  return resposta(
    [
      {
        type: "tool_use",
        id: "toolu_lead",
        name: "atualizar_lead",
        input: {
          descricao_estofados: "Sofá 3 lugares com mancha",
          servico_interesse: "Higienização",
        },
      },
    ],
    "tool_use",
  );
});

// ---------------------------------------------------------------- Chatwoot
// JPEG mínimo (1x1).
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z",
  "base64",
);
let idMensagem = 7000;
servidor(PORTA_CHATWOOT, (req) => {
  if (req.method === "GET" && req.url === "/foto-sofa.jpg")
    return { tipo: "image/jpeg", bruto: JPEG };
  if (req.url.endsWith("/messages")) return { corpo: { id: ++idMensagem } };
  return { corpo: {} };
});

console.log(`fakes: claude ${PORTA_CLAUDE}, chatwoot ${PORTA_CHATWOOT}`);
