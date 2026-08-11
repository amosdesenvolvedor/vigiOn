export interface TenantContext {
  organizationId: string;
  userId: string;
}

export function tenantWhere<T extends object>(context: TenantContext, where?: T) {
  return { ...where, organizationId: context.organizationId };
}
