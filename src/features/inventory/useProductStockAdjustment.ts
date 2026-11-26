import { useCallback, useState, type FormEvent } from 'react';
import type { IngredientAdjustmentType, InventoryProduct, InventoryService } from './model';
import { adjustmentDelta, isSignedAdjustment, newIdempotencyKey } from './inventoryDomain';
import { parseQuantity, validateReason } from './inventoryValidation';

type RetryInput = {
  productId: string;
  delta: number;
  type: IngredientAdjustmentType;
  idempotencyKey: string;
  reason?: string;
};

interface UseProductStockAdjustmentOptions {
  adjustProductStock: InventoryService['adjustProductStock'];
  authorize: <T>(operation: () => Promise<T>) => Promise<T>;
  mapError: (error: unknown) => string;
  onSaved: () => Promise<void>;
}

const emptyDraft = { type: 'purchase' as IngredientAdjustmentType, quantity: '', reason: '' };

export function useProductStockAdjustment({
  adjustProductStock, authorize, mapError, onSaved,
}: UseProductStockAdjustmentOptions) {
  const [product, setProduct] = useState<InventoryProduct | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [retryInput, setRetryInput] = useState<RetryInput | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [balanceMessage, setBalanceMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const open = useCallback((eligibleProduct: InventoryProduct) => {
    if (!eligibleProduct.active || eligibleProduct.hasRecipe) return;
    const isRetryingThisProduct = retryInput?.productId === eligibleProduct.id;
    setProduct(eligibleProduct);
    if (!isRetryingThisProduct) setDraft(emptyDraft);
    setError('');
    setSuccess('');
    setBalanceMessage('');
  }, [retryInput]);

  const close = useCallback(() => {
    if (submitting) return;
    setProduct(null);
    setError('');
  }, [submitting]);

  const updateDraft = useCallback((next: typeof emptyDraft) => {
    setDraft(next);
    setError('');
  }, []);

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!product) return;
    const quantity = parseQuantity(draft.quantity, { allowNegative: isSignedAdjustment(draft.type) });
    if (quantity === null) {
      setError('La cantidad debe ser distinta de cero, positiva para entradas y tener hasta tres decimales.');
      return;
    }
    const reason = draft.reason.trim() || undefined;
    const reasonError = validateReason(draft.reason);
    if (reasonError) {
      setError(reasonError);
      return;
    }
    const delta = adjustmentDelta(draft.type, quantity);
    const idempotencyKey = retryInput?.productId === product.id
      && retryInput.delta === delta
      && retryInput.type === draft.type
      && retryInput.reason === reason
      ? retryInput.idempotencyKey
      : newIdempotencyKey();
    const input = { productId: product.id, delta, type: draft.type, idempotencyKey, reason };
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const balance = await authorize(() => adjustProductStock(input));
      setRetryInput(null);
      setDraft(current => ({ ...current, quantity: '', reason: '' }));
      setBalanceMessage(`Saldo actualizado: ${balance.toLocaleString('es', { maximumFractionDigits: 3 })} unidades.`);
      setSuccess('Ajuste registrado correctamente.');
      await onSaved();
    } catch (cause) {
      setRetryInput(input);
      setError(mapError(cause));
    } finally {
      setSubmitting(false);
    }
  }, [adjustProductStock, authorize, draft, mapError, onSaved, product, retryInput]);

  return {
    product, draft, error, success, balanceMessage, submitting,
    open, close, updateDraft, submit,
  };
}
