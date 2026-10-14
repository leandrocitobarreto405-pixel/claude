// Seção de Configurações (veio da antiga tela de abas).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_MESSAGE_TEMPLATE, saveSetting, useSetting } from "@/lib/data";
import { templateText } from "@/lib/os";
import { DEFAULT_NOTA_TEMPLATE } from "@/lib/nota-fiscal";

export function Mensagem() {
  const { data: template } = useSetting<unknown>("message_template", DEFAULT_MESSAGE_TEMPLATE);
  const [texto, setTexto] = useState("");

  useEffect(() => {
    const t = templateText(template);
    if (t) setTexto(t);
  }, [template]);

  async function salvar() {
    try {
      await saveSetting("message_template", texto);
      toast.success("Modelo de mensagem salvo.");
    } catch {
      toast.error("Não foi possível salvar o modelo.");
    }
  }

  return (
    <section className="card-surface p-5">
      <h2 className="mb-2 text-lg font-semibold">Modelo da mensagem de confirmação</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Use as variáveis: {"{{dia_da_semana}}"}, {"{{data}}"}, {"{{horario}}"}, {"{{numero_os}}"},{" "}
        {"{{nome_cliente}}"}, {"{{telefone}}"}, {"{{descricao_estofado}}"}, {"{{servico}}"},{" "}
        {"{{endereco_completo}}"}, {"{{valor_formatado}}"}, {"{{tecnico}}"} e {"{{observacao}}"}.
      </p>
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="min-h-[260px] font-mono text-sm"
      />
      <Button className="mt-4" onClick={salvar}>
        Salvar modelo
      </Button>
    </section>
  );
}

export function MensagemNota() {
  const { data: modelo } = useSetting<unknown>("invoice_message_template", DEFAULT_NOTA_TEMPLATE);
  const [texto, setTexto] = useState("");

  useEffect(() => {
    setTexto(typeof modelo === "string" && modelo.trim() ? modelo : DEFAULT_NOTA_TEMPLATE);
  }, [modelo]);

  async function salvar() {
    try {
      await saveSetting("invoice_message_template", texto);
      toast.success("Modelo da mensagem da nota salvo.");
    } catch {
      toast.error("Não foi possível salvar o modelo.");
    }
  }

  return (
    <section className="card-surface p-5">
      <h2 className="mb-2 text-lg font-semibold">Mensagem para emissão da nota fiscal</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Usada no botão “Copiar mensagem” da OS e da tela Notas fiscais. Variáveis:{" "}
        {"{{nome_cliente}}"}, {"{{cpf_cnpj}}"}, {"{{email}}"}, {"{{data_servico}}"},{" "}
        {"{{forma_pagamento}}"}, {"{{valor}}"} e {"{{numero_os}}"}.
      </p>
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="min-h-[200px] font-mono text-sm"
      />
      <div className="mt-4 flex gap-2">
        <Button onClick={salvar}>Salvar modelo</Button>
        <Button variant="outline" onClick={() => setTexto(DEFAULT_NOTA_TEMPLATE)}>
          Voltar ao padrão
        </Button>
      </div>
    </section>
  );
}

/** Campos que o app troca no modelo (escreva exatamente assim no Google Docs). */
