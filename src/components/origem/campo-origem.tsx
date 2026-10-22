// Campo "Origem da venda" do orçamento e da Nova OS: vem preenchido com a origem detectada (aviso
// pequeno embaixo: "detectada pela primeira mensagem"...), vazio e obrigatório quando nada foi
// detectado, e pede o nome de quem indicou quando a origem é Indicação.
import { Input } from "@/components/ui/input";
import { Campo, Seletor } from "@/components/nova-os/campos";
import type { ConfigOption } from "@/lib/data";
import { avisoDaDeteccao, codigoDaOrigem, semIndicacaoSeNaoFor } from "@/lib/origem-venda";

export type ValorOrigem = { origemId: string; origemCodigo: string; indicacaoNome: string };

export function CampoOrigem({
  id,
  opcoes,
  valor,
  detectadaId,
  detectadaComo,
  buscando,
  onMudar,
}: {
  id: string;
  opcoes: ConfigOption[];
  valor: ValorOrigem;
  detectadaId: string | null;
  detectadaComo: string | null;
  buscando?: boolean;
  onMudar: (v: ValorOrigem) => void;
}) {
  const aviso = avisoDaDeteccao(detectadaComo);
  const nomeDetectada = opcoes.find((o) => o.id === detectadaId)?.name ?? null;
  const trocada = Boolean(detectadaId && valor.origemId && valor.origemId !== detectadaId);
  const dica = buscando ? (
    "Procurando a origem pela conversa…"
  ) : trocada && nomeDetectada ? (
    <span className="text-atencao-foreground">
      O app detectou {nomeDetectada} ({aviso}). Se trocar, a troca fica registrada.
    </span>
  ) : detectadaId && aviso ? (
    aviso.charAt(0).toUpperCase() + aviso.slice(1)
  ) : !valor.origemId ? (
    "Não detectada: escolha de onde o cliente veio."
  ) : undefined;
  return (
    <>
      <Campo id={id} rotulo="Origem da venda" dica={dica}>
        <Seletor
          id={id}
          value={valor.origemId}
          aria-invalid={!valor.origemId}
          onChange={(ev) => {
            const origemId = ev.target.value;
            const origemCodigo = codigoDaOrigem(opcoes, origemId);
            onMudar({
              origemId,
              origemCodigo,
              indicacaoNome: semIndicacaoSeNaoFor(origemCodigo, valor.indicacaoNome),
            });
          }}
        >
          <option value="">Selecione</option>
          {opcoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Seletor>
      </Campo>
      {valor.origemCodigo === "indicacao" ? (
        <Campo id={`${id}-indicacao`} rotulo="Quem indicou">
          <Input
            id={`${id}-indicacao`}
            value={valor.indicacaoNome}
            maxLength={120}
            placeholder="Nome de quem indicou"
            onChange={(ev) => onMudar({ ...valor, indicacaoNome: ev.target.value })}
          />
        </Campo>
      ) : null}
    </>
  );
}
