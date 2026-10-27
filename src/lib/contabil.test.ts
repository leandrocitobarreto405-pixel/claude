import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TENTATIVAS_DRIVE,
  csv,
  periodoDoMes,
  tentarCopiaDrive,
  validarAcaoNota,
  validarArquivo,
} from "./contabil";

test("Drive: cópia com sucesso guarda o link da pasta", async () => {
  const r = await tentarCopiaDrive(0, async () => ({
    url: "https://drive.google.com/drive/folders/x",
  }));
  assert.deepEqual(r, {
    situacao: "copiada",
    tentativas: 1,
    erro: null,
    url: "https://drive.google.com/drive/folders/x",
  });
});

test("Drive: falha fica pendente e a rotina tenta de novo até dar certo", async () => {
  let chamadas = 0;
  const copiar = async () => {
    chamadas++;
    if (chamadas < 3) throw new Error("Google fora do ar");
    return { url: "https://drive.google.com/drive/folders/y" };
  };
  let r = await tentarCopiaDrive(0, copiar);
  assert.equal(r.situacao, "pendente");
  assert.equal(r.erro, "Google fora do ar");
  r = await tentarCopiaDrive(r.tentativas, copiar);
  assert.equal(r.situacao, "pendente");
  r = await tentarCopiaDrive(r.tentativas, copiar);
  assert.equal(r.situacao, "copiada");
  assert.equal(r.tentativas, 3);
});

test("Drive: depois do limite de tentativas vira erro (para o admin ver)", async () => {
  const r = await tentarCopiaDrive(MAX_TENTATIVAS_DRIVE - 1, async () => {
    throw new Error("sem permissão na pasta");
  });
  assert.equal(r.situacao, "erro");
});

test("Drive: empresa sem Drive configurado não fica tentando", async () => {
  const r = await tentarCopiaDrive(0, async () => "sem_drive" as const);
  assert.equal(r.situacao, "sem_drive");
});

test("arquivos: PDF/imagem para a nota, XML separado, até 10 MB", () => {
  assert.equal(validarArquivo("nota.pdf", 1000, "pdf").ok, true);
  assert.equal(validarArquivo("nota.jpg", 1000, "pdf").ok, true);
  assert.equal(validarArquivo("nota.xml", 1000, "pdf").ok, false);
  assert.equal(validarArquivo("nota.xml", 1000, "xml").ok, true);
  assert.equal(validarArquivo("nota.exe", 1000).ok, false);
  assert.equal(validarArquivo("grande.pdf", 11 * 1024 * 1024).ok, false);
  assert.equal(validarArquivo("comprovante.png", 2000).ok, true);
});

test("marcar nota: emitida pede número, data e arquivo; cancelada pede motivo", () => {
  assert.match(validarAcaoNota({ acao: "emitida", temArquivo: true }) ?? "", /número/);
  assert.match(validarAcaoNota({ acao: "emitida", numero: "123", temArquivo: true }) ?? "", /data/);
  assert.match(
    validarAcaoNota({ acao: "emitida", numero: "123", data: "2026-10-27", temArquivo: false }) ??
      "",
    /Anexe/,
  );
  assert.equal(
    validarAcaoNota({ acao: "emitida", numero: "123", data: "2026-10-27", temArquivo: true }),
    null,
  );
  assert.match(validarAcaoNota({ acao: "cancelada", temArquivo: false }) ?? "", /motivo/);
  assert.equal(validarAcaoNota({ acao: "nao_necessaria", temArquivo: false }), null);
});

test("mês: primeiro e último dia, inclusive fevereiro", () => {
  assert.deepEqual(periodoDoMes("2026-10"), { de: "2026-10-01", ate: "2026-10-31" });
  assert.deepEqual(periodoDoMes("2028-02"), { de: "2028-02-01", ate: "2028-02-29" });
  assert.throws(() => periodoDoMes("2026-13"));
});

test("CSV: ponto e vírgula, vírgula decimal e aspas", () => {
  assert.equal(csv([["a;b", 10.5, null]]), '﻿"a;b";10,5;\r\n');
});
