import { BrandName } from '../branding/BrandName';

const updatedAt = '13 de agosto de 2026';

const sections = [
  {
    title: '1. Quem somos e a quem esta política se aplica',
    paragraphs: [
      'Esta Política de Privacidade descreve como o VigiOn Cloud trata informações relacionadas aos visitantes do site, titulares de contas, usuários convidados e pessoas que possam aparecer em imagens ou eventos de monitoramento processados pela plataforma.',
      'Para dados de cadastro, acesso, suporte e relacionamento comercial, o VigiOn determina as finalidades essenciais do tratamento. Para imagens, gravações e eventos captados por câmeras de uma organização cliente, essa organização normalmente define a finalidade do monitoramento e atua como controladora; o VigiOn fornece a infraestrutura e processa os dados conforme suas instruções e a configuração do serviço.',
    ],
  },
  {
    title: '2. Informações que podemos coletar',
    bullets: [
      'Cadastro e perfil: nome, e-mail, organização, função, preferências, fuso horário e situação da conta.',
      'Autenticação e segurança: hash da senha, sessões, endereço IP, navegador, registros de acesso e auditoria. Não armazenamos senhas em texto simples.',
      'Monitoramento: nomes e configurações de câmeras e gateways, imagens, gravações, eventos, alertas, classificações, horários e metadados técnicos enviados pela organização.',
      'Uso do serviço: consumo de armazenamento, quantidade de usuários e câmeras, recursos utilizados, falhas técnicas e registros necessários para operação e prevenção de abuso.',
      'Assinatura e cobrança: plano, Customer e Subscription IDs, status, invoices, valores e datas. Dados completos do cartão e CVC são coletados pelo Stripe e não são armazenados pelo VigiOn.',
      'Atendimento: endereço de e-mail, conteúdo da solicitação, anexos e histórico das comunicações enviadas ao suporte.',
      'Dispositivo e notificações: identificadores técnicos e assinatura de push quando o usuário habilita notificações no navegador ou dispositivo.',
    ],
  },
  {
    title: '3. Como coletamos',
    paragraphs: [
      'As informações são fornecidas diretamente no cadastro e no suporte, geradas durante o uso da plataforma, enviadas por câmeras e gateways configurados pela organização ou recebidas de prestadores que executam etapas do serviço, como confirmação de pagamento e entrega de e-mail.',
      'Usamos cookies estritamente necessários e tokens de sessão para autenticar o usuário e proteger o acesso. A plataforma não depende de cookies publicitários para funcionar.',
    ],
  },
  {
    title: '4. Como usamos as informações',
    bullets: [
      'Criar e administrar contas, organizações, permissões e sessões autenticadas.',
      'Conectar equipamentos e oferecer visualização, armazenamento, detecção de eventos, alertas e histórico de monitoramento.',
      'Aplicar limites e recursos do plano contratado e processar assinaturas recorrentes.',
      'Enviar mensagens transacionais, alertas solicitados e comunicações de segurança ou suporte.',
      'Diagnosticar falhas, prevenir fraude e abuso, preservar a disponibilidade e investigar incidentes.',
      'Cumprir obrigações legais, regulatórias, fiscais e responder a solicitações legítimas de autoridades.',
      'Produzir métricas operacionais agregadas para melhorar desempenho e confiabilidade, sempre que possível sem identificar pessoas.',
    ],
  },
  {
    title: '5. Bases e critérios do tratamento',
    paragraphs: [
      'Conforme o contexto, o tratamento pode ser necessário para executar o contrato e fornecer o serviço, cumprir obrigações legais ou regulatórias, exercer direitos, proteger a vida ou a segurança, atender interesses legítimos com avaliação dos direitos do titular ou cumprir uma escolha baseada em consentimento quando ele for aplicável.',
      'A organização cliente é responsável por possuir fundamento jurídico adequado, prestar avisos e respeitar as regras aplicáveis ao instalar câmeras e monitorar pessoas e ambientes sob sua responsabilidade.',
    ],
  },
  {
    title: '6. Com quem compartilhamos e como ocorre a divulgação',
    paragraphs: [
      'Não vendemos dados pessoais. Compartilhamos somente o necessário para operar o serviço, cumprir a lei ou proteger direitos. A transmissão ocorre por conexões protegidas, APIs autenticadas, painéis de fornecedores ou outros mecanismos compatíveis com a finalidade.',
    ],
    bullets: [
      'Stripe: checkout, assinatura, cobrança, invoices e prevenção de fraude.',
      'Resend e provedores de e-mail: envio de mensagens transacionais e atendimento.',
      'Cloudflare: DNS, proteção, entrega de conteúdo e roteamento de e-mail.',
      'Oracle Cloud e infraestrutura contratada: execução da aplicação, banco de dados, logs, backups e armazenamento privado.',
      'Usuários autorizados da própria organização, de acordo com funções e permissões configuradas.',
      'Autoridades, reguladores, assessores ou partes necessárias quando houver obrigação legal, ordem válida, exercício de direitos ou investigação de abuso e incidente.',
      'Sucessores empresariais em eventual reorganização, fusão ou aquisição, sujeitos a confidencialidade e às proteções aplicáveis.',
    ],
  },
  {
    title: '7. Transferências e localização',
    paragraphs: [
      'Alguns prestadores podem tratar informações em outras localidades. Nesses casos, buscamos utilizar fornecedores com medidas contratuais, técnicas e organizacionais adequadas e limitar os dados ao necessário para a prestação contratada.',
    ],
  },
  {
    title: '8. Retenção e exclusão',
    paragraphs: [
      'Mantemos dados pelo período necessário à prestação do serviço, à segurança, ao cumprimento de obrigações legais e ao exercício de direitos. Imagens e gravações seguem a retenção do plano e a configuração aplicável: FREE 1 dia, BASIC 7 dias, PRO 15 dias e BUSINESS 30 dias, salvo necessidade legítima de preservação ou configuração contratual específica.',
      'Após cancelamento ou solicitação válida, os dados são excluídos ou anonimizados de forma compatível com a arquitetura e os prazos operacionais. Informações podem permanecer temporariamente em backups protegidos e registros obrigatórios até a expiração do respectivo ciclo ou prazo legal. Cancelar uma assinatura não apaga automaticamente os dados no mesmo instante.',
    ],
  },
  {
    title: '9. Segurança da informação',
    bullets: [
      'Criptografia de transporte por HTTPS e armazenamento protegido de credenciais sensíveis de equipamentos.',
      'Senhas armazenadas por hash resistente; sessões com expiração e possibilidade de revogação.',
      'Isolamento multi-tenant e consultas vinculadas à organização autenticada.',
      'Controle de acesso por função e permissões, logs de auditoria e validação de entradas.',
      'Mídia privada com acesso temporário, limites de uso, backups e restrição de acesso à infraestrutura.',
      'Assinaturas criptográficas e idempotência para webhooks financeiros.',
    ],
    paragraphs: [
      'Nenhum sistema é absolutamente invulnerável. Mantemos medidas proporcionais aos riscos e revisamos controles para reduzir acesso, alteração, divulgação ou destruição não autorizados. Incidentes relevantes serão avaliados e comunicados conforme a legislação aplicável.',
    ],
  },
  {
    title: '10. Direitos dos titulares',
    paragraphs: [
      'Nos limites da legislação aplicável, você pode solicitar confirmação e acesso, correção, informação sobre compartilhamentos, anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade, portabilidade quando regulamentada, oposição, revogação do consentimento e revisão de decisões exclusivamente automatizadas.',
      'Poderemos solicitar informações para confirmar identidade e legitimidade do pedido. Quando o tratamento de imagens for determinado por uma organização cliente, encaminharemos ou cooperaremos com essa organização para atender a solicitação.',
    ],
  },
  {
    title: '11. Crianças, espaços monitorados e responsabilidades',
    paragraphs: [
      'O serviço é destinado à contratação e administração por pessoas capazes e organizações. O VigiOn não orienta a instalação de câmeras em locais onde haja expectativa incompatível de privacidade. A organização cliente deve avaliar sinalização, acesso, proporcionalidade e regras específicas quando o monitoramento puder envolver crianças, adolescentes, empregados ou áreas de acesso público.',
    ],
  },
  {
    title: '12. Atualizações desta política',
    paragraphs: [
      'Podemos atualizar esta política para refletir mudanças legais, técnicas ou operacionais. A versão vigente será publicada nesta URL com a data da última atualização. Mudanças relevantes poderão ser comunicadas pela plataforma ou pelo e-mail cadastrado.',
    ],
  },
];

