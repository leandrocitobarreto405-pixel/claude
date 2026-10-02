import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const TOKEN = "EAAtokensecretodeteste1234567890";
const pedidos: Array<{ metodo: string; url: string; auth: string; corpo: unknown }> = [];
let servidor: http.Server;

before(async () => {
  servidor = http.createServer(async (req, res) => {
    const partes: Buffer[] = [];
    for await (const p of req) partes.push(p as Buffer);
    const corpo = partes.length ? JSON.parse(Buffer.concat(partes).toString()) : null;
    pedidos.push({
      metodo: req.method!,
      url: req.url!,
      auth: String(req.headers.authorization),
      corpo,
    });
    const responder = (status: number, json: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`)
      // A Meta às vezes repete o token na mensagem: o cliente precisa apagar.
      return responder(401, {
        error: {
          message: `Invalid OAuth access token - ${String(req.headers.authorization).slice(7)}`,
          code: 190,
        },
      });
    const u = new URL(req.url!, "http://x");
    if (u.pathname === "/v23.0/123456789" && req.method === "GET")
      return responder(200, { id: "123456789", name: "Turbine Clean" });
    if (u.pathname === "/v23.0/123456789/message_templates" && req.method === "GET") {
      if (u.searchParams.get("fields")?.includes("rejected_reason"))
        return responder(400, {
          error: {
            message: "(#100) Tried accessing nonexisting field (rejected_reason)",
            code: 100,
          },
        });
      if (!u.searchParams.get("after"))
        return responder(200, {
          data: [{ id: "1", name: "a", language: "pt_BR", status: "APPROVED" }],
          paging: { cursors: { after: "PAG2" }, next: "https://graph/next" },
        });
      return responder(200, {
        data: [{ id: "2", name: "b", language: "pt_BR", status: "REJECTED" }],
      });
    }
    if (u.pathname === "/v23.0/123456789/message_templates" && req.method === "POST")
      return responder(200, { id: "555", status: "PENDING", category: "MARKETING" });
    if (u.pathname === "/v23.0/555" && req.method === "POST")
      return responder(200, { success: true });
    return responder(404, { error: { message: "Unknown path", code: 100 } });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  process.env["META_GRAPH_URL"] = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => servidor.close());

test("conexão, lista paginada sem o campo do motivo, criar e editar", async () => {
  const g = await import("./graph.server");
  const cx = { waba: "123456789", token: TOKEN };
  assert.deepEqual(await g.conferirConexao(cx), { nome: "Turbine Clean" });
  const lista = await g.listarModelos(cx);
  assert.deepEqual(
    lista.map((m) => m.name),
    ["a", "b"],
  );
  const criado = await g.criarModelo(cx, {
    name: "tc_x",
    language: "pt_BR",
    category: "MARKETING",
    components: [{ type: "BODY", text: "Oi" }],
  });
  assert.equal(criado.id, "555");
  assert.deepEqual(
    await g.editarModelo(cx, "555", { components: [{ type: "BODY", text: "Olá" }] }),
    {
      success: true,
    },
  );
  // Token só no cabeçalho, nunca na URL nem no corpo.
  for (const p of pedidos) {
    assert.equal(p.url.includes(TOKEN), false);
    assert.equal(JSON.stringify(p.corpo ?? "").includes(TOKEN), false);
  }
});

test("erro da Meta sai sem o token", async () => {
  const g = await import("./graph.server");
  const errado = "EAAoutrotokenerrado99999999999";
  await assert.rejects(
    () => g.conferirConexao({ waba: "123456789", token: errado }),
    (e: unknown) => {
      assert.ok(e instanceof g.ErroMeta);
      assert.equal(e.codigo, 190);
      assert.equal(e.message.includes(errado), false);
      assert.equal(e.message.includes("EAA"), false);
      assert.match(g.mensagemDoErro(e), /recusou o token/);
      return true;
    },
  );
  assert.equal(g.semToken(`x ${TOKEN} y Bearer abc`, TOKEN), "x *** y Bearer ***");
});
