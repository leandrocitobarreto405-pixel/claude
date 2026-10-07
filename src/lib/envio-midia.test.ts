import { test } from "node:test";
import assert from "node:assert/strict";
import { ErroConexao, criarFila, type Dependencias } from "./envio-midia";
import { PEDACO_ENVIO } from "./midia-os";

/** Google simulado: guarda quanto recebeu por envio; pode derrubar a conexão em pedaços escolhidos. */
function cenario(op: { quedas?: number[]; online?: boolean; expira?: boolean } = {}) {
  const recebido = new Map<string, number>();
  const registrados: string[] = [];
  const reservas: string[] = [];
  let chamadas = 0;
  let sessoes = 0;
  const guardadas = new Map<string, string>();
  const quedas = new Set(op.quedas ?? []);
  let expirar = Boolean(op.expira);
  const deps: Dependencias = {
    abrir: async () => {
      const s = `sessao-${++sessoes}`;
      recebido.set(s, 0);
      return s;
    },
    situacao: async (s, total) => {
      const r = recebido.get(s) ?? 0;
      return { recebidos: r, fileId: r >= total ? `arquivo-${s}` : null };
    },
    registrar: async (e, fileId) => void registrados.push(`${e.destino}:${fileId}`),
    reserva: async (e) => void reservas.push(e.nome),
    pedaco: async (s, parte, inicio, total, progresso) => {
      chamadas++;
      if (quedas.has(chamadas)) throw new ErroConexao("rede");
      if (expirar) {
        expirar = false;
        return { status: 404, corpo: "" };
      }
      assert.equal(inicio, recebido.get(s), "continua de onde o Google parou");
      progresso(parte.size / 2);
      recebido.set(s, inicio + parte.size);
      const fim = inicio + parte.size >= total;
      return fim
        ? { status: 200, corpo: JSON.stringify({ id: `arquivo-${s}` }) }
        : { status: 308, corpo: "" };
    },
    online: () => op.online ?? true,
    esperar: async () => undefined,
    guardar: (k, s) => (s ? guardadas.set(k, s) : guardadas.delete(k)),
    lembrar: (k) => guardadas.get(k) ?? null,
  };
  const fila = criarFila(deps);
  const terminar = async () => {
    for (let i = 0; i < 50 && fila.emAndamento(); i++) await new Promise((r) => setTimeout(r, 1));
  };
  return { fila, terminar, registrados, reservas, guardadas, pedacos: () => chamadas };
}
const video = (mb: number, nome = "IMG_8315.MOV") =>
  new File([new Uint8Array(mb * 1024 * 1024)], nome, { type: "" });

test("vídeo de 50 MB do iPhone vai em pedaços e é registrado em Antes", async () => {
  const c = cenario();
  c.fila.adicionar("os-1", "Antes", [video(50)]);
  await c.terminar();
  const [e] = c.fila.lista();
  assert.equal(e!.estado, "pronto");
  assert.equal(e!.tipo, "video/quicktime");
  assert.equal(c.pedacos(), Math.ceil((50 * 1024 * 1024) / PEDACO_ENVIO));
  assert.deepEqual(c.registrados, ["Antes:arquivo-sessao-1"]);
  assert.equal(c.guardadas.size, 0, "envio terminado não fica guardado");
});

test("internet cai no meio: tenta de novo sozinho e continua do ponto certo", async () => {
  const c = cenario({ quedas: [3] });
  c.fila.adicionar("os-1", "Depois", [video(30)]);
  await c.terminar();
  assert.equal(c.fila.lista()[0]!.estado, "pronto");
  assert.deepEqual(c.registrados, ["Depois:arquivo-sessao-1"], "a mesma sessão, sem recomeçar");
});

test("sem internet de vez: fica o motivo e o botão continua do ponto certo", async () => {
  const c = cenario({ quedas: [2, 3, 4, 5], online: false });
  c.fila.adicionar("os-1", "Controle interno", [video(30)]);
  await c.terminar();
  const e = c.fila.lista()[0]!;
  assert.equal(e.estado, "erro");
  assert.match(e.motivo!, /Sem internet \(26% enviado\)/);
  c.fila.tentarDeNovo(e.id);
  await c.terminar();
  assert.equal(c.fila.lista()[0]!.estado, "pronto");
  assert.deepEqual(c.registrados, ["Controle interno:arquivo-sessao-1"]);
});

test("envio expirado no Google: abre outro e recomeça", async () => {
  const c = cenario({ expira: true });
  c.fila.adicionar("os-1", "Antes", [video(9)]);
  await c.terminar();
  assert.equal(c.fila.lista()[0]!.estado, "pronto");
  assert.deepEqual(c.registrados, ["Antes:arquivo-sessao-2"]);
});

test("envio direto recusado: arquivo pequeno vai pelo servidor; grande mostra o motivo", async () => {
  const c = cenario({ quedas: [1, 2, 3, 4, 5, 6, 7, 8] });
  c.fila.adicionar("os-1", "Antes", [
    new File([new Uint8Array(1000)], "foto.jpg", { type: "image/jpeg" }),
  ]);
  await c.terminar();
  assert.equal(c.fila.lista()[0]!.estado, "pronto");
  assert.deepEqual(c.reservas, ["foto.jpg"]);

  c.fila.adicionar("os-1", "Antes", [video(25)]);
  await c.terminar();
  const grande = c.fila.lista()[1]!;
  assert.equal(grande.estado, "erro");
  assert.match(grande.motivo!, /conexão caiu durante o envio \(0% enviado\)/);
});

test("formato e tamanho fora do aceito: não envia e mostra o motivo", async () => {
  const c = cenario();
  const pdf = new File([new Uint8Array(10)], "nota.pdf", { type: "application/pdf" });
  const enorme = {
    name: "longo.mov",
    type: "video/quicktime",
    size: 3 * 1024 ** 3,
    lastModified: 1,
  } as File;
  c.fila.adicionar("os-1", "Antes", [pdf, enorme]);
  await c.terminar();
  const [a, b] = c.fila.lista();
  assert.match(a!.motivo!, /Formato \.pdf não aceito/);
  assert.match(b!.motivo!, /grande demais \(3,0 GB\)/);
  assert.equal(c.pedacos(), 0);
});
