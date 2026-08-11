export interface TenantContext {
  organizationId: string;
  userId: string;
  membershipId?: string;
  role?: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
}

export function tenantWhere<T extends object>(context: TenantContext, where?: T) {
  return { ...where, organizationId: context.organizationId };
}
