import { useState, useEffect, useCallback } from 'react';
import Swal from 'sweetalert2';
import { Boxes, Plus, Pencil, Trash2, X, Save, RefreshCw, PackagePlus, TriangleAlert } from 'lucide-react';
import {
  fetchIngredients, createIngredient, updateIngredient,
  setIngredientStock, adjustIngredientStock, deleteIngredient
} from '../services/api';
import type { Ingredient } from '../types/Ingredient';

/**
 * Panel de inventario de ingredientes (solo admin).
 * Los ingredientes (leche, café, harina...) se comparten entre todas las recetas:
 * cada pedido descuenta lo que lleva cada producto, y si un ingrediente se agota
 * los productos que lo usan aparecen como "Agotado".
 * Las recetas se configuran en Productos → editar producto → Receta.
 */

const EMPTY_FORM = { name: '', unit: 'ml', stock: '0', min_stock: '0' };
const COMMON_UNITS = ['ml', 'l', 'g', 'kg', 'oz', 'unidad'];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #D1D5DB',
  fontSize: '0.95rem', color: '#111827', boxSizing: 'border-box', background: '#fff',
};
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600, color: '#4B5563',
};
const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.6rem', borderRadius: '8px',
  border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#4B5563', fontSize: '0.85rem', fontWeight: 600,
};

