const updatedAt = '13 de agosto de 2026';

const sections = [
  {
    title: '1. Aceitação e objeto',
    paragraphs: [
      'Estes Termos de Serviço regulam o acesso e o uso do Vigion Cloud, plataforma de monitoramento em nuvem que permite administrar organizações, usuários, câmeras, gateways, transmissões, eventos, alertas e armazenamento conforme o plano contratado.',
      'Ao criar uma conta, aceitar um convite, contratar um plano ou utilizar a plataforma, você declara que leu e concorda com estes Termos e com a Política de Privacidade. Se estiver representando uma empresa ou organização, declara possuir poderes para vinculá-la.',
    ],
  },
  {
    title: '2. Elegibilidade, conta e organização',
    bullets: [
      'A conta deve ser criada e administrada por pessoa legalmente capaz e com informações verdadeiras e atualizadas.',
      'Cada usuário deve utilizar credenciais próprias, manter sua senha protegida e comunicar imediatamente qualquer acesso suspeito.',
      'O responsável pela organização administra convites, funções, permissões, equipamentos e uso realizado pelos demais usuários.',
      'Você não deve compartilhar sessões, contornar controles de acesso ou permitir o uso da conta por pessoas não autorizadas.',
      'Podemos solicitar confirmação de identidade ou titularidade para proteger a conta e atender obrigações legais.',
    ],
  },
  {
    title: '3. Instalação e uso do monitoramento',
    paragraphs: [
      'A organização é responsável pela instalação, posicionamento, conectividade, alimentação elétrica e manutenção de câmeras, gateways e redes sob seu controle. Também é responsável por possuir autorizações e fundamentos jurídicos adequados para captar, visualizar, gravar e compartilhar imagens, sons ou eventos.',
      'O Vigion não orienta o monitoramento clandestino nem o uso de câmeras em locais com expectativa incompatível de privacidade. O cliente deve avaliar sinalização, acesso às imagens e regras aplicáveis a residências, condomínios, empresas, empregados, crianças e áreas públicas.',
    ],
  },
  {
    title: '4. Planos, limites e disponibilidade de recursos',
    paragraphs: [
      'Os recursos e limites são definidos pelo plano vigente na plataforma. Atualmente: FREE, 1 câmera e retenção de 1 dia; BASIC, 3 câmeras e 7 dias; PRO, 8 câmeras e 15 dias; BUSINESS, 20 câmeras e 30 dias. Outros limites, como usuários, armazenamento e funcionalidades, são exibidos na conta antes da contratação.',
      'O uso acima dos limites pode bloquear novos cadastros, uploads ou funcionalidades até que o consumo seja reduzido ou o plano seja alterado. Mudanças futuras de preço ou composição de planos serão informadas de forma adequada e não alteram retroativamente períodos já pagos.',
    ],
  },
  {
    title: '5. Assinaturas, pagamentos e renovação',
    bullets: [
      'Planos pagos são assinaturas recorrentes mensais processadas pelo Stripe.',
      'Ao contratar, você autoriza as cobranças recorrentes do plano selecionado até o cancelamento.',
      'Dados completos do cartão são coletados pelo Stripe e não são armazenados pelo Vigion.',
      'Tributos, documentos e valores aplicáveis serão apresentados no checkout ou na área de cobrança.',
      'Falha de pagamento pode colocar a assinatura em atraso, restringir recursos pagos ou resultar em suspensão conforme as tentativas e o estado informado pelo Stripe.',
      'Upgrade e downgrade utilizam a assinatura existente quando aplicável. Ajustes proporcionais, créditos e datas de cobrança são calculados pelo Stripe e apresentados no fluxo correspondente.',
    ],
  },
  {
    title: '6. Cancelamento e encerramento',
    paragraphs: [
      'O cancelamento de uma assinatura paga pode ser solicitado pela área de cobrança. Quando agendado para o final do período, os recursos pagos permanecem até a data indicada e a renovação seguinte deixa de ocorrer. Encerrado o período, a organização poderá retornar aos limites do FREE.',
      'O cancelamento não apaga automaticamente câmeras, usuários ou mídias no mesmo instante. Dados que excedam a retenção ou os limites aplicáveis podem deixar de ficar disponíveis conforme o ciclo operacional, a Política de Privacidade e obrigações legais. Solicitações de reembolso serão avaliadas conforme a legislação aplicável, as condições apresentadas na contratação e o efetivo uso do serviço.',
    ],
  },
  {
    title: '7. Uso aceitável',
    paragraphs: ['É proibido usar o Vigion Cloud para:'],
    bullets: [
      'Violar privacidade, proteção de dados, propriedade intelectual ou qualquer lei aplicável.',
      'Monitorar pessoas ou espaços sem autorização ou fundamento jurídico quando exigidos.',
      'Praticar perseguição, discriminação, assédio, fraude, extorsão ou atividade criminosa.',
      'Enviar malware, explorar vulnerabilidades, realizar engenharia reversa indevida ou comprometer contas e infraestrutura.',
      'Interferir na disponibilidade, ultrapassar limites técnicos de forma automatizada ou contornar controles de plano e segurança.',
      'Revender, sublicenciar ou disponibilizar o serviço como se fosse próprio sem autorização contratual.',
      'Inserir conteúdo ilícito ou credenciais de terceiros sem permissão.',
    ],
  },
  {
    title: '8. Alertas, detecções e limitações técnicas',
    paragraphs: [
      'Detecção de movimento, classificações, alertas e recursos de inteligência são ferramentas auxiliares e podem produzir falsos positivos, falsos negativos, atrasos ou indisponibilidade. O desempenho depende de câmera, iluminação, conexão, configuração, ambiente e serviços externos.',
      'O Vigion não é central pública de emergência, empresa de vigilância presencial, seguradora ou garantia de prevenção de crimes, acidentes ou perdas. Em risco imediato, contate os serviços públicos competentes. O cliente deve manter medidas físicas e operacionais apropriadas e não depender exclusivamente da plataforma.',
    ],
  },
  {
    title: '9. Disponibilidade, manutenção e alterações',
    paragraphs: [
      'Buscamos manter a plataforma disponível e segura, mas não prometemos operação ininterrupta. Podem ocorrer manutenções, atualizações, falhas de internet, energia, equipamentos, provedores ou eventos fora do nosso controle. Quando possível, manutenções relevantes serão planejadas para reduzir impacto.',
      'Podemos ajustar funcionalidades para segurança, conformidade, desempenho ou evolução do serviço, preservando a finalidade principal do plano contratado. Recursos experimentais poderão ser modificados ou descontinuados.',
    ],
  },
  {
    title: '10. Dados, conteúdo e privacidade',
    paragraphs: [
      'O cliente mantém seus direitos sobre conteúdos e dados enviados à plataforma e concede ao Vigion autorização limitada para armazenar, processar, transmitir e apresentar essas informações somente na medida necessária para fornecer, proteger e melhorar o serviço.',
      'O tratamento de dados pessoais segue a Política de Privacidade. O cliente é responsável pelas instruções, bases legais, avisos e solicitações relacionadas às imagens e demais dados cujo tratamento determinar. O Vigion poderá cooperar com pedidos de titulares e autoridades conforme a legislação.',
    ],
  },
  {
    title: '11. Propriedade intelectual',
    paragraphs: [
      'A plataforma, marca, código, interface, documentação e demais componentes do Vigion pertencem aos seus respectivos titulares e são protegidos pela legislação aplicável. Estes Termos concedem apenas uma licença limitada, revogável, não exclusiva e intransferível para utilizar o serviço durante a vigência da conta ou assinatura.',
      'Sugestões enviadas voluntariamente podem ser utilizadas para aprimorar o produto sem transferir ao Vigion os direitos sobre conteúdos privados do cliente.',
    ],
  },
  {
    title: '12. Suspensão e medidas de proteção',
    paragraphs: [
      'Podemos restringir ou suspender acessos quando houver risco à segurança, violação destes Termos, uso ilegal, fraude, inadimplência, determinação de autoridade ou necessidade urgente de proteger usuários e infraestrutura. Sempre que razoável, informaremos o motivo e permitiremos correção antes de medida definitiva.',
      'A suspensão não elimina obrigações já constituídas. Podemos preservar registros necessários para investigar incidentes, exercer direitos e cumprir obrigações legais.',
    ],
  },
  {
    title: '13. Responsabilidades e limitação',
    paragraphs: [
      'Cada parte responde pelos danos diretos que comprovadamente causar em violação à lei ou a estes Termos, observados os limites permitidos pela legislação. O Vigion não responde por instalação inadequada, equipamentos e redes do cliente, atos de usuários autorizados, uso ilegal, indisponibilidade de terceiros ou eventos inevitáveis fora de seu controle.',
      'Na máxima extensão permitida, não respondemos por lucros cessantes, perda indireta, expectativa de prevenção de evento, falha de equipamento externo ou decisão tomada exclusivamente com base em alerta automatizado. Nada nestes Termos exclui responsabilidade que não possa ser legalmente limitada, nem direitos obrigatórios do consumidor.',
    ],
  },
  {
    title: '14. Alterações dos Termos',
    paragraphs: [
      'Podemos atualizar estes Termos por razões legais, técnicas ou comerciais. A versão vigente será publicada nesta URL com a data de atualização. Alterações materiais poderão ser comunicadas na plataforma ou pelo e-mail cadastrado. O uso continuado após a vigência indica concordância, sem prejuízo dos direitos assegurados por lei.',
    ],
  },
  {
    title: '15. Lei aplicável e solução de conflitos',
    paragraphs: [
      'Estes Termos são interpretados conforme as leis da República Federativa do Brasil. Antes de iniciar disputa, as partes buscarão solução de boa-fé pelos canais de suporte. Direitos de consumidores, competência legal obrigatória e acesso a órgãos administrativos ou judiciais permanecem preservados.',
    ],
  },
];

