import { useState } from 'react';
import type { CartItem } from '../types/Order';
import type { CartPricing } from '../utils/promotions';
import { MAX_NOTE_LENGTH } from '../utils/promotions';
import { ShoppingCart, Trash2, CheckCircle, Minus, Plus, MessageSquarePlus, Gift } from 'lucide-react';

interface CartProps {
  cart: CartItem[];
  /** Subtotal, descuentos por promociones y total (calculado en Kiosk) */
  pricing: CartPricing;
  mesaName: string;
  onIncreaseQuantity: (lineId: string) => void;
  onDecreaseQuantity: (lineId: string) => void;
  onRemoveFromCart: (lineId: string) => void;
  /** Guarda el comentario del cliente para esa línea (ej: "con 2 cucharadas de azúcar") */
  onUpdateNotes: (lineId: string, notes: string) => void;
  onConfirmOrder: () => void;
  isProcessing: boolean;
}

/**
 * Componente Carrito - TURRÓN Pastelería
 * Muestra los productos seleccionados, controles de cantidad, comentarios por producto,
 * promociones aplicadas y precio total.
 */
export function Cart({
  cart,
  pricing,
  mesaName,
  onIncreaseQuantity,
  onDecreaseQuantity,
  onRemoveFromCart,
  onUpdateNotes,
  onConfirmOrder,
  isProcessing
}: CartProps) {
  // Líneas cuyo campo de comentario fue abierto manualmente (las que ya tienen texto siempre se muestran)
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const isOrderValid = cart.length > 0 && mesaName !== '';

  function openNoteField(lineId: string) {
    setOpenNotes(prev => new Set(prev).add(lineId));
  }

  return (
    <div className="cart">
      <div className="cart-header">
        <h2 className="cart-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShoppingCart size={22} /> Carrito</h2>
        <span className="cart-count">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
      </div>

      <div className="cart-items">
        {cart.length === 0 ? (
          <div className="cart-empty">
            <div className="cart-empty-icon" style={{ display: 'flex', justifyContent: 'center' }}><ShoppingCart size={48} color="#ccc" /></div>
            <p className="cart-empty-message">Tu carrito está vacío</p>
            <p className="cart-empty-submessage">Agrega productos del menú</p>
          </div>
        ) : (
          <>
            {cart.map((item) => {
              const line = pricing.lines[item.lineId];
              const hasDiscount = !!line && line.discount > 0;
              const showNotes = openNotes.has(item.lineId) || !!item.notes;

              return (
                <div key={item.lineId} className="cart-item">
                  <div className="cart-item-info">
                    <h4 className="cart-item-name">{item.product.name}</h4>
                    <p className="cart-item-price">${item.product.price.toFixed(2)} c/u</p>
                    {hasDiscount && (
                      <span className="cart-item-promo">
                        <Gift size={12} /> {line.promoNames.join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="cart-item-controls">
                    <div className="quantity-controls">
                      <button
                        className="quantity-btn decrease"
                        onClick={() => onDecreaseQuantity(item.lineId)}
                        disabled={item.quantity <= 1}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="quantity-value">{item.quantity}</span>
                      <button
                        className="quantity-btn increase"
                        onClick={() => onIncreaseQuantity(item.lineId)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="cart-item-subtotal">
                      {hasDiscount && <s className="cart-item-subtotal-old">${item.subtotal.toFixed(2)}</s>}
                      ${(line ? line.net : item.subtotal).toFixed(2)}
                    </div>
                    <button
                      className="remove-btn"
                      onClick={() => onRemoveFromCart(item.lineId)}
                      title="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Comentario para este producto */}
                  {showNotes ? (
                    <div className="cart-item-notes">
                      <textarea
                        className="cart-item-notes-input"
                        rows={2}
                        maxLength={MAX_NOTE_LENGTH}
                        value={item.notes ?? ''}
                        autoFocus={openNotes.has(item.lineId)}
                        placeholder="Comentario para este producto. Ej: con 2 cucharadas de azúcar"
                        onChange={(e) => onUpdateNotes(item.lineId, e.target.value)}
                      />
                      <span className="cart-item-notes-count">{(item.notes ?? '').length}/{MAX_NOTE_LENGTH}</span>
                    </div>
                  ) : (
                    <button className="cart-item-notes-btn" onClick={() => openNoteField(item.lineId)}>
                      <MessageSquarePlus size={15} /> Agregar comentario
                    </button>
                  )}
                </div>
              );
            })}

            {/* Sugerencias: "agrega 1 más y te llevas 1 gratis" */}
            {pricing.hints.map((hint, idx) => (
              <div key={idx} className="cart-promo-hint">
                <Gift size={16} /> <span>{hint}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {cart.length > 0 && (
        <div className="cart-footer">
          <div className="mesa-input-group compact" style={{ padding: '0.5rem', background: '#f3f4f6', borderRadius: '4px', textAlign: 'center', fontWeight: 'bold' }}>
            {mesaName || 'Mesa no identificada'}
          </div>

          {pricing.discountTotal > 0 && (
            <div className="cart-discount-summary">
              <div className="cart-subtotal" style={{ marginBottom: 0 }}>
                <span className="subtotal-label">Subtotal</span>
                <span className="subtotal-value">${pricing.subtotal.toFixed(2)}</span>
              </div>
              {pricing.applied.map(a => (
                <div key={a.promoId} className="cart-discount-row">
                  <span><Gift size={13} /> {a.name}</span>
                  <span>-${a.discount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="cart-total">
            <span className="total-label">Total:</span>
            <span className="total-value">${pricing.total.toFixed(2)}</span>
          </div>
          <button
            className="confirm-order-btn"
            onClick={onConfirmOrder}
            disabled={!isOrderValid || isProcessing}
          >
            {isProcessing ? (
              <>
                <span className="spinner"></span>
                Procesando...
              </>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                <CheckCircle size={18} /> Confirmar Pedido
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
