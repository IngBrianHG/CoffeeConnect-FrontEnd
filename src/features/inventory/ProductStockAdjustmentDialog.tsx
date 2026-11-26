import { PackagePlus } from 'lucide-react';
import type { FormEvent } from 'react';
import { Dialog } from 'primereact/dialog';
import type { IngredientAdjustmentType, InventoryProduct } from './model';
import { adjustmentTypes, formatQuantity } from './inventoryDomain';

export interface ProductAdjustmentDraft {
  type: IngredientAdjustmentType;
  quantity: string;
  reason: string;
}

interface ProductStockAdjustmentDialogProps {
  product: InventoryProduct | null;
  draft: ProductAdjustmentDraft;
  error: string;
  success: string;
  balanceMessage: string;
  saving: boolean;
  onDraftChange: (draft: ProductAdjustmentDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ProductStockAdjustmentDialog({
  product, draft, error, success, balanceMessage, saving, onDraftChange, onClose, onSubmit,
}: ProductStockAdjustmentDialogProps) {
  if (!product) return null;
  const definition = adjustmentTypes.find(item => item.value === draft.type);
  const quantity = draft.quantity.trim() ? Number(draft.quantity) : NaN;
  const delta = definition?.sign === -1 ? -Math.abs(quantity)
    : definition?.sign === 1 ? Math.abs(quantity) : quantity;
  const estimatedBalance = product.stock + delta;

  return (
    <Dialog visible modal header={`Ajustar stock de ${product.name}`} className="inventory-dialog" closable={!saving} closeOnEscape={!saving} dismissableMask={!saving} onHide={() => { if (!saving) onClose(); }}>
      <form className="inventory-modal" onSubmit={onSubmit}>
        <p className="inventory-helper">Existencia actual: <strong>{formatQuantity(product.stock)} unidades</strong></p>
        <p className="inventory-helper">Este producto no depende de una receta; el saldo se gestiona directamente.</p>
        {error && <div className="inventory-alert" role="alert">{error}</div>}
        {success && <div className="inventory-success" role="status">{success}</div>}
        {balanceMessage && <p className="inventory-helper" role="status">{balanceMessage}</p>}
        <label className="inventory-field">
          <span>Tipo de movimiento</span>
          <select disabled={saving} value={draft.type} onChange={event => onDraftChange({ ...draft, type: event.target.value as IngredientAdjustmentType })}>
            {adjustmentTypes.filter(type => type.value !== 'opening_balance').map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>
        <label className="inventory-field">
          <span>{definition?.sign === 0 ? 'Cambio firmado' : 'Cantidad'}</span>
          <input
            disabled={saving}
            type="number"
            step="0.001"
            value={draft.quantity}
            onChange={event => onDraftChange({ ...draft, quantity: event.target.value })}
            required
            placeholder={definition?.sign === 0 ? 'Ej. 12 o -4' : 'Ej. 2'}
          />
          <small>{definition?.sign === 0 ? 'Usa positivo para aumentar y negativo para disminuir.' : definition?.sign === -1 ? 'La cantidad se restará del saldo.' : 'La cantidad se sumará al saldo.'}</small>
        </label>
        {Number.isFinite(estimatedBalance) && delta !== 0 && (
          <p className="inventory-helper">
            Saldo estimado: {formatQuantity(estimatedBalance)} unidades.
            {estimatedBalance < 0 ? ' La cantidad supera el stock actual.' : ''}
            {' '}El servidor valida el saldo final.
          </p>
        )}
        <label className="inventory-field">
          <span>Razón (opcional)</span>
          <input disabled={saving} maxLength={250} value={draft.reason} onChange={event => onDraftChange({ ...draft, reason: event.target.value })} />
        </label>
        <div className="inventory-form-footer">
          <button type="button" className="inventory-button inventory-button-secondary" disabled={saving} onClick={onClose}>Cancelar</button>
          <button className="inventory-button inventory-button-primary" disabled={saving}>
            <PackagePlus size={16} /> {saving ? 'Registrando…' : 'Registrar ajuste'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