export function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <a href="/" className="text-xl font-bold tracking-tight">
            Vigi<span className="text-emerald-400">On</span>
          </a>
          <div className="flex items-center gap-2 text-sm">
            <a
              href="/suporte"
              className="rounded-lg px-3 py-2 text-slate-300 hover:text-emerald-300"
            >
              Suporte
            </a>
            <a
              href="/"
              className="rounded-lg border border-slate-700 px-4 py-2 hover:border-emerald-400"
            >
              Voltar
            </a>
          </div>
        </div>
      </header>

      <section className="border-b border-slate-800 bg-emerald-400/5 px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm font-semibold uppercase tracking-[.22em] text-emerald-400">
            Regras de utilização
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Termos de Serviço</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
            Estes Termos apresentam as condições para criar uma conta, contratar planos e utilizar
            os recursos de monitoramento do Vigion Cloud.
          </p>
          <p className="mt-5 text-sm text-slate-500">Última atualização: {updatedAt}</p>
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[220px_1fr]">
        <aside className="self-start rounded-xl border border-slate-800 bg-slate-900 p-5 lg:sticky lg:top-5">
          <p className="font-semibold">Dúvidas sobre os Termos</p>
          <a
            className="mt-3 block break-all text-sm text-emerald-400"
            href="mailto:suporte@vigion.cloud?subject=Termos%20de%20Servi%C3%A7o"
          >
            suporte@vigion.cloud
          </a>
          <div className="mt-5 space-y-2 border-t border-slate-800 pt-5 text-sm text-slate-400">
            <a className="block hover:text-emerald-300" href="/privacidade">
              Política de Privacidade
            </a>
            <a className="block hover:text-emerald-300" href="/suporte">
              Central de Suporte
            </a>
          </div>
        </aside>

        <article className="space-y-10">
          <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6 text-sm leading-6 text-amber-100">
            O Vigion é uma ferramenta de monitoramento e não substitui serviços de emergência,
            vigilância presencial ou medidas físicas de segurança.
          </section>
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-2xl font-bold">{section.title}</h2>
              <div className="mt-4 space-y-4 text-base leading-7 text-slate-300">
                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets && (
                  <ul className="list-disc space-y-2 pl-6 marker:text-emerald-400">
                    {section.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
          <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-6 sm:p-8">
            <h2 className="text-2xl font-bold">16. Contato</h2>
            <p className="mt-4 leading-7 text-slate-300">
              Para dúvidas, solicitações ou tentativa de solução, escreva para{' '}
              <a className="font-semibold text-emerald-400" href="mailto:suporte@vigion.cloud">
                suporte@vigion.cloud
              </a>{' '}
              ou acesse a{' '}
              <a className="text-emerald-400" href="/suporte">
                Central de Suporte
              </a>
              .
            </p>
          </section>
        </article>
      </div>

      <footer className="border-t border-slate-800 px-5 py-8 text-sm text-slate-500 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} Vigion Cloud</span>
          <div className="flex gap-5">
            <a href="/privacidade">Privacidade</a>
            <a href="/suporte">Suporte</a>
            <a href="/">Plataforma</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
