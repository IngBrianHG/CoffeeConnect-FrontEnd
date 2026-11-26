export interface QuantityRules {
  required?: boolean;
  allowNegative?: boolean;
  allowZero?: boolean;
  maxDecimals?: number;
}

export function parseQuantity(value: string, rules: QuantityRules = {}): number | null {
  const { required = true, allowNegative = false, allowZero = false, maxDecimals = 3 } = rules;
  const normalized = value.trim();
  if (!normalized) return required ? null : 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || (!allowZero && parsed === 0) || (!allowNegative && parsed < 0)) return null;
  const scale = 10 ** maxDecimals;
  if (Math.abs(parsed * scale - Math.round(parsed * scale)) > 1e-7) return null;
  return parsed;
}

export function validateReason(value: string, maxLength = 250): string | null {
  return value.trim().length > maxLength
    ? `La razón no puede superar ${maxLength} caracteres.`
    : null;
}
