export type RiskFactor = 'OUT_OF_HOURS' | 'SENSITIVE_ZONE' | 'PERSISTENT_ACTIVITY';
export const RISK_ENGINE_VERSION = 1;
export const RISK_WEIGHTS: Record<RiskFactor, number> = {
  OUT_OF_HOURS: 0.35,
  SENSITIVE_ZONE: 0.2,
  PERSISTENT_ACTIVITY: 0.25,
};
export class RiskEngine {
  calculate(factors: RiskFactor[]) {
    const score = Math.min(
      1,
      Math.round((0.1 + factors.reduce((n, f) => n + RISK_WEIGHTS[f], 0)) * 1000) / 1000,
    );
    const riskLevel =
      score >= 0.8 ? 'VERY_HIGH' : score >= 0.55 ? 'HIGH' : score >= 0.3 ? 'MEDIUM' : 'LOW';
    const classification =
      factors.includes('OUT_OF_HOURS') &&
      factors.includes('SENSITIVE_ZONE') &&
      factors.includes('PERSISTENT_ACTIVITY')
        ? 'POSSIBLE_INTRUSION'
        : factors.includes('OUT_OF_HOURS')
          ? 'OUT_OF_HOURS_ACTIVITY'
          : factors.includes('PERSISTENT_ACTIVITY')
            ? 'UNUSUAL_ACTIVITY'
            : 'NORMAL_ACTIVITY';
    const labels: Record<RiskFactor, string> = {
      OUT_OF_HOURS: 'Atividade fora do horário configurado.',
      SENSITIVE_ZONE: 'Câmera possui área monitorada de alta prioridade.',
      PERSISTENT_ACTIVITY: 'Atividade repetida ou prolongada em uma janela curta.',
    };
    return {
      score,
      riskLevel,
      classification,
      explanation: factors.length
        ? factors.map((f) => labels[f]).join(' ')
        : 'Atividade sem fatores adicionais de risco.',
      factors,
    } as const;
  }
}
