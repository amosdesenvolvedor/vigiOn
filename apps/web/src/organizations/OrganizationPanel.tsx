import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, setAccessToken } from '../auth/api';
import { useAuth } from '../auth/AuthContext';

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
interface Membership {
  id: string;
  role: Role;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  user: { id: string; name: string; email: string };
}
interface OrganizationOption {
  id: string;
  role: Role;
  organization: { id: string; name: string; status: string; timezone: string };
}
interface Profile {
  name: string;
  timezone: string;
  settings: { tradeName: string | null; country: string; language: string } | null;
}

export function OrganizationPanel() {
  const { user, organization, reload } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('VIEWER');
  const [message, setMessage] = useState('');
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const load = async () => {
    const [organizationData, memberData, optionData] = await Promise.all([
      apiRequest<{ organization: Profile }>('/organizations/current'),
      apiRequest<{ members: Membership[] }>('/organizations/members'),
      apiRequest<{ organizations: OrganizationOption[] }>('/organizations'),
    ]);
    setProfile(organizationData.organization);
    setMembers(memberData.members);
    setOrganizations(optionData.organizations);
  };

  useEffect(() => {
    void load().catch((error: Error) => setMessage(error.message));
    const token = new URLSearchParams(window.location.search).get('invitation');
    if (token) {
      apiRequest('/organizations/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
        .then(() => {
          history.replaceState({}, '', '/');
          setMessage('Convite aceito. A organização já está disponível no seletor.');
          return load();
        })
        .catch((error: Error) => setMessage(error.message));
    }
  }, []);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest('/organizations/invitations', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      setEmail('');
      setMessage('Convite enviado com validade de 72 horas.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const switchOrganization = async (organizationId: string) => {
    const result = await apiRequest<{ session: { accessToken: string } }>(
      `/organizations/${organizationId}/switch`,
      { method: 'POST' },
    );
    setAccessToken(result.session.accessToken);
    await reload();
    await load();
  };

  const updateMember = async (membershipId: string, action: 'role' | 'status', value: string) => {
    await apiRequest(`/organizations/members/${membershipId}/${action}`, {
      method: 'PATCH',
      body: JSON.stringify({ [action]: value }),
    });
    await load();
  };

  return (
    <div className="grid gap-6 py-8 lg:grid-cols-[1fr_1.5fr]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
          Organização atual
        </p>
        <select
          aria-label="Trocar organização"
          className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
          value={organization?.id}
          onChange={(event) => void switchOrganization(event.target.value)}
        >
          {organizations.map((item) => (
            <option key={item.organization.id} value={item.organization.id}>
              {item.organization.name} · {item.role}
            </option>
          ))}
        </select>
        <dl className="mt-6 grid gap-3 text-sm">
          <div>
            <dt className="text-slate-500">Nome</dt>
            <dd>{profile?.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Timezone</dt>
            <dd>{profile?.timezone}</dd>
          </div>
          <div>
            <dt className="text-slate-500">País / idioma</dt>
            <dd>
              {profile?.settings?.country ?? 'BR'} · {profile?.settings?.language ?? 'pt-BR'}
            </dd>
          </div>
        </dl>
        {canManage && (
          <form onSubmit={invite} className="mt-8 border-t border-slate-800 pt-6">
            <h2 className="font-semibold">Convidar membro</h2>
            <input
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
              type="email"
              required
              placeholder="pessoa@empresa.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <div className="mt-3 flex gap-2">
              <select
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-3"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {(user?.role === 'OWNER'
                  ? ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']
                  : ['OPERATOR', 'VIEWER']
                ).map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <button className="rounded-lg bg-emerald-500 px-4 font-semibold text-slate-950">
                Enviar
              </button>
            </div>
          </form>
        )}
        {message && <p className="mt-4 text-sm text-amber-300">{message}</p>}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">Membros</h2>
        <div className="mt-4 divide-y divide-slate-800">
          {members.map((member) => (
            <article
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div>
                <p className="font-medium">{member.user.name}</p>
                <p className="text-sm text-slate-500">{member.user.email}</p>
              </div>
              <div className="flex gap-2">
                <select
                  disabled={!canManage || member.user.id === user?.id}
                  value={member.role}
                  onChange={(event) => void updateMember(member.id, 'role', event.target.value)}
                  className="rounded border border-slate-700 bg-slate-950 p-2 text-xs"
                >
                  {['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select
                  disabled={!canManage || member.user.id === user?.id}
                  value={member.status}
                  onChange={(event) => void updateMember(member.id, 'status', event.target.value)}
                  className="rounded border border-slate-700 bg-slate-950 p-2 text-xs"
                >
                  <option>ACTIVE</option>
                  <option>SUSPENDED</option>
                </select>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
