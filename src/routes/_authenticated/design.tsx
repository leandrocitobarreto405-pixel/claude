import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  CalendarDays,
  Check,
  Home,
  MapPin,
  Megaphone,
  MessageCircle,
  Phone,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  BarraDeNavegacaoInferior,
  BlocoEscuro,
  Botao,
  CabecalhoDeTela,
  Card,
  CardEscuro,
  Chip,
  LinhaSwitch,
  NumeroGrande,
  Switch,
  type ItemDeNavegacao,
} from "@/components/nexa";

// Página interna (fora do menu) para conferir o tema e os componentes do Nexa.
// Só o admin entra: a rota não está nas listas do atendente nem do técnico (src/lib/tenant.ts).
export const Route = createFileRoute("/_authenticated/design")({
  head: () => ({ meta: [{ title: "Componentes — Nexa OS" }] }),
  component: PaginaDesign,
});

const ABAS: ItemDeNavegacao[] = [
  { to: "/design", rotulo: "Início", icone: Home },
  { to: "/agenda", rotulo: "Agenda", icone: CalendarDays },
  { to: "/crm/whatsapp", rotulo: "Conversas", icone: MessageCircle, badge: 2 },
  { to: "/marketing", rotulo: "Marketing", icone: Megaphone },
  { to: "/mensagens", rotulo: "Avisos", icone: Bell, ponto: true },
];

const CORES: { nome: string; classe: string; hex: string; texto?: string }[] = [
  { nome: "Fundo do app", classe: "bg-background", hex: "#F3F4F1" },
  { nome: "Cartão", classe: "bg-card", hex: "#FFFFFF" },
  { nome: "Borda", classe: "bg-border", hex: "#E3E7E3" },
  { nome: "Texto", classe: "bg-foreground", hex: "#0D1F1C", texto: "text-background" },
  { nome: "Texto secundário", classe: "bg-muted-foreground", hex: "#5A6B67", texto: "text-card" },
  { nome: "Marca", classe: "bg-marca", hex: "#0B3D36", texto: "text-marca-foreground" },
  { nome: "Marca clara", classe: "bg-marca-claro", hex: "#DCF3E9" },
  { nome: "Destaque no escuro", classe: "bg-destaque", hex: "#7CE8C2" },
  { nome: "Verde de dado", classe: "bg-dado", hex: "#2FB58A" },
  { nome: "Atenção", classe: "bg-atencao", hex: "#FFF1D6", texto: "text-atencao-foreground" },
  { nome: "Problema", classe: "bg-problema", hex: "#FDE8EA", texto: "text-problema-foreground" },
  { nome: "Alerta", classe: "bg-alerta", hex: "#D9480F", texto: "text-alerta-foreground" },
];

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-titulo text-lg">{titulo}</h2>
      {children}
    </section>
  );
}