function errorMessage(e: unknown, fallback = 'Ocurrió un error inesperado.') {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** 1500 → "1,500"; 2.5 → "2.5" (sin ceros de más) */
function fmt(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function statusOf(i: Ingredient): { label: string; color: string; bg: string } {
  if (i.stock <= 0) return { label: 'Agotado', color: '#B91C1C', bg: '#FEE2E2' };
  if (i.low) return { label: 'Poco inventario', color: '#B45309', bg: '#FEF3C7' };
  return { label: 'OK', color: '#047857', bg: '#D1FAE5' };
}

export function InventoryPanel() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIngredients(await fetchIngredients());
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Error', text: errorMessage(e, 'No se pudo cargar el inventario.'), confirmButtonColor: '#EF4444' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(i: Ingredient) {
    setEditingId(i.id);
    setForm({ name: i.name, unit: i.unit, stock: String(i.stock), min_stock: String(i.min_stock) });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave() {
    const name = form.name.trim();
    const unit = form.unit.trim() || 'unidad';
    const stock = Number(form.stock);
    const min_stock = Number(form.min_stock || 0);

    if (!name) return Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre del ingrediente.', confirmButtonColor: '#E0247D' });
    if (!editingId && (!Number.isFinite(stock) || stock < 0)) {
      return Swal.fire({ icon: 'warning', title: 'Stock inválido', text: 'El stock debe ser un número mayor o igual a 0.', confirmButtonColor: '#E0247D' });
    }
    if (!Number.isFinite(min_stock) || min_stock < 0) {
      return Swal.fire({ icon: 'warning', title: 'Mínimo inválido', text: 'El stock mínimo debe ser un número mayor o igual a 0.', confirmButtonColor: '#E0247D' });
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateIngredient(editingId, { name, unit, min_stock });
      } else {
        await createIngredient({ name, unit, stock, min_stock });
      }
      closeForm();
      await load();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: errorMessage(e), confirmButtonColor: '#EF4444' });
    } finally {
      setSaving(false);
    }
  }

  /** Reposición: suma lo que llegó del proveedor */
  async function handleRestock(i: Ingredient) {
    const { value, isConfirmed } = await Swal.fire({
      title: `Reponer ${i.name}`,
      text: `Stock actual: ${fmt(i.stock)} ${i.unit}. ¿Cuánto llegó?`,
      input: 'number',
      inputAttributes: { min: '0', step: 'any' },
      inputPlaceholder: `Cantidad en ${i.unit}`,
      showCancelButton: true,
      confirmButtonText: 'Sumar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#10B981',
      inputValidator: v => (!v || Number(v) <= 0 ? 'Escribe una cantidad mayor a 0' : undefined),
    });
    if (!isConfirmed) return;
    try {
      await adjustIngredientStock(i.id, Number(value));
      await load();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Error', text: errorMessage(e), confirmButtonColor: '#EF4444' });
    }
  }

  /** Conteo físico: fija el valor exacto (corrige mermas o diferencias) */
  async function handleSetStock(i: Ingredient) {
    const { value, isConfirmed } = await Swal.fire({
      title: `Ajustar ${i.name}`,
      text: `Escribe cuánto hay realmente (conteo físico). Ahora dice ${fmt(i.stock)} ${i.unit}.`,
      input: 'number',
      inputValue: i.stock,
      inputAttributes: { min: '0', step: 'any' },
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#E0247D',
      inputValidator: v => (v === '' || Number(v) < 0 ? 'Escribe un número mayor o igual a 0' : undefined),
    });
    if (!isConfirmed) return;
    try {
      await setIngredientStock(i.id, Number(value));
      await load();
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Error', text: errorMessage(e), confirmButtonColor: '#EF4444' });
    }
  }

  async function handleDelete(i: Ingredient) {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: `¿Eliminar ${i.name}?`,
      text: 'Esta acción no se puede deshacer.',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#DC2626',
    });
    if (!isConfirmed) return;
    try {
      await deleteIngredient(i.id);
      await load();
    } catch (e) {
      // Si alguna receta lo usa, el servidor explica cuáles
      Swal.fire({ icon: 'error', title: 'No se pudo eliminar', text: errorMessage(e), confirmButtonColor: '#EF4444' });
    }
  }

  const lowOnes = ingredients.filter(i => i.low);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, color: '#6B7280', maxWidth: '640px' }}>
          Controla los <strong>ingredientes</strong> (leche, café, harina...). Cada pedido descuenta lo que lleva la receta de cada producto;
          cuando un ingrediente se agota, los productos que lo usan aparecen como <strong>Agotado</strong>.
          La receta de cada producto se define en <em>Productos → editar → Receta</em>.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={load} title="Actualizar" style={{ padding: '0.6rem 0.9rem', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#4B5563' }}>
            <RefreshCw size={16} />
          </button>
          <button onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.1rem', borderRadius: '8px', border: 'none', background: '#E0247D', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={18} /> Nuevo ingrediente
          </button>
        </div>
      </div>

      {lowOnes.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '10px', padding: '0.85rem 1rem', color: '#92400E' }}>
          <TriangleAlert size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '0.92rem' }}>
            <strong>Hay que reponer:</strong>{' '}
            {lowOnes.map(i => `${i.name} (${fmt(i.stock)} ${i.unit})`).join(', ')}
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#111827' }}>{editingId ? 'Editar ingrediente' : 'Nuevo ingrediente'}</h3>
            <button onClick={closeForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}><X size={20} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <label style={labelStyle}>
              Nombre
              <input style={inputStyle} value={form.name} maxLength={100} placeholder="Ej: Leche entera" onChange={e => set('name', e.target.value)} />
            </label>
            <label style={labelStyle}>
              Unidad de medida
              <input style={inputStyle} value={form.unit} maxLength={20} list="inventory-units" placeholder="ml, g, unidad..." onChange={e => set('unit', e.target.value)} />
              <datalist id="inventory-units">{COMMON_UNITS.map(u => <option key={u} value={u} />)}</datalist>
            </label>
            {!editingId && (
              <label style={labelStyle}>
                Stock inicial
                <input type="number" min={0} step="any" style={inputStyle} value={form.stock} onChange={e => set('stock', e.target.value)} />
              </label>
            )}
            <label style={labelStyle}>
              Avisar cuando quede
              <input type="number" min={0} step="any" style={inputStyle} value={form.min_stock} onChange={e => set('min_stock', e.target.value)} />
            </label>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#6B7280' }}>
            Usa siempre la misma unidad que en las recetas. Ej: si la leche está en <strong>ml</strong>, un capuchino lleva 180 (ml).
            {editingId && ' Para cambiar la cantidad que hay, usa "Reponer" o "Ajustar" en la lista.'}
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button onClick={closeForm} style={{ padding: '0.6rem 1.2rem', borderRadius: '8px', border: 'none', background: '#F3F4F6', color: '#374151', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', borderRadius: '8px', border: 'none', background: '#E0247D', color: '#fff', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              <Save size={16} /> {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', overflowX: 'auto' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>Cargando inventario...</div>
        ) : ingredients.length === 0 ? (
          <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', color: '#6B7280' }}>
            <Boxes size={36} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
            <p style={{ margin: 0 }}>Aún no hay ingredientes. Crea el primero (por ejemplo <strong>Leche</strong> en ml) y luego asígnalo a la receta de tus productos.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
            <thead>
              <tr style={{ background: '#F9FAFB', textAlign: 'left', color: '#6B7280', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Ingrediente</th>
                <th style={{ padding: '0.75rem 1rem' }}>Stock</th>
                <th style={{ padding: '0.75rem 1rem' }}>Aviso en</th>
                <th style={{ padding: '0.75rem 1rem' }}>Estado</th>
                <th style={{ padding: '0.75rem 1rem' }}>Usado en</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map(i => {
                const st = statusOf(i);
                return (
                  <tr key={i.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#111827' }}>{i.name}</td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: i.stock <= 0 ? '#B91C1C' : '#111827' }}>{fmt(i.stock)} <span style={{ fontWeight: 400, color: '#6B7280' }}>{i.unit}</span></td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6B7280' }}>{fmt(i.min_stock)} {i.unit}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700, color: st.color, background: st.bg }}>{st.label}</span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#6B7280' }}>
                      {i.used_in ? `${i.used_in} ${i.used_in === 1 ? 'receta' : 'recetas'}` : 'Ninguna'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button onClick={() => handleRestock(i)} title="Sumar lo que llegó del proveedor" style={{ ...iconBtn, borderColor: '#A7F3D0', background: '#ECFDF5', color: '#047857' }}>
                          <PackagePlus size={15} /> Reponer
                        </button>
                        <button onClick={() => handleSetStock(i)} title="Conteo físico: fijar la cantidad exacta" style={iconBtn}>Ajustar</button>
                        <button onClick={() => openEdit(i)} title="Editar nombre, unidad y aviso" style={iconBtn}><Pencil size={15} /></button>
                        <button onClick={() => handleDelete(i)} title="Eliminar" style={{ ...iconBtn, borderColor: '#FECACA', background: '#FEF2F2', color: '#DC2626' }}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
