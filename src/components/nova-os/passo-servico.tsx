import { Copy, PlusCircle, Trash2 } from "lucide-react";
import { AlertaRodizio } from "@/components/agenda/alerta-rodizio";
import { AvisoColchao } from "@/components/aviso-colchao";
import { DuplaFaceItem } from "@/components/os/dupla-face-item";
import { colchaoComImper } from "@/lib/aviso-colchao";
import { Botao, Chip } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { brl } from "@/lib/format";
import { itemEditado, subtotalItem, totalVisita } from "@/lib/nova-os/estado";
import type { NovaOs } from "@/lib/nova-os/useNovaOs";
import { Campo, CampoTexto, Secao, Seletor } from "./campos";

export function PassoServico({ n }: { n: NovaOs }) {
  const { estado: e, listas } = n;
  return (
    <div className="flex flex-col gap-3">
      {e.visitas.map((v, i) => (
        <Secao
          key={v.id ?? i}
          titulo={`Atendimento ${i + 1} · ${brl(totalVisita(v))}`}
          acao={
            e.visitas.length > 1 ? (
              <Botao
                variante="neutro"
                tamanho="icone"
                aria-label={`Remover atendimento ${i + 1}`}
                onClick={() => n.removerVisita(i)}
              >
                <Trash2 className="size-4" />
              </Botao>
            ) : null
          }
        >
          <Campo id={`nos-servico-${i}`} rotulo="Tipo de serviço">
            <Seletor
              id={`nos-servico-${i}`}
              value={v.service_type_id}
              onChange={(ev) => n.mudarVisita(i, { service_type_id: ev.target.value })}
            >
              <option value="">Selecione</option>
              {listas.servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Seletor>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo id={`nos-data-${i}`} rotulo="Data">
              <Input
                id={`nos-data-${i}`}
                type="date"
                value={v.scheduled_date}
                onChange={(ev) => n.mudarVisita(i, { scheduled_date: ev.target.value })}
              />
            </Campo>
            <Campo id={`nos-hora-${i}`} rotulo="Horário">
              <Input
                id={`nos-hora-${i}`}
                type="time"
                value={v.scheduled_time}
                onChange={(ev) => n.mudarVisita(i, { scheduled_time: ev.target.value })}
              />
            </Campo>
          </div>
          <Campo id={`nos-tecnico-${i}`} rotulo="Técnico responsável">
            <Seletor
              id={`nos-tecnico-${i}`}
              value={v.technician_id}
              onChange={(ev) => n.mudarVisita(i, { technician_id: ev.target.value })}
            >
              <option value="">Selecione</option>
              {listas.tecnicos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Seletor>
          </Campo>
          <AlertaRodizio
            data={v.scheduled_date}
            hora={v.scheduled_time}
            tecnicoId={v.technician_id}
          />
          <CampoTexto
            id={`nos-obs-${i}`}
            rotulo="Observações do atendimento"
            valor={v.visit_notes}
            aoMudar={(val) => n.mudarVisita(i, { visit_notes: val })}
          />

          <div className="flex flex-col gap-2.5 rounded-card bg-secondary/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-bold">Itens (estofados)</p>
              {e.visitas.length > 1 ? (
                <Seletor
                  className="h-11 w-auto"
                  value=""
                  aria-label="Copiar itens de outro atendimento"
                  onChange={(ev) => {
                    const de = Number(ev.target.value);
                    if (!Number.isNaN(de)) n.copiarItens(de, i);
                    ev.target.value = "";
                  }}
                >
                  <option value="">Copiar itens de…</option>
                  {e.visitas.map((_, idx) =>
                    idx === i ? null : (
                      <option key={idx} value={idx}>
                        Atendimento {idx + 1}
                      </option>
                    ),
                  )}
                </Seletor>
              ) : null}
            </div>
            {v.items.map((it, j) => {
              const servico = listas.servicos.find((s) => s.id === v.service_type_id)?.name;
              const estofado = listas.estofados.find((s) => s.id === it.upholstery_type_id)?.name;
              return (
                <div
                  key={it.id ?? `${it.item_group_id}-${j}`}
                  className="flex flex-col gap-3 rounded-card border border-border bg-card p-3"
                >
                  <Campo id={`nos-item-${i}-${j}-tipo`} rotulo="Tipo de estofado">
                    <Seletor
                      id={`nos-item-${i}-${j}-tipo`}
                      value={it.upholstery_type_id}
                      onChange={(ev) => n.mudarItem(i, j, { upholstery_type_id: ev.target.value })}
                    >
                      <option value="">Selecione</option>
                      {listas.estofados.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Seletor>
                  </Campo>
                  <CampoTexto
                    id={`nos-item-${i}-${j}-desc`}
                    rotulo="Descrição"
                    placeholder="Ex.: sofá 3 lugares retrátil"
                    valor={it.description}
                    aoMudar={(val) => n.mudarItem(i, j, { description: val })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Campo
                      id={`nos-item-${i}-${j}-qtd`}
                      rotulo={it.unidade === "m2" ? "Área (m²)" : "Quantidade"}
                    >
                      <Input
                        id={`nos-item-${i}-${j}-qtd`}
                        inputMode={it.unidade === "m2" ? "decimal" : "numeric"}
                        value={it.quantity}
                        onChange={(ev) =>
                          n.mudarItem(i, j, {
                            quantity: ev.target.value.replace(
                              it.unidade === "m2" ? /[^\d,]/g : /[^\d]/g,
                              "",
                            ),
                          })
                        }
                      />
                    </Campo>
                    <Campo
                      id={`nos-item-${i}-${j}-preco`}
                      rotulo={
                        <span className="flex items-center gap-2">
                          Valor unitário
                          {itemEditado(it) ? <Chip tom="atencao">editado</Chip> : null}
                        </span>
                      }
                      dica={
                        it.preco_tabela
                          ? `Tabela: ${brl(it.preco_tabela)}${it.adicional ? " · adicional pós-fechamento" : ""}`
                          : undefined
                      }
                    >
                      <Input
                        id={`nos-item-${i}-${j}-preco`}
                        inputMode="decimal"
                        value={it.unit_price}
                        onChange={(ev) => n.mudarItem(i, j, { unit_price: ev.target.value })}
                      />
                    </Campo>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">
                      Subtotal <strong>{brl(subtotalItem(it))}</strong>
                    </span>
                    {v.items.length > 1 ? (
                      <Botao variante="neutro" onClick={() => n.removerItem(i, j)}>
                        <Trash2 className="size-4" /> Remover
                      </Botao>
                    ) : null}
                  </div>
                  <DuplaFaceItem
                    descricao={it.description}
                    estofado={estofado}
                    valorUnitario={it.unit_price}
                    precoBase={it.preco_sem_dupla_face ?? null}
                    aoMudar={(patch) => n.mudarItem(i, j, patch)}
                  />
                  {colchaoComImper([it.description, estofado], servico) ? <AvisoColchao /> : null}
                </div>
              );
            })}
            <Botao variante="contorno" onClick={() => n.adicionarItem(i)}>
              <PlusCircle className="size-4" /> Adicionar item
            </Botao>
            {e.visitas.length > 1 ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Copy className="size-3" /> Ao copiar itens, os mesmos estofados são vinculados
                entre os atendimentos.
              </p>
            ) : null}
          </div>
        </Secao>
      ))}
      <Botao variante="contorno" larguraTotal onClick={n.adicionarVisita}>
        <PlusCircle className="size-4" /> Adicionar outro atendimento
      </Botao>
    </div>
  );
}
