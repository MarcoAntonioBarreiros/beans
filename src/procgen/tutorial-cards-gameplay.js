const page = (title, body, points = []) => ({ title, body, points });
const card = (id, category, title, subtitle, glyph, accent, pages, cycle = [], cycleLabel = 'Ciclo ou etapas') => ({
  id, category, title, subtitle, glyph, accent, pages, cycle, cycleLabel,
});

export const gameplayTutorialCards = {
  "system-welcome": card(
    "system-welcome",
    "Guia didático",
    "Rizosfera Viva",
    "Uma aventura microscópica sob o solo",
    "◈",
    "#70e5d6",
    [
      page("Bem-vindo à rizosfera", "Você encolheu até o tamanho de um microrganismo. Aqui, a superfície da raiz é um mundo vivo: bactérias, fungos e nematoides competem, cooperam e mudam a saúde da planta."),
      page(
        "Cartões de descoberta",
        "Quando algo importante aparece pela primeira vez, o jogo pausa e abre um cartão. Leia no seu ritmo: nenhuma ameaça continua se movendo enquanto o cartão estiver aberto.",
        [
          "Use as setas para avançar ou voltar.",
          "Os cartões descobertos ficam guardados na Biblioteca.",
        ],
      ),
      page(
        "Ciência + videogame",
        "Algumas ações representam processos biológicos reais. Outras são metáforas de plataforma criadas para transformar fenômenos microscópicos em desafios visíveis e jogáveis.",
        [
          "O cartão explica o que é real e o que foi adaptado.",
          "Observar o cenário ajuda a entender a estratégia.",
        ],
      ),
    ],
    [
      "Descoberta",
      "Pausa",
      "Aprendizagem",
      "Retorno ao jogo",
    ],
    "Fluxo do tutorial",
  ),

  "action-exudate": card(
    "action-exudate",
    "Ação",
    "Exsudato radicular",
    "Carbono e sinais liberados pela raiz",
    "C",
    "#b7f36b",
    [
      page("Pacotes químicos da raiz", "Exsudatos são compostos liberados pelas raízes, como açúcares, aminoácidos, ácidos orgânicos e moléculas sinalizadoras. Eles criam uma zona de intensa atividade ao redor da raiz."),
      page(
        "Alimento e mensagem",
        "Esses compostos alimentam parte da microbiota e também funcionam como sinais. A raiz influencia quais organismos se aproximam, permanecem e atuam na rizosfera.",
        [
          "Podem favorecer aliados benéficos.",
          "Também podem atrair organismos indesejados, como juvenis de nematoides.",
        ],
      ),
      page("Poder no jogo", "Pressione E para liberar um exsudato. Ele recruta microrganismos, sustenta colônias e orienta o crescimento de algumas estruturas."),
      page(
        "Estratégia",
        "Use perto do aliado que deseja recrutar ou de uma colônia que esteja perdendo atividade. Durante uma infestação, evite lançar exsudatos sem proteção perto de raízes vulneráveis.",
        [
          "Exsudato é recurso: escolha o local antes de usar.",
          "Colônias ativas transformam carbono em funções úteis.",
        ],
      ),
    ],
    [
      "Liberação pela raiz",
      "Difusão",
      "Atração microbiana",
      "Consumo",
    ],
    "Destino do exsudato",
  ),

  "action-inoculation": card(
    "action-inoculation",
    "Ação",
    "Inoculação",
    "Leve o aliado até o lugar onde ele pode agir",
    "E",
    "#8debdc",
    [
      page("O que significa?", "Inocular é introduzir deliberadamente um microrganismo em um ambiente, superfície ou hospedeiro. No campo, isso pode ser feito em sementes, sulcos, solo ou plantas."),
      page(
        "Poder no jogo",
        "Depois de recrutar um organismo, transporte-o até a raiz ou plataforma desejada e pressione E. O resultado depende da espécie e do local escolhido.",
        [
          "Rhizobium precisa de uma raiz compatível para formar nódulos.",
          "Bacillus constrói biofilmes protetores.",
          "Pseudomonas explora ferro e reduz a força de competidores.",
          "Trichoderma cresce em direção a alvos expostos.",
        ],
      ),
      page("Escolha antes de agir", "Inocular não é apenas soltar um personagem. Pergunte: qual raiz está ameaçada, qual função está faltando e onde o organismo terá alimento para permanecer ativo?"),
      page("Estratégia", "Proteger uma raiz antes da invasão costuma custar menos do que recuperá-la depois. Distribua aliados em pontos úteis em vez de concentrar todos no mesmo lugar."),
    ],
    [
      "Recrutamento",
      "Transporte",
      "Inoculação",
      "Colonização",
    ],
    "Etapas no jogo",
  ),

  "power-double-jump": card(
    "power-double-jump",
    "Poder",
    "Salto duplo",
    "Corrija a trajetória e alcance raízes mais altas",
    "↑↑",
    "#72e8dd",
    [
      page("Novo movimento", "O segundo salto permite ganhar altura ou corrigir a trajetória quando Miguelito já está no ar. Ele abre rotas que antes pareciam impossíveis."),
      page(
        "Como usar",
        "Salte normalmente e pressione o botão de pulo outra vez antes de tocar o chão.",
        [
          "Use cedo para ganhar altura.",
          "Use tarde para corrigir uma queda ou alcançar a borda.",
        ],
      ),
      page("Metáfora biológica", "O salto duplo é uma mecânica de videogame. Ele simboliza as novas possibilidades de exploração criadas quando o sistema radicular desenvolve mais caminhos."),
    ],
    [
      "Primeiro salto",
      "Correção no ar",
      "Segundo impulso",
      "Aterrissagem",
    ],
    "Sequência de uso",
  ),

  "power-dash": card(
    "power-dash",
    "Poder",
    "Dash",
    "Um impulso rápido para cruzar perigo",
    "≫",
    "#6ce7df",
    [
      page("Novo movimento", "O dash lança Miguelito rapidamente na horizontal. Ele serve para atravessar vãos, escapar de ataques e alcançar plataformas antes que uma ameaça feche o caminho."),
      page("Como usar", "Escolha a direção e acione o dash durante a corrida ou no ar. Planeje onde vai aterrissar: velocidade sem destino pode levar direto para outro risco."),
      page("Quando fica bloqueado", "Contaminação fúngica intensa ou o transporte de dois juvenis J2 pode impedir o dash temporariamente. Limpe a contaminação e livre-se dos passageiros indesejados."),
      page("Metáfora biológica", "O dash é uma mecânica de plataforma. No jogo, ele representa maior mobilidade em uma rede radicular funcional, não um processo literal da planta."),
    ],
    [
      "Preparação",
      "Impulso",
      "Travessia",
      "Recarga",
    ],
    "Sequência de uso",
  ),

  "power-jetpack": card(
    "power-jetpack",
    "Poder",
    "Propulsão da Rizósfera",
    "Energia emprestada por raízes saudáveis",
    "▲",
    "#8ef0c6",
    [
      page("Decole com estratégia", "Segure PROPULSOR enquanto estiver no ar para planar ou ganhar altura. A energia é limitada, por isso pulsos curtos costumam render mais distância do que manter o botão pressionado."),
      page(
        "Recarregue na raiz",
        "Fique apoiado sobre uma raiz elegível. A saúde da raiz define o limite da carga, e organismos benéficos podem acelerar a recarga.",
        [
          "Abaixo de 70% de saúde, a raiz não consegue fornecer energia.",
          "Raízes totalmente saudáveis podem completar o tanque.",
        ],
      ),
      page("Rede de aliados", "Nódulos, Azospirillum, micorriza, Bacillus e Pseudomonas contribuem de maneiras diferentes para manter a raiz funcional. Uma comunidade equilibrada transforma o cenário em uma rede de recarga."),
      page("Metáfora biológica", "A mochila propulsora não existe no solo. Ela representa, como recurso de videogame, que raízes vigorosas sustentam mais atividade e abrem novas possibilidades na rizosfera."),
    ],
    [
      "Raiz saudável",
      "Conexão",
      "Carga",
      "Propulsão",
    ],
    "Sequência de uso",
  ),

  "power-pulse": card(
    "power-pulse",
    "Poder",
    "Pulso de solubilização",
    "Metabólitos liberam fósforo preso no mineral",
    "✦",
    "#ffb15c",
    [
      page("Selecione o poder", "Escolha Solubilização P no seletor. Somente essa opção transforma o comando E em uma ação de carregar e disparar."),
      page("Carregue na colônia", "Segure E perto de uma colônia madura da cepa solubilizadora. A carga usa a reserva de metabólitos produzida pela colônia, que se recupera mais rápido quando recebe exsudatos."),
      page("Mire no depósito", "Solte E para lançar o pulso na direção de Miguelito. O efeito alcança depósitos de fosfato e libera gradualmente o P que estava pouco disponível."),
      page(
        "Complete a missão",
        "Solubilizar não significa transportar. O fosfato permanece no local até que uma rede micorrízica funcional o leve ao arbúsculo e à raiz.",
        [
          "O pulso não elimina patógenos.",
          "Solubilização e transporte são tarefas diferentes.",
        ],
      ),
    ],
    [
      "Selecionar",
      "Carregar",
      "Disparar",
      "Solubilizar",
      "Transportar",
    ],
    "Etapas no jogo",
  ),

  "process-root-health": card(
    "process-root-health",
    "Sistema de jogo",
    "Saúde da raiz",
    "A condição de cada plataforma viva",
    "♥",
    "#ffd36f",
    [
      page(
        "Leia o estado da raiz",
        "Cada raiz possui saúde própria. A aparência, o fluxo interno e as barras indicam se ela está saudável, estressada, comprometida ou próxima do colapso.",
        [
          "Saudável: 75–100%.",
          "Estressada: 50–74%.",
          "Comprometida: 25–49%.",
          "Em colapso: abaixo de 25%.",
        ],
      ),
      page("O que causa dano?", "Meloidogyne, Rhizoctonia, Ralstonia e outras pressões reduzem a função dos tecidos. Algumas deixam sequelas que diminuem até o máximo recuperável."),
      page("O que ajuda?", "Nódulos ativos, arbúsculos, biofilmes e controle de patógenos favorecem a recuperação. Nenhum aliado resolve tudo sozinho: observe qual problema está ativo."),
      page("Saúde local e Vigor da Planta", "A saúde pertence a cada raiz. O Vigor da Planta reúne o resultado de todo o sistema e influencia a aparência da parte aérea e a futura colheita."),
    ],
    [
      "Saudável",
      "Estressada",
      "Comprometida",
      "Colapso",
      "Recuperação parcial",
    ],
    "Estados possíveis",
  ),

  "process-root-recovery": card(
    "process-root-recovery",
    "Processo",
    "Recuperação radicular",
    "O retorno gradual da função",
    "↟",
    "#9bea8f",
    [
      page("Sinais de recuperação", "Fluxos verde-dourados, retorno dos pelos e contorno mais vivo indicam que a raiz está recuperando função. A mudança é gradual, não instantânea."),
      page("Como acontece no jogo", "Controle a causa do dano e mantenha os aliados adequados ativos. Nódulos ajudam no suporte metabólico, micorriza melhora aquisição e sustentação, e biofilmes reduzem novas agressões."),
      page("Limites do reparo", "Uma raiz não ultrapassa seu máximo recuperável. Galhas maduras podem deixar sequelas permanentes, enquanto murcha vascular avançada reduz fortemente a capacidade de recuperação."),
      page("Missão do jogador", "Não espere a plataforma começar a ceder. Interrompa a pressão, restaure o fluxo e estabilize a comunidade antes de seguir para a próxima região."),
    ],
    [
      "Controle da pressão",
      "Retorno do fluxo",
      "Reparo parcial",
      "Nova estabilidade",
    ],
  ),

  "process-root-collapse": card(
    "process-root-collapse",
    "Efeito",
    "Perda de sustentação",
    "Quando uma raiz viva deixa de ser uma plataforma segura",
    "⌄",
    "#ff657f",
    [
      page("Alerta de colapso", "Uma raiz criticamente comprometida pode afundar, oscilar e ceder sob Miguelito. Os sinais visuais aparecem antes da queda completa."),
      page("Base biológica", "Doenças radiculares prejudicam continuidade, resistência e função dos tecidos. O cedimento como plataforma é uma metáfora visual criada para tornar esse prejuízo jogável."),
      page("Consequência no jogo", "O apoio pode desaparecer por alguns instantes, interromper rotas e lançar Miguelito para áreas perigosas."),
      page("Como evitar", "Controle a causa do dano e favoreça estruturas que aumentem estabilidade, como micorriza madura. Uma raiz em colapso exige prioridade, não apenas passagem rápida."),
    ],
    [
      "Dano acumulado",
      "Perda de integridade",
      "Afundamento",
      "Cedimento",
      "Recuperação ou falha",
    ],
  ),

};
