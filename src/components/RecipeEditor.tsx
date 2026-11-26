import { useState, useEffect, useMemo } from 'react';
import Swal from 'sweetalert2';
import { ChefHat, Plus, Trash2, Save } from 'lucide-react';
import { fetchIngredients, fetchRecipe, saveRecipe } from '../services/api';
import type { Ingredient } from '../types/Ingredient';

/**
 * Editor de receta de un producto (se muestra dentro del modal "Editar producto").
 * La receta dice cuánto de cada ingrediente lleva UNA porción. Mientras tenga ingredientes,
 * el stock del producto se calcula solo a partir del inventario; si se deja vacía, el producto
 * vuelve a usar su propio stock.
 */

interface Row { ingredient_id: string; quantity: string }

interface Props {
  productId: number;
  /** Se llama después de guardar, para que el padre recargue los productos (el stock cambia) */
  onSaved?: () => void;
}

const fieldStyle: React.CSSProperties = {
  padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.9rem',
  color: '#111827', background: '#fff', boxSizing: 'border-box',
};

function errorMessage(e: unknown, fallback = 'Ocurrió un error inesperado.') {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function RecipeEditor({ productId, onSaved }: Props) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setDirty(false);
    Promise.all([fetchIngredients(), fetchRecipe(productId)])
      .then(([ings, recipe]) => {
        if (cancelled) return;
        setIngredients(ings);
        setRows(recipe.map(l => ({ ingredient_id: String(l.ingredient_id), quantity: String(l.quantity) })));
      })
      .catch(e => { if (!cancelled) setLoadError(errorMessage(e, 'No se pudo cargar la receta.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId]);

  const byId = useMemo(() => new Map(ingredients.map(i => [String(i.id), i])), [ingredients]);

  // Vista previa: cuántas porciones alcanzan con el inventario actual (lo limita el ingrediente más escaso)
  const preview = useMemo(() => {
    let best = Infinity;
    let limitedBy = '';
    for (const r of rows) {
      const ing = byId.get(r.ingredient_id);
      const qty = Number(r.quantity);
      if (!ing || !(qty > 0)) continue;
      const portions = Math.floor(ing.stock / qty + 1e-9);
      if (portions < best) { best = portions; limitedBy = ing.name; }
    }
    return Number.isFinite(best) ? { portions: best, limitedBy } : null;
  }, [rows, byId]);

  function update(index: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function addRow() {
    setRows(prev => [...prev, { ingredient_id: '', quantity: '' }]);
    setDirty(true);
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function handleSave() {
    // Las filas sin ingrediente elegido se ignoran
    const filled = rows.filter(r => r.ingredient_id !== '');
    for (const r of filled) {
      if (!(Number(r.quantity) > 0)) {
        const name = byId.get(r.ingredient_id)?.name ?? 'el ingrediente';
        Swal.fire({ icon: 'warning', title: 'Falta la cantidad', text: `Escribe cuánto lleva una porción de ${name} (mayor a 0).`, confirmButtonColor: '#E0247D' });
        return;
      }
    }

    setSaving(true);
    try {
      await saveRecipe(productId, filled.map(r => ({ ingredient_id: Number(r.ingredient_id), quantity: Number(r.quantity) })));
      setRows(filled);
      setDirty(false);
      Swal.fire({
        icon: 'success',
        title: filled.length ? 'Receta guardada' : 'Receta quitada',
        text: filled.length ? undefined : 'El producto vuelve a usar su stock propio.',
        confirmButtonColor: '#10B981', timer: 1800, showConfirmButton: false,
      });
      onSaved?.();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: errorMessage(e), confirmButtonColor: '#EF4444' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: '#F9FAFB', padding: '1rem 1.25rem', borderRadius: '10px', border: '1px solid #E5E7EB', marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
        <ChefHat size={18} color="#6B7280" />
        <span style={{ fontWeight: 600, color: '#374151', fontSize: '0.95rem' }}>Receta (ingredientes por porción)</span>
      </div>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#6B7280' }}>
        Con receta, el stock del producto se calcula solo con el inventario de ingredientes y cada pedido los descuenta.
        Sin receta, usa su stock propio.
      </p>

      {loading ? (
        <div style={{ fontSize: '0.85rem', color: '#6B7280' }}>Cargando receta...</div>
      ) : loadError ? (
        <div style={{ fontSize: '0.85rem', color: '#B91C1C' }}>{loadError}</div>
      ) : ingredients.length === 0 ? (
        <div style={{ fontSize: '0.85rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
          Aún no hay ingredientes. Créalos primero en la pestaña <strong>Inventario</strong>.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {rows.map((row, index) => {
              const chosen = byId.get(row.ingredient_id);
              // No se puede repetir un ingrediente en la misma receta
              const takenElsewhere = new Set(rows.filter((_, i) => i !== index).map(r => r.ingredient_id));
              return (
                <div key={index} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <select
                    value={row.ingredient_id}
                    onChange={e => update(index, { ingredient_id: e.target.value })}
                    style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
                  >
                    <option value="">— Ingrediente —</option>
                    {ingredients.filter(i => !takenElsewhere.has(String(i.id))).map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  <input
                    type="number" min={0} step="any" placeholder="Cantidad"
                    value={row.quantity}
                    onChange={e => update(index, { quantity: e.target.value })}
                    style={{ ...fieldStyle, width: '100px' }}
                  />
                  <span style={{ width: '52px', fontSize: '0.85rem', color: '#6B7280' }}>{chosen?.unit ?? ''}</span>
                  <button type="button" onClick={() => removeRow(index)} title="Quitar ingrediente"
                    style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={addRow}
              disabled={rows.length >= ingredients.length}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.8rem', borderRadius: '8px', border: '1px dashed #9CA3AF', background: '#fff', color: '#374151', fontWeight: 600, cursor: rows.length >= ingredients.length ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>
              <Plus size={15} /> Agregar ingrediente
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !dirty}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.9rem', borderRadius: '8px', border: 'none', background: '#E0247D', color: '#fff', fontWeight: 700, fontSize: '0.85rem', cursor: saving || !dirty ? 'not-allowed' : 'pointer', opacity: saving || !dirty ? 0.5 : 1 }}>
              <Save size={15} /> {saving ? 'Guardando...' : 'Guardar receta'}
            </button>
          </div>

          {preview && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.82rem', color: preview.portions > 0 ? '#047857' : '#B91C1C', fontWeight: 600 }}>
              {preview.portions > 0
                ? `Con el inventario actual alcanzan ${preview.portions} porciones (limita: ${preview.limitedBy}).`
                : `No alcanza para ninguna porción: falta ${preview.limitedBy}.`}
            </div>
          )}
          {rows.length === 0 && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.82rem', color: '#6B7280' }}>
              Sin receta: este producto usa su propio stock.
            </div>
          )}
        </>
      )}
    </div>
  );
}