export function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <a href="/">
            <BrandName className="text-xl" />
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
            Privacidade e proteção de dados
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Política de Privacidade
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
            Esta política explica quais informações o VigiOn Cloud trata, para quais finalidades,
            com quem podem ser compartilhadas e quais medidas adotamos para protegê-las.
          </p>
          <p className="mt-5 text-sm text-slate-500">Última atualização: {updatedAt}</p>
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[220px_1fr]">
        <aside className="self-start rounded-xl border border-slate-800 bg-slate-900 p-5 lg:sticky lg:top-5">
          <p className="font-semibold">Contato de privacidade</p>
          <a
            className="mt-3 block break-all text-sm text-emerald-400"
            href="mailto:privacidade@vigion.cloud"
          >
            privacidade@vigion.cloud
          </a>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Para incidentes de segurança: security@vigion.cloud
          </p>
        </aside>

        <article className="space-y-10">
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
            <h2 className="text-2xl font-bold">13. Fale conosco</h2>
            <p className="mt-4 leading-7 text-slate-300">
              Para exercer direitos ou esclarecer dúvidas sobre privacidade, escreva para{' '}
              <a className="font-semibold text-emerald-400" href="mailto:privacidade@vigion.cloud">
                privacidade@vigion.cloud
              </a>
              . Para suporte geral, acesse nossa{' '}
              <a className="text-emerald-400" href="/suporte">
                Central de Suporte
              </a>
              .
            </p>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              Você também pode consultar orientações e canais oficiais da Autoridade Nacional de
              Proteção de Dados em gov.br/anpd.
            </p>
          </section>
        </article>
      </div>

      <footer className="border-t border-slate-800 px-5 py-8 text-sm text-slate-500 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} <BrandName cloud /></span>
          <div className="flex gap-5">
            <a href="/termos">Termos</a>
            <a href="/suporte">Suporte</a>
            <a href="/">Plataforma</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
