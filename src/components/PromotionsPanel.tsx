import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  adminCatalogErrorMessage, createAdminCatalogService,
  type AdminCategory, type AdminProduct, type AdminPromotion, type PromotionInput, type PromotionScope, type PromotionType,
} from '../services/adminCatalog';
import { ApiError, httpClient } from '../services/http/client';

type Draft = {
  name: string; description: string; type: PromotionType; scope: PromotionScope;
  buyQuantity: number | null; payQuantity: number | null; percent: number | null;
  productId: string | null; categoryId: string | null; startsOn: Date | null; endsOn: Date | null; active: boolean;
};
const emptyDraft = (): Draft => ({
  name: '', description: '', type: 'nxm', scope: 'category', buyQuantity: 2, payQuantity: 1,
  percent: null, productId: null, categoryId: null, startsOn: null, endsOn: null, active: true,
});
function parseDate(date: string | null): Date | null {
  if (!date) return null;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function dateValue(date: Date | null): string | null {
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function PromotionsPanel() {
  const { session, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const token = useRef(session?.accessToken);
  token.current = session?.accessToken;
  const service = useMemo(() => createAdminCatalogService(httpClient, () => token.current, async () => {
    const refreshed = await refreshSession().catch(() => null);
    token.current = refreshed?.accessToken;
    return refreshed?.accessToken ?? null;
  }), [refreshSession]);
  const [promotions, setPromotions] = useState<AdminPromotion[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AdminPromotion | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextPromotions, nextProducts, nextCategories] = await Promise.all([
        service.listPromotions(), service.listProducts(), service.listCategories(),
      ]);
      setPromotions(nextPromotions);
      setProducts(nextProducts);
      setCategories(nextCategories);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(adminCatalogErrorMessage(cause));
    } finally { setLoading(false); }
  }, [navigate, service, signOut]);
  useEffect(() => { void load(); }, [load]);

  function startCreate() {
    setEditing(null);
    setDraft(emptyDraft());
    setError('');
    setOpen(true);
  }
  function startEdit(promotion: AdminPromotion) {
    setEditing(promotion);
    setDraft({
      name: promotion.name, description: promotion.description ?? '', type: promotion.type, scope: promotion.scope,
      buyQuantity: promotion.buyQuantity, payQuantity: promotion.payQuantity, percent: promotion.percent,
      productId: promotion.productId, categoryId: promotion.categoryId, startsOn: parseDate(promotion.startsOn),
      endsOn: parseDate(promotion.endsOn), active: promotion.active,
    });
    setError('');
    setOpen(true);
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => {
      const next = { ...current, [key]: value };
      if (key === 'scope') { next.productId = null; next.categoryId = null; }
      if (key === 'type') {
        if (value === 'nxm') { next.percent = null; next.buyQuantity = 2; next.payQuantity = 1; }
        else { next.buyQuantity = null; next.payQuantity = null; next.percent = 10; }
      }
      return next;
    });
  }
  async function save() {
    setError('');
    const payload: PromotionInput = {
      name: draft.name, description: draft.description, type: draft.type, scope: draft.scope,
      buyQuantity: draft.type === 'nxm' ? draft.buyQuantity : null,
      payQuantity: draft.type === 'nxm' ? draft.payQuantity : null,
      percent: draft.type === 'percent' ? draft.percent : null,
      productId: draft.scope === 'product' ? draft.productId : null,
      categoryId: draft.scope === 'category' ? draft.categoryId : null,
      startsOn: dateValue(draft.startsOn), endsOn: dateValue(draft.endsOn), active: draft.active,
    };
    setSaving(true);
    try {
      if (editing) await service.updatePromotion(editing.id, payload);
      else await service.createPromotion(payload);
      setOpen(false);
      await load();
    } catch (cause) { setError(adminCatalogErrorMessage(cause)); }
    finally { setSaving(false); }
  }
  async function deactivate(promotion: AdminPromotion) {
    try {
      await service.deactivatePromotion(promotion.id);
      await load();
    } catch (cause) { setError(adminCatalogErrorMessage(cause)); }
  }
  const footer = <div className="flex justify-content-end gap-2">
    <Button label="Cancelar" severity="secondary" outlined onClick={() => setOpen(false)} disabled={saving} />
    <Button label="Guardar" icon="pi pi-check" onClick={() => void save()} loading={saving} />
  </div>;
  return <section className="admin-module promotions-admin">
    <div className="flex justify-content-between align-items-start flex-wrap gap-2">
      <div>
        <p className="mt-0 mb-0">Se administran en Supabase, pero todavía no se aplican a pedidos ni al checkout.</p>
      </div>
      <Button label="Nueva promoción" icon="pi pi-plus" onClick={startCreate} />
    </div>
    <Message severity="warn" text="Activar una promoción no cambia los precios del catálogo ni el checkout. La aplicación queda bloqueada hasta contar con cálculo autoritativo en servidor." />
    {error && <Message severity="error" text={error} />}
    <div className="admin-table-card">
      <DataTable value={promotions} dataKey="id" size="small" stripedRows responsiveLayout="scroll" loading={loading} emptyMessage="No hay promociones.">
        <Column field="name" header="Nombre" />
        <Column header="Regla" body={(row: AdminPromotion) => row.type === 'nxm' ? `${row.buyQuantity}×${row.payQuantity}` : `${row.percent}%`} />
        <Column header="Alcance" body={(row: AdminPromotion) => row.scope === 'product' ? products.find(p => p.id === row.productId)?.name ?? 'Producto' : row.scope === 'category' ? categories.find(c => c.id === row.categoryId)?.name ?? 'Categoría' : 'Todo el menú'} />
        <Column header="Vigencia" body={(row: AdminPromotion) => [row.startsOn, row.endsOn].filter(Boolean).join(' – ') || 'Sin fechas'} />
        <Column header="Estado" body={(row: AdminPromotion) => <Tag value={row.active ? 'Activa (no aplicada)' : 'Inactiva'} severity={row.active ? 'warning' : 'secondary'} />} />
        <Column header="Acciones" body={(row: AdminPromotion) => <span className="flex gap-2">
          <Button icon="pi pi-pencil" aria-label={`Editar ${row.name}`} text onClick={() => startEdit(row)} />
          {row.active && <Button icon="pi pi-ban" aria-label={`Desactivar ${row.name}`} text onClick={() => void deactivate(row)} />}
        </span>} />
      </DataTable>
    </div>
    <Dialog visible={open} header={`${editing ? 'Editar' : 'Nueva'} promoción`} modal onHide={() => !saving && setOpen(false)} footer={footer} className="w-11 md:w-8 lg:w-6" contentStyle={{ maxHeight: '75vh', overflow: 'auto' }}>
      <div className="p-fluid flex flex-column gap-3">
        {error && <Message severity="error" text={error} />}
        <div className="field"><label htmlFor="promo-name">Nombre *</label><InputText id="promo-name" value={draft.name} onChange={event => update('name', event.target.value)} /></div>
        <div className="field"><label htmlFor="promo-description">Descripción</label><InputTextarea id="promo-description" value={draft.description} rows={2} onChange={event => update('description', event.target.value)} /></div>
        <div className="field"><label htmlFor="promo-type">Tipo</label><Dropdown inputId="promo-type" value={draft.type} options={[{ label: 'Lleva X, paga Y', value: 'nxm' }, { label: 'Porcentaje', value: 'percent' }]} onChange={event => update('type', event.value)} /></div>
        {draft.type === 'nxm' ? <div className="grid">
          <div className="col-6 field"><label htmlFor="promo-buy">Lleva</label><InputNumber inputId="promo-buy" value={draft.buyQuantity} min={2} maxFractionDigits={0} onValueChange={event => update('buyQuantity', event.value ?? null)} /></div>
          <div className="col-6 field"><label htmlFor="promo-pay">Paga</label><InputNumber inputId="promo-pay" value={draft.payQuantity} min={1} maxFractionDigits={0} onValueChange={event => update('payQuantity', event.value ?? null)} /></div>
        </div> : <div className="field"><label htmlFor="promo-percent">Porcentaje</label><InputNumber inputId="promo-percent" value={draft.percent} min={0.01} max={100} suffix="%" maxFractionDigits={2} onValueChange={event => update('percent', event.value ?? null)} /></div>}
        <div className="field"><label htmlFor="promo-scope">Alcance</label><Dropdown inputId="promo-scope" value={draft.scope} options={[
          { label: 'Producto', value: 'product' }, { label: 'Categoría', value: 'category' }, { label: 'Todo el menú', value: 'all_menu' },
        ]} onChange={event => update('scope', event.value)} /></div>
        {draft.scope === 'product' && <div className="field"><label htmlFor="promo-product">Producto *</label><Dropdown inputId="promo-product" value={draft.productId} options={products.filter(item => item.active).map(item => ({ label: item.name, value: item.id }))} onChange={event => update('productId', event.value)} placeholder="Selecciona un producto" /></div>}
        {draft.scope === 'category' && <div className="field"><label htmlFor="promo-category">Categoría *</label><Dropdown inputId="promo-category" value={draft.categoryId} options={categories.filter(item => item.active).map(item => ({ label: item.name, value: item.id }))} onChange={event => update('categoryId', event.value)} placeholder="Selecciona una categoría" /></div>}
        <div className="grid">
          <div className="col-12 md:col-6 field"><label htmlFor="promo-start">Desde</label><Calendar inputId="promo-start" value={draft.startsOn} onChange={event => update('startsOn', event.value as Date | null)} dateFormat="dd/mm/yy" locale="es-SV" showIcon /></div>
          <div className="col-12 md:col-6 field"><label htmlFor="promo-end">Hasta</label><Calendar inputId="promo-end" value={draft.endsOn} onChange={event => update('endsOn', event.value as Date | null)} dateFormat="dd/mm/yy" locale="es-SV" showIcon minDate={draft.startsOn ?? undefined} /></div>
        </div>
        <div className="flex align-items-center gap-2"><InputSwitch inputId="promo-active" checked={draft.active} onChange={event => update('active', event.value)} /><label htmlFor="promo-active">Activa (no se aplica a órdenes)</label></div>
      </div>
    </Dialog>
  </section>;
}
