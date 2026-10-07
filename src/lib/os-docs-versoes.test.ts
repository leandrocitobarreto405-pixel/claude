import { test } from "node:test";
import assert from "node:assert/strict";
import { ehMesmoDocumento, escolherSubstituidos, nomeSubstituido } from "./os-docs-versoes";

const base = "OS 1628 - Giulia Ramilo Assunção";
const reg = (id: string, hora: string, extra: Partial<Record<string, unknown>> = {}) => ({
  id,
  created_at: `2026-10-07T${hora}:00Z`,
  google_document_id: `doc-${id}`,
  generation_status: "Gerado",
  is_active: true,
  ...extra,
});
const arq = (id: string, hora: string, name = base) => ({
  id,
  name,
  createdTime: `2026-10-07T${hora}:01Z`,
  mimeType: "application/vnd.google-apps.document",
});

test("mesmo documento: nome-base, com ou sem versão", () => {
  assert.ok(ehMesmoDocumento(base, base));
  assert.ok(ehMesmoDocumento(`${base} - V2`, base));
  assert.ok(ehMesmoDocumento("OS 1628 - GIULIA RAMILO ASSUNCAO", base));
  assert.ok(!ehMesmoDocumento(`${base} - V2 (cópia)`, base));
  assert.ok(!ehMesmoDocumento("OS 16280 - Giulia Ramilo Assunção", base));
  assert.ok(!ehMesmoDocumento(`Termo de garantia — ${base}`, base));
  assert.ok(!ehMesmoDocumento(base, ""));
});

test("fica o mais recente; sai o anterior e o arquivo antigo sem registro", () => {
  const r = escolherSubstituidos({
    base,
    registros: [reg("b", "15:46"), reg("a", "09:05")],
    arquivos: [
      arq("doc-b", "15:46"),
      arq("doc-a", "09:05"),
      arq("perdido", "08:00"),
      arq("foto", "08:00", "Antes"),
    ],
  });
  assert.equal(r.vencedor?.id, "b");
  assert.deepEqual(
    r.registros.map((x) => x.id),
    ["a"],
  );
  assert.deepEqual(r.arquivos.sort(), ["doc-a", "perdido"]);
});

test("duas gerações juntas: as duas chegam à mesma escolha", () => {
  const registros = [reg("a", "12:02"), reg("b", "12:03")];
  const arquivos = [arq("doc-a", "12:02"), arq("doc-b", "12:03")];
  const r = escolherSubstituidos({ base, registros, arquivos });
  assert.equal(r.vencedor?.id, "b");
  assert.deepEqual(r.arquivos, ["doc-a"]);
});

test("geração em andamento e arquivo mais novo que o escolhido não saem", () => {
  const r = escolherSubstituidos({
    base,
    registros: [
      reg("a", "12:00"),
      reg("c", "12:05", { generation_status: "Gerando", is_active: false }),
    ],
    arquivos: [arq("doc-a", "12:00"), arq("doc-c", "12:05"), arq("sem-registro-novo", "12:06")],
  });
  assert.equal(r.vencedor?.id, "a");
  assert.deepEqual(r.arquivos, []);
});

test("sem documento gerado: nada sai", () => {
  const r = escolherSubstituidos({
    base,
    registros: [reg("a", "12:00", { generation_status: "Erro" })],
    arquivos: [arq("x", "11:00")],
  });
  assert.equal(r.vencedor, null);
  assert.deepEqual(r.arquivos, []);
});

test("nome no controle interno com a data de São Paulo", () => {
  assert.equal(
    nomeSubstituido(base, new Date("2026-10-07T18:46:00Z")),
    `${base} (substituído em 07/10/2026 15:46)`,
  );
});
