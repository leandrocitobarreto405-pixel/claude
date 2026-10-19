// Modo dos documentos decidido na hora: PDF nunca chama o Drive; Drive desligado só avisa; cache
// separado por empresa.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVISO_DRIVE_DESLIGADO,
  avisoDocumento,
  chaveModoDocumentos,
  decidirDocumentoOs,
  geraNoDriveAoCriar,
  type SituacaoDocumentos,
} from "./documentos-decisao";

const driveOk = { enabled: true, autoGenerate: true, configured: true };
const situacao = (modo: "drive" | "pdf", drive = driveOk): SituacaoDocumentos => ({
  modo,
  drive,
  decisao: decidirDocumentoOs(modo, drive),
});

test("1) modo PDF: nunca chama o Drive, mesmo com o Drive ligado e configurado", () => {
  const s = situacao("pdf");
  assert.equal(s.decisao, "pdf");
  assert.equal(geraNoDriveAoCriar(s), false);
  assert.equal(avisoDocumento(s.decisao), null);
});

test("2) cache do modo separado por empresa (admin da Nexa troca de empresa)", () => {
  assert.notDeepEqual(chaveModoDocumentos("empresa-a"), chaveModoDocumentos("empresa-b"));
  assert.deepEqual(chaveModoDocumentos("empresa-a").slice(0, 1), ["modo-documentos"]);
  assert.deepEqual(chaveModoDocumentos(null), ["modo-documentos", "sem-empresa"]);
});

test("3) modo Drive com a integração desligada: não tenta gerar e avisa (sem erro)", () => {
  const s = situacao("drive", { ...driveOk, enabled: false });
  assert.equal(s.decisao, "drive_desligado");
  assert.equal(geraNoDriveAoCriar(s), false);
  assert.equal(avisoDocumento(s.decisao), AVISO_DRIVE_DESLIGADO);
  assert.match(AVISO_DRIVE_DESLIGADO, /Configurações › Documentos ou use PDF direto no app/);
});

test("modo Drive ligado: gera ao criar só com a geração automática; incompleto avisa", () => {
  assert.equal(geraNoDriveAoCriar(situacao("drive")), true);
  assert.equal(geraNoDriveAoCriar(situacao("drive", { ...driveOk, autoGenerate: false })), false);
  const inc = situacao("drive", { ...driveOk, configured: false });
  assert.equal(inc.decisao, "drive_incompleto");
  assert.equal(geraNoDriveAoCriar(inc), false);
  assert.match(avisoDocumento(inc.decisao) ?? "", /não configurados/);
});
