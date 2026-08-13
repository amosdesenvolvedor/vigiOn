const supportEmail = 'suporte@vigion.cloud';

const channels = [
  {
    title: 'Suporte técnico',
    description: 'Ajuda com câmeras, gateways, transmissão, eventos e notificações.',
    subject: 'Suporte técnico — Vigion Cloud',
    action: 'Solicitar suporte',
  },
  {
    title: 'Conta e acesso',
    description: 'Recuperação de acesso, organizações, usuários e permissões.',
    subject: 'Conta e acesso — Vigion Cloud',
    action: 'Falar sobre minha conta',
  },
  {
    title: 'Planos e cobrança',
    description: 'Dúvidas sobre planos, assinatura, pagamento, upgrade ou cancelamento.',
    subject: 'Planos e cobrança — Vigion Cloud',
    action: 'Tirar dúvida de cobrança',
  },
];

const questions = [
  {
    question: 'O que devo informar ao abrir um chamado?',
    answer:
      'Informe o e-mail da conta, nome da organização, equipamento afetado, horário aproximado e uma descrição do que aconteceu. Anexe capturas de tela quando possível.',
  },
  {
    question: 'Posso enviar senhas ou dados do cartão?',
    answer:
      'Não. A equipe Vigion nunca solicitará sua senha, código de autenticação, chave de câmera, número completo do cartão ou CVC por e-mail.',
  },
  {
    question: 'Como acompanho um problema de pagamento?',
    answer:
      'Envie o e-mail da conta e a data aproximada da cobrança. Não envie dados completos do cartão. Pagamentos e assinaturas são processados com segurança pelo Stripe.',
  },
  {
    question: 'O Vigion substitui serviços de emergência?',
    answer:
      'Não. Em situação de risco imediato, procure os serviços públicos de emergência da sua região. O suporte Vigion atende questões relacionadas à plataforma.',
  },
];

const mailto = (subject: string) =>
  `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    'Olá, equipe Vigion.\n\nOrganização:\nE-mail da conta:\nDescrição da dúvida ou problema:\nHorário aproximado:\n\n',
  )}`;

export function SupportPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90 px-5 py-5 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/" className="text-xl font-bold tracking-tight" aria-label="Vigion Cloud">
            Vigi<span className="text-emerald-400">On</span>
          </a>
          <a
            href="/"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-emerald-400 hover:text-emerald-300"
          >
            Acessar plataforma
          </a>
        </div>
      </header>

      <section className="border-b border-slate-800 bg-gradient-to-b from-emerald-400/10 to-transparent px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[.25em] text-emerald-400">
            Central de suporte
          </p>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-6xl">
            Como podemos ajudar?
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Encontre o canal certo para dúvidas sobre sua conta, monitoramento, equipamentos, planos
            e pagamentos.
          </p>
          <a
            href={mailto('Atendimento — Vigion Cloud')}
            className="mt-9 inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-400 px-6 font-semibold text-slate-950 transition hover:bg-emerald-300"
          >
            Enviar e-mail para o suporte
          </a>
          <p className="mt-4 text-sm text-slate-400">{supportEmail}</p>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.2em] text-emerald-400">
              Canais de atendimento
            </p>
            <h2 className="mt-3 text-3xl font-bold">Escolha o assunto do contato</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {channels.map((channel) => (
              <article
                key={channel.title}
                className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900 p-6"
              >
                <div className="grid size-11 place-items-center rounded-xl bg-emerald-400/10 text-xl text-emerald-300">
                  ?
                </div>
                <h3 className="mt-5 text-xl font-semibold">{channel.title}</h3>
                <p className="mt-3 flex-1 leading-7 text-slate-400">{channel.description}</p>
                <a
                  href={mailto(channel.subject)}
                  className="mt-6 font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  {channel.action} →
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-800 bg-slate-900/40 px-5 py-16 sm:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.2em] text-emerald-400">
              Antes de enviar
            </p>
            <h2 className="mt-3 text-3xl font-bold">Ajude-nos a entender o cenário</h2>
            <p className="mt-5 leading-7 text-slate-400">
              Quanto mais contexto você fornecer, mais preciso poderá ser o atendimento. Nunca
              compartilhe credenciais ou informações completas de pagamento.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {questions.map((item) => (
              <article key={item.question} className="rounded-xl border border-slate-800 p-5">
                <h3 className="font-semibold text-slate-100">{item.question}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{item.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 text-center sm:px-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-8 sm:p-10">
          <h2 className="text-2xl font-bold">Ainda precisa de ajuda?</h2>
          <p className="mt-3 text-slate-300">
            Escreva para{' '}
            <a className="font-semibold text-emerald-400" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
            . Para relatos responsáveis de segurança, use{' '}
            <a className="font-semibold text-emerald-400" href="mailto:security@vigion.cloud">
              security@vigion.cloud
            </a>
            .
          </p>
        </div>
      </section>

      <footer className="border-t border-slate-800 px-5 py-8 text-sm text-slate-500 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3">
          <span>© {new Date().getFullYear()} Vigion Cloud</span>
          <a href="/" className="hover:text-slate-300">
            Voltar para vigion.cloud
          </a>
        </div>
      </footer>
    </main>
  );
}