function PaginaDesign() {
  const [alice, setAlice] = React.useState(true);
  const [lembrete, setLembrete] = React.useState(false);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-7 pb-28">
      <CabecalhoDeTela
        sobretitulo="Página interna · só admin"
        titulo="Componentes"
        descricao="Tema e peças visuais do Nexa. As telas novas usam só estes componentes e as cores do tema."
        acao={
          <Botao tamanho="icone" aria-label="Novo">
            <Plus />
          </Botao>
        }
      />

      <Secao titulo="Cores">
        <div className="grid grid-cols-2 gap-2.5">
          {CORES.map((c) => (
            <div
              key={c.nome}
              className={`flex min-h-16 flex-col justify-end rounded-botao border border-border p-2.5 ${c.classe} ${c.texto ?? "text-foreground"}`}
            >
              <span className="text-[13px] font-bold">{c.nome}</span>
              <span className="text-xs opacity-80">{c.hex}</span>
            </div>
          ))}
        </div>
      </Secao>

      <Secao titulo="Fontes">
        <Card>
          <p className="font-titulo text-[30px] leading-tight">Bricolage Grotesque</p>
          <p className="text-[15px]">
            Plus Jakarta Sans para o texto: <span className="font-medium">médio</span>,{" "}
            <span className="font-semibold">seminegrito</span> e{" "}
            <span className="font-bold">negrito</span>.
          </p>
          <p className="text-sm text-muted-foreground">Texto secundário em cinza-esverdeado.</p>
        </Card>
      </Secao>

      <Secao titulo="Cabeçalho de tela">
        <Card className="bg-background">
          <CabecalhoDeTela
            sobretitulo="Sexta, 2 de outubro"
            titulo="Bom dia!"
            acao={<Botao variante="contorno">Hoje</Botao>}
          />
          <CabecalhoDeTela voltarPara="/design" titulo="Serviço" />
        </Card>
      </Secao>

      <Secao titulo="Card e CardEscuro">
        <CardEscuro>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-destaque" aria-hidden />
              Alice online
            </span>
            <Chip tom="sucesso">Respondendo</Chip>
          </div>
          <NumeroGrande
            tamanho="grande"
            disposicao="ao-lado"
            valor="2"
            legenda="conversas esperando você agora"
            sobreEscuro
          />
          <div className="grid grid-cols-3 gap-2">
            <BlocoEscuro>
              <NumeroGrande tamanho="pequeno" valor="14" legenda="conversas hoje" sobreEscuro />
            </BlocoEscuro>
            <BlocoEscuro>
              <NumeroGrande tamanho="pequeno" valor="5" legenda="agendou" sobreEscuro />
            </BlocoEscuro>
            <BlocoEscuro>
              <NumeroGrande tamanho="pequeno" valor="3" legenda="orçamentos" sobreEscuro />
            </BlocoEscuro>
          </div>
          <Botao variante="claro" tamanho="grande" larguraTotal>
            Ver conversas
          </Botao>
        </CardEscuro>

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-titulo text-[22px] leading-tight">09:30</span>
              <span className="text-[15px] font-bold">Maria Souza</span>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden />
                Rua das Flores, 120 · Moema
              </span>
            </div>
            <Chip tom="atencao">A caminho</Chip>
          </div>
          <p className="text-sm">Sofá 3 lugares + 2 cadeiras · impermeabilização</p>
          <div className="grid grid-cols-2 gap-2">
            <Botao variante="neutro">
              <MessageCircle /> WhatsApp
            </Botao>
            <Botao variante="neutro">
              <Phone /> Ligar
            </Botao>
          </div>
          <Botao larguraTotal tamanho="grande">
            <Check /> Concluir serviço
          </Botao>
        </Card>

        <Card>
          <NumeroGrande valor="R$ 12.480" complemento="de R$ 20.000" legenda="Meta de outubro" />
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[62%] rounded-full bg-dado" />
          </div>
        </Card>
      </Secao>

      <Secao titulo="Chips">
        <Card>
          <div className="flex flex-wrap gap-2">
            <Chip>Neutro</Chip>
            <Chip tom="sucesso">
              <Sparkles className="size-3.5" aria-hidden /> Alice agendou
            </Chip>
            <Chip tom="atencao">A caminho</Chip>
            <Chip tom="problema">Reclamação</Chip>
          </div>
        </Card>
      </Secao>

      <Secao titulo="Botões (44 px ou mais)">
        <Card>
          <Botao larguraTotal>Primário</Botao>
          <Botao variante="contorno" larguraTotal>
            Contorno
          </Botao>
          <Botao variante="neutro" larguraTotal>
            Neutro
          </Botao>
          <Botao larguraTotal tamanho="grande">
            Primário grande (48 px)
          </Botao>
          <div className="flex gap-2">
            <Botao tamanho="icone" aria-label="Novo">
              <Plus />
            </Botao>
            <Botao tamanho="icone" variante="contorno" aria-label="Ligar">
              <Phone />
            </Botao>
            <Botao tamanho="icone" variante="neutro" aria-label="WhatsApp">
              <MessageCircle />
            </Botao>
            <Botao disabled className="flex-1">
              Desativado
            </Botao>
          </div>
        </Card>
      </Secao>

      <Secao titulo="Switch">
        <Card>
          <LinhaSwitch
            id="design-alice"
            titulo="Alice atendendo"
            descricao="Responde clientes no WhatsApp."
            checked={alice}
            onCheckedChange={setAlice}
          />
          <LinhaSwitch
            id="design-lembrete"
            titulo="Lembrete de amanhã"
            descricao="Avisa o cliente na véspera."
            checked={lembrete}
            onCheckedChange={setLembrete}
          />
          <div className="flex items-center gap-3">
            <Switch checked disabled aria-label="Ligado e bloqueado" />
            <Switch disabled aria-label="Desligado e bloqueado" />
            <span className="text-sm text-muted-foreground">bloqueados</span>
          </div>
        </Card>
      </Secao>

      <Secao titulo="Número grande">
        <Card>
          <div className="grid grid-cols-3 gap-3">
            <NumeroGrande tamanho="pequeno" valor="6" legenda="serviços hoje" />
            <NumeroGrande tamanho="pequeno" valor="R$ 2.340" legenda="a receber" />
            <NumeroGrande tamanho="pequeno" valor="92%" legenda="avaliações 5★" />
          </div>
        </Card>
      </Secao>

      <Secao titulo="Barra de navegação inferior">
        <p className="text-sm text-muted-foreground">
          Na próxima etapa ela fica fixa no rodapé do celular. Aqui, com badge de número em
          Conversas e ponto em Avisos.
        </p>
        <div className="overflow-hidden rounded-card border border-border">
          <BarraDeNavegacaoInferior itens={ABAS} fixa={false} />
        </div>
      </Secao>
    </div>
  );
}
