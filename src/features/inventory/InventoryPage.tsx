import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Boxes, ClipboardList, History, PackagePlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { InputSwitch } from 'primereact/inputswitch';
import { Tag } from 'primereact/tag';
import { useAuth } from '../../auth/AuthContext';
import { APP_LOCALE, CALENDAR_DATE_FORMAT } from '../../config/primeReact';
import { ApiError, httpClient } from '../../services/http/client.ts';
import { createInventoryService } from './inventoryService';
import { MeasurementUnitSelect } from './MeasurementUnitSelect';
import type { Ingredient, IngredientAdjustmentType, IngredientPresentation, InventoryMovement, InventoryProduct, MeasurementUnit, RecipeLine } from './model';
import {
  adjustmentDelta, adjustmentTypes, compatibleUnits, estimateRecipeRow,
  estimateRecipeQuantity, formatQuantity, isSignedAdjustment, movementLabels,
  newIdempotencyKey, newRecipeRow, type RecipeDraftRow,
} from './inventoryDomain';
import { parseQuantity, validateReason } from './inventoryValidation';
import { ProductStockAdjustmentDialog } from './ProductStockAdjustmentDialog';
import { useProductStockAdjustment } from './useProductStockAdjustment';
import './inventory.css';

type Tab = 'ingredients' | 'products' | 'recipes' | 'movements';

const messages: Record<string, string> = {
  INSUFFICIENT_STOCK: 'El ajuste supera el stock disponible. Revisa el saldo e inténtalo de nuevo.',
  ADJUSTMENT_DIRECTION_INVALID: 'La cantidad no coincide con la dirección permitida para este movimiento.',
  INVALID_INVENTORY_ADJUSTMENT: 'Revisa la cantidad, el tipo de ajuste y la razón.',
  INVALID_PRESENTATION: 'Revisa el nombre y el contenido de la presentación.',
  PRESENTATION_NOT_FOUND: 'La presentación ya no está activa. Actualiza la lista.',
  INCOMPATIBLE_MEASUREMENT_DIMENSIONS: 'No hay equivalencia configurada para ese ingrediente y unidad.',
  MEASUREMENT_UNIT_INVALID: 'La unidad seleccionada ya no está disponible.',
  INGREDIENT_NOT_FOUND_OR_INACTIVE: 'El ingrediente está inactivo o ya no existe.',
  IDEMPOTENCY_KEY_REUSED: 'Esta clave ya se usó con datos distintos. No repitas la operación; revisa el historial.',
  RECIPE_PRODUCT_STOCK_IS_DERIVED: 'Este producto tiene receta: su disponibilidad depende de los ingredientes.',
  DUPLICATE_RECIPE_INGREDIENT: 'No puedes agregar el mismo ingrediente dos veces.',
  INVALID_RECIPE: 'Revisa que la receta tenga hasta 30 ingredientes y cantidades válidas.',
  INGREDIENT_NOT_FOUND: 'El ingrediente ya no está disponible. Actualiza la lista.',
  PRODUCT_NOT_FOUND: 'El producto ya no está disponible. Actualiza la lista.',
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'La sesión expiró. Vuelve a iniciar sesión.';
    if (error.status === 403 || error.code === '42501') return 'Tu rol no tiene permiso para esta operación.';
    if (error.code && messages[error.code]) return messages[error.code];
    return error.message;
  }
  return 'No se pudo completar la operación. Revisa tu conexión e inténtalo de nuevo.';
}

export function InventoryPage({ onUnsavedChangesChange }: { onUnsavedChangesChange?: (dirty: boolean) => void }) {
  const { session, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const tokenRef = useRef(session?.accessToken ?? '');
  tokenRef.current = session?.accessToken ?? tokenRef.current;
  const service = useMemo(() => createInventoryService(httpClient, () => tokenRef.current), []);
  const catalogLoaded = useRef(false);
  const recipeRequestId = useRef(0);
  const movementRequestId = useRef(0);
  const isAdmin = session?.profile.role === 'admin';
  const canAdjust = isAdmin || session?.profile.role === 'cashier';

  const [tab, setTab] = useState<Tab>('ingredients');
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [measurementUnits, setMeasurementUnits] = useState<MeasurementUnit[]>([]);
  const [ingredientConversions, setIngredientConversions] = useState<Record<string, Record<string, number>>>({});
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<{ id?: string; name: string; unit: 'g' | 'ml' | 'unit'; minStock: string; active: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);
  const [adjustment, setAdjustment] = useState({ type: 'purchase' as IngredientAdjustmentType, quantity: '', reason: '', unitCode: 'g', presentationId: '' });
  const [presentations, setPresentations] = useState<IngredientPresentation[]>([]);
  const [presentationIngredient, setPresentationIngredient] = useState<Ingredient | null>(null);
  const [presentationForm, setPresentationForm] = useState<{ id?: string; name: string; unitCode: string; quantityInBase: string; active: boolean } | null>(null);
  const [conversionForm, setConversionForm] = useState<{ unitCode: string; quantityInBase: string } | null>(null);
  const [retryInput, setRetryInput] = useState<{
    ingredientId: string; delta: number; unitCode: string; presentationId: string; type: IngredientAdjustmentType; idempotencyKey: string; reason?: string;
  } | null>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [recipe, setRecipe] = useState<RecipeLine[]>([]);
  const [recipeRows, setRecipeRows] = useState<RecipeDraftRow[]>([]);
  const [recipeDirty, setRecipeDirty] = useState(false);
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [selectedMovementProductId, setSelectedMovementProductId] = useState('');
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [ingredientStatus, setIngredientStatus] = useState<'all' | 'active' | 'inactive' | 'low' | 'empty'>('all');
  const [productSearch, setProductSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState('');
  const [movementDirection, setMovementDirection] = useState<'all' | 'in' | 'out'>('all');
  const [movementFrom, setMovementFrom] = useState('');
  const [movementTo, setMovementTo] = useState('');
  useEffect(() => {
    onUnsavedChangesChange?.(recipeDirty);
    return () => onUnsavedChangesChange?.(false);
  }, [onUnsavedChangesChange, recipeDirty]);

  useEffect(() => {
    if (!recipeDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [recipeDirty]);

  const authorized = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 401) throw cause;
      const refreshed = await refreshSession().catch(() => null);
      if (refreshed) {
        tokenRef.current = refreshed.accessToken;
        return operation();
      }
      await signOut();
      navigate('/admin/login', { replace: true });
      throw cause;
    }
  }, [navigate, refreshSession, signOut]);

  const load = useCallback(async () => {
    if (catalogLoaded.current) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [nextIngredients, nextProducts, units] = await authorized(() => Promise.all([
        service.listIngredients(),
        service.listProducts(),
        service.listMeasurementUnits(),
      ]));
      setIngredients(nextIngredients);
      setProducts(nextProducts);
      setMeasurementUnits(units);
      if (!catalogLoaded.current) {
        if (nextIngredients.length) setSelectedIngredientId(nextIngredients[0].id);
        if (nextProducts.length) setSelectedProductId(nextProducts[0].id);
        catalogLoaded.current = true;
      }
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authorized, service]);

  useEffect(() => { void load(); }, [load]);

  const productStockAdjustment = useProductStockAdjustment({
    adjustProductStock: service.adjustProductStock,
    authorize: authorized,
    mapError: messageFor,
    onSaved: load,
  });
  const {
    product: selectedStockProduct,
    draft: productAdjustmentDraft,
    error: productAdjustmentError,
    success: productAdjustmentSuccess,
    balanceMessage: productBalanceMessage,
    submitting: productAdjustmentSubmitting,
    open: openProductAdjustment,
    close: closeProductAdjustment,
    updateDraft: updateProductAdjustmentDraft,
    submit: submitProductAdjustment,
  } = productStockAdjustment;
  useEffect(() => {
    if (!adjusting) return;
    void authorized(() => Promise.all([
      service.listIngredientUnitConversions(adjusting.id),
      service.listIngredientPresentations(adjusting.id),
    ])).then(([rows, nextPresentations]) => {
      setIngredientConversions(current => ({
        ...current,
        [adjusting.id]: Object.fromEntries(rows.map(row => [row.unitCode, row.quantityInBase])),
      }));
      setPresentations(nextPresentations);
    }).catch(cause => setError(messageFor(cause)));
  }, [adjusting, authorized, service]);

  useEffect(() => {
    if (tab !== 'recipes') return;
    const ingredientIds = [...new Set(recipeRows.map(row => row.ingredientId).filter(Boolean))];
    const missing = ingredientIds.filter(id => !ingredientConversions[id]);
    if (!missing.length) return;
    void authorized(() => Promise.all(missing.map(id => service.listIngredientUnitConversions(id)))).then(results => {
      setIngredientConversions(current => {
        const next = { ...current };
        missing.forEach((id, index) => {
          next[id] = Object.fromEntries(results[index].map(row => [row.unitCode, row.quantityInBase]));
        });
        return next;
      });
    }).catch(cause => setError(messageFor(cause)));
  }, [authorized, ingredientConversions, recipeRows, service, tab]);

  const loadRecipe = useCallback(async (productId: string) => {
    const requestId = ++recipeRequestId.current;
    if (!productId) {
      setRecipe([]);
      setRecipeRows([]);
      return;
    }
    setError('');
    try {
      const nextRecipe = await authorized(() => service.listRecipe(productId));
      if (requestId !== recipeRequestId.current) return;
      setRecipe(nextRecipe);
      setRecipeRows(nextRecipe.map(line => ({
        id: crypto.randomUUID(),
        ingredientId: line.ingredientId,
        quantity: String(line.preparationQuantity ?? line.quantityPerPortion),
        unitCode: line.preparationUnitCode ?? line.unit,
      })));
      setRecipeDirty(false);
    } catch (cause) {
      if (requestId === recipeRequestId.current) setError(messageFor(cause));
    }
  }, [authorized, service]);

  useEffect(() => { if (tab === 'recipes') void loadRecipe(selectedProductId); }, [tab, selectedProductId, loadRecipe]);

  const loadMovements = useCallback(async (ingredientId: string) => {
    if (!ingredientId) return;
    setSelectedIngredientId(ingredientId);
    setSelectedMovementProductId('');
    setTab('movements');
  }, []);

  useEffect(() => {
    if (tab !== 'movements' || (!selectedIngredientId && !selectedMovementProductId)) return;
    const requestId = ++movementRequestId.current;
    const filter = selectedIngredientId ? { ingredientId: selectedIngredientId } : { productId: selectedMovementProductId };
    setError('');
    setMovements([]);
    void authorized(() => service.listInventoryMovements(filter)).then(result => {
      if (requestId === movementRequestId.current) setMovements(result);
    }).catch(cause => {
      if (requestId === movementRequestId.current) setError(messageFor(cause));
    });
    return () => { movementRequestId.current += 1; };
  }, [authorized, selectedIngredientId, selectedMovementProductId, service, tab]);

  async function saveIngredient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const minStock = Number(form.minStock);
    if (!form.name.trim() || !form.minStock.trim() || !Number.isFinite(minStock) || minStock < 0
      || Math.abs(minStock * 1000 - Math.round(minStock * 1000)) > 1e-7) {
      setError('Indica un nombre y un mínimo no negativo de hasta tres decimales.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await authorized(() => form.id
        ? service.updateIngredient(form.id, { name: form.name, minStock, active: form.active })
        : service.createIngredient({ name: form.name, unit: form.unit, minStock, active: true }));
      setForm(null);
      await load();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  }

  async function submitAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjusting) return;
    const quantity = parseQuantity(adjustment.quantity, { allowNegative: isSignedAdjustment(adjustment.type) });
    if (quantity === null) {
      setError(isSignedAdjustment(adjustment.type)
        ? 'El cambio debe ser distinto de cero y tener hasta tres decimales.'
        : 'La cantidad debe ser positiva y tener hasta tres decimales.');
      return;
    }
    const delta = adjustmentDelta(adjustment.type, quantity);
    const input = {
      ingredientId: adjusting.id,
      delta: adjustment.presentationId ? quantity : delta,
      unitCode: adjustment.presentationId ? '' : adjustment.unitCode,
      presentationId: adjustment.presentationId,
      type: adjustment.type,
      idempotencyKey: retryInput?.ingredientId === adjusting.id
        && retryInput.delta === (adjustment.presentationId ? quantity : delta)
        && retryInput.unitCode === (adjustment.presentationId ? '' : adjustment.unitCode)
        && retryInput.presentationId === adjustment.presentationId
        && retryInput.type === adjustment.type
        && retryInput.reason === (adjustment.reason.trim() || undefined)
        ? retryInput.idempotencyKey
        : newIdempotencyKey(),
      reason: adjustment.reason.trim() || undefined,
    };
    const reasonError = validateReason(adjustment.reason);
    if (reasonError) {
      setError(reasonError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (input.presentationId && input.type === 'purchase') {
        await authorized(() => service.purchaseIngredientPresentation({
          ingredientId: input.ingredientId, presentationId: input.presentationId,
          quantity, idempotencyKey: input.idempotencyKey, reason: input.reason,
        }));
      } else {
        await authorized(() => service.adjustIngredientStock(input));
      }
      setRetryInput(null);
      setAdjusting(null);
      setSuccess('Movimiento registrado correctamente.');
      await load();
    } catch (cause) {
      setRetryInput(input);
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  }

  async function savePresentation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!presentationIngredient || !presentationForm) return;
    const quantityInBase = Number(presentationForm.quantityInBase);
    if (!presentationForm.name.trim() || !presentationForm.unitCode || !presentationForm.quantityInBase.trim() || !Number.isFinite(quantityInBase)
      || quantityInBase <= 0 || Math.abs(quantityInBase * 1000 - Math.round(quantityInBase * 1000)) > 1e-7) {
      setError('Indica nombre y contenido positivo, con hasta tres decimales en la unidad base.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (presentationForm.id) {
        await authorized(() => service.updateIngredientPresentation(presentationForm.id!, {
          name: presentationForm.name, quantityInBase, active: presentationForm.active,
        }));
      } else {
        await authorized(() => service.createIngredientPresentation({
          ingredientId: presentationIngredient.id, name: presentationForm.name,
          unitCode: presentationForm.unitCode, quantityInBase,
        }));
      }
      setPresentationForm(null);
      setPresentations(await authorized(() => service.listIngredientPresentations(presentationIngredient.id, true)));
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  }

  async function openPresentations(ingredient: Ingredient) {
    setError('');
    setPresentationIngredient(ingredient);
    setPresentationForm(null);
    setConversionForm(null);
    try {
      const [nextPresentations, conversions] = await authorized(() => Promise.all([
        service.listIngredientPresentations(ingredient.id, true),
        service.listIngredientUnitConversions(ingredient.id),
      ]));
      setPresentations(nextPresentations);
      setIngredientConversions(current => ({
        ...current,
        [ingredient.id]: Object.fromEntries(conversions.map(item => [item.unitCode, item.quantityInBase])),
      }));
    } catch (cause) {
      setError(messageFor(cause));
    }
  }

  async function saveConversion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!presentationIngredient || !conversionForm) return;
    const quantityInBase = Number(conversionForm.quantityInBase);
    if (!conversionForm.unitCode || !conversionForm.quantityInBase.trim() || !Number.isFinite(quantityInBase) || quantityInBase <= 0) {
      setError('Indica una equivalencia positiva para la unidad seleccionada.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await authorized(() => service.saveIngredientUnitConversion({
        ingredientId: presentationIngredient.id,
        unitCode: conversionForm.unitCode,
        quantityInBase,
      }));
      const conversions = await authorized(() => service.listIngredientUnitConversions(presentationIngredient.id));
      setIngredientConversions(current => ({
        ...current,
        [presentationIngredient.id]: Object.fromEntries(conversions.map(item => [item.unitCode, item.quantityInBase])),
      }));
      setConversionForm(null);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  }

  function updateRecipeRow(rowId: string, changes: Partial<RecipeDraftRow>) {
    setRecipeRows(rows => rows.map(row => row.id === rowId ? { ...row, ...changes } : row));
    setRecipeDirty(true);
  }

  function changeTab(nextTab: Tab) {
    if (recipeDirty && nextTab !== tab && !window.confirm('Hay cambios sin guardar en la receta. ¿Descartarlos y cambiar de sección?')) return;
    setRecipeDirty(false);
    setTab(nextTab);
  }

  function changeRecipeProduct(productId: string) {
    if (recipeDirty && !window.confirm('Hay cambios sin guardar en la receta. ¿Descartarlos y cambiar de producto?')) return;
    setRecipeDirty(false);
    setSelectedProductId(productId);
  }

  async function saveRecipe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recipeRows.length === 0) {
      setError('Agrega al menos un ingrediente. No se permite eliminar una receta guardando una lista vacía.');
      return;
    }
    if (recipeRows.some(row => !row.ingredientId || !row.quantity.trim() || !row.unitCode)) {
      setError('Completa todas las líneas de la receta o elimínalas antes de guardar.');
      return;
    }
    if (recipeRows.some(row => !ingredients.find(item => item.id === row.ingredientId)?.active)) {
      setError('Sustituye los ingredientes inactivos antes de guardar la receta.');
      return;
    }
    const lines = recipeRows.map(row => ({
      ingredientId: row.ingredientId,
      quantity: Number(row.quantity),
      unitCode: row.unitCode,
    }));
    if (lines.length > 30 || lines.some(line => !line.unitCode || !Number.isFinite(line.quantity)
      || line.quantity <= 0 || Math.abs(line.quantity * 1000 - Math.round(line.quantity * 1000)) > 1e-7)) {
      setError('Cada línea requiere una cantidad positiva de hasta tres decimales; máximo 30 ingredientes.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await authorized(() => service.replaceRecipe(selectedProductId, lines));
      setRecipeDirty(false);
      await loadRecipe(selectedProductId);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  }

  const lowStockCount = ingredients.filter(item => item.active && item.stock <= item.minStock).length;
  const activeIngredients = useMemo(() => ingredients.filter(item => item.active), [ingredients]);
  const filteredIngredients = ingredients.filter(item => {
    const matchesSearch = item.name.toLocaleLowerCase('es').includes(ingredientSearch.trim().toLocaleLowerCase('es'));
    const matchesStatus = ingredientStatus === 'all'
      || (ingredientStatus === 'active' && item.active)
      || (ingredientStatus === 'inactive' && !item.active)
      || (ingredientStatus === 'low' && item.active && item.stock <= item.minStock)
      || (ingredientStatus === 'empty' && item.active && item.stock === 0);
    return matchesSearch && matchesStatus;
  });
  const filteredProducts = products.filter(product => product.name.toLocaleLowerCase('es').includes(productSearch.trim().toLocaleLowerCase('es')));
  const filteredMovements = movements.filter(item => {
    const movementDate = item.createdAt.slice(0, 10);
    return (!movementTypeFilter || item.type === movementTypeFilter)
      && (movementDirection === 'all' || (movementDirection === 'in' && item.quantityDelta > 0)
        || (movementDirection === 'out' && item.quantityDelta < 0))
      && (!movementFrom || movementDate >= movementFrom)
      && (!movementTo || movementDate <= movementTo);
  });
  const ingredientStatusOptions = [
    { label: 'Todos', value: 'all' },
    { label: 'Activos', value: 'active' },
    { label: 'Inactivos', value: 'inactive' },
    { label: 'Bajo mínimo', value: 'low' },
    { label: 'Agotados', value: 'empty' },
  ];
  const movementTypeOptions = [
    { label: 'Todos los tipos', value: '' },
    ...[...new Set(movements.map(item => item.type))].map(type => ({ label: movementLabels[type] ?? 'Otro movimiento', value: type })),
  ];
  const movementDirectionOptions = [
    { label: 'Entradas y salidas', value: 'all' },
    { label: 'Entradas', value: 'in' },
    { label: 'Salidas', value: 'out' },
  ];
  const toCalendarDate = (value: string) => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const fromCalendarDate = (value: Date | null | undefined) => value
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : '';
  return (
    <section className="inventory-page" aria-labelledby="inventory-heading">
      <header className="inventory-heading">
        <div>
          <span className="inventory-eyebrow">OPERACIÓN · EXISTENCIAS</span>
          <h2 id="inventory-heading">Inventario y recetas</h2>
          <p>Control auditable de ingredientes, preparación y movimientos.</p>
        </div>
        <Button type="button" label={refreshing ? 'Actualizando…' : 'Actualizar'} icon="pi pi-refresh" outlined severity="secondary" onClick={() => void load()} disabled={loading || refreshing} />
      </header>

      {success && <div className="inventory-success" role="status">{success}</div>}
      {error && <div className="inventory-alert" role="alert"><AlertTriangle size={18} /> <span>{error}</span></div>}
      {!error && lowStockCount > 0 && (
        <div className="inventory-notice" role="status">
          <AlertTriangle size={18} /> {lowStockCount} ingrediente{lowStockCount === 1 ? '' : 's'} en o bajo el mínimo.
        </div>
      )}

      <nav className="inventory-tabs" aria-label="Secciones de inventario">
        {([
          ['ingredients', 'Ingredientes', Boxes],
          ['products', 'Productos terminados', PackagePlus],
          ['recipes', 'Recetas', ClipboardList],
          ['movements', 'Movimientos', History],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" className={tab === key ? 'is-active' : ''} onClick={() => changeTab(key)} aria-current={tab === key ? 'page' : undefined}>
            <Icon size={17} aria-hidden="true" /> {label}
          </button>
        ))}
      </nav>

      {tab === 'ingredients' && (
        <div className="inventory-card">
          <div className="inventory-card-heading">
            <div><h3>Ingredientes</h3><p>Unidades base: gramos, mililitros y unidades.</p></div>
            {isAdmin && <Button type="button" label="Nuevo ingrediente" icon="pi pi-plus" onClick={() => setForm({ name: '', unit: 'g', minStock: '0', active: true })} />}
          </div>
          {loading ? <p className="inventory-state" role="status">Cargando ingredientes…</p> : ingredients.length === 0 ? (
            <p className="inventory-state">Todavía no hay ingredientes registrados.</p>
          ) : (
            <>
            <div className="inventory-list-filters">
              <label className="inventory-field"><span>Buscar ingrediente</span><InputText type="search" value={ingredientSearch} onChange={event => setIngredientSearch(event.target.value)} placeholder="Nombre del ingrediente" /></label>
              <label className="inventory-field"><span>Estado y existencias</span><Dropdown value={ingredientStatus} options={ingredientStatusOptions} onChange={event => setIngredientStatus(event.value)} /></label>
            </div>
            <div className="inventory-table-wrap">
              <DataTable value={filteredIngredients} dataKey="id" size="small" stripedRows paginator rows={20} responsiveLayout="scroll" emptyMessage="No hay ingredientes que coincidan con la búsqueda y los filtros.">
                <Column field="name" header="Ingrediente" body={(item: Ingredient) => <><strong>{item.name}</strong><small>{item.unit}</small></>} />
                <Column header="Existencia" body={(item: Ingredient) => <>{formatQuantity(item.stock)} <span className="inventory-unit">{item.unit}</span></>} />
                <Column header="Mínimo" body={(item: Ingredient) => <>{formatQuantity(item.minStock)} <span className="inventory-unit">{item.unit}</span></>} />
                <Column header="Estado" body={(item: Ingredient) => {
                  const low = item.stock <= item.minStock;
                  return <Tag severity={!item.active ? 'secondary' : low ? 'warning' : 'success'} value={!item.active ? 'Inactivo' : low ? 'Bajo mínimo' : 'Disponible'} />;
                }} />
                <Column header="Acciones" body={(item: Ingredient) => <div className="inventory-row-actions">
                      {canAdjust && item.active && <Button className="p-button-sm" type="button" label="Ajustar" icon="pi pi-plus-circle" outlined onClick={() => {
                        setAdjusting(item);
                        setAdjustment({ type: item.stock === 0 ? 'opening_balance' : 'purchase', quantity: '', reason: '', unitCode: item.unit, presentationId: '' });
                        setRetryInput(null);
                      }} />}
                      {isAdmin && <Button type="button" label="Presentaciones" size="small" text onClick={() => void openPresentations(item)} />}
                      <Button type="button" icon="pi pi-history" text rounded aria-label={`Ver movimientos de ${item.name}`} tooltip="Ver movimientos" onClick={() => void loadMovements(item.id)} />
                      {isAdmin && <Button type="button" icon="pi pi-pencil" text rounded aria-label={`Editar ${item.name}`} tooltip="Editar ingrediente" onClick={() => setForm({ id: item.id, name: item.name, unit: item.unit, minStock: String(item.minStock), active: item.active })} />}
                      {isAdmin && <Button type="button" icon={item.active ? 'pi pi-toggle-on' : 'pi pi-toggle-off'} text rounded aria-label={item.active ? `Desactivar ${item.name}` : `Activar ${item.name}`} tooltip={item.active ? 'Desactivar' : 'Activar'} onClick={async () => {
                        setError('');
                        try {
                          await authorized(() => service.updateIngredient(item.id, { active: !item.active }));
                          await load();
                        } catch (cause) { setError(messageFor(cause)); }
                      }} />}
                    </div>} />
              </DataTable>
            </div>
            </>
          )}
        </div>
      )}

      {tab === 'products' && (
        <div className="inventory-card">
          <div className="inventory-card-heading"><div><h3>Productos terminados</h3><p>El stock propio solo se ajusta si el producto no depende de una receta.</p></div></div>
          <label className="inventory-field inventory-product-select"><span>Buscar producto</span><InputText type="search" value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Nombre del producto" /></label>
          {loading ? <p className="inventory-state" role="status">Cargando productos…</p> : products.length === 0 ? <p className="inventory-state">No hay productos disponibles.</p> : <>
            <div className="inventory-table-wrap"><DataTable value={filteredProducts} dataKey="id" size="small" stripedRows paginator rows={20} responsiveLayout="scroll" emptyMessage="No hay productos que coincidan con la búsqueda.">
              <Column field="name" header="Producto" body={(product: InventoryProduct) => <strong>{product.name}</strong>} />
              <Column header="Disponibilidad" body={(product: InventoryProduct) => product.hasRecipe ? product.availableQuantity === null ? 'No disponible' : `${formatQuantity(product.availableQuantity)} porciones estimadas` : `${formatQuantity(product.stock)} unidades`} />
              <Column header="Existencias" body={(product: InventoryProduct) => product.hasRecipe ? 'Derivada de ingredientes' : 'Stock propio'} />
              <Column header="Estado" body={(product: InventoryProduct) => <Tag severity={product.active ? 'success' : 'secondary'} value={product.active ? 'Activo' : 'Inactivo'} />} />
              <Column header="Acciones" body={(product: InventoryProduct) => product.hasRecipe ? <span className="inventory-helper">Stock derivado</span> : !product.active ? <span className="inventory-helper">No disponible</span> : canAdjust ? <Button type="button" label="Ajustar stock" icon="pi pi-plus-circle" size="small" outlined disabled={productAdjustmentSubmitting} onClick={() => openProductAdjustment(product)} /> : <span className="inventory-helper">Solo personal autorizado</span>} />
            </DataTable></div>
          </>}
        </div>
      )}

      <ProductStockAdjustmentDialog
        product={selectedStockProduct}
        draft={productAdjustmentDraft}
        error={productAdjustmentError}
        success={productAdjustmentSuccess}
        balanceMessage={productBalanceMessage}
        saving={productAdjustmentSubmitting}
        onDraftChange={updateProductAdjustmentDraft}
        onClose={closeProductAdjustment}
        onSubmit={submitProductAdjustment}
      />

      {tab === 'recipes' && (
        <form className="inventory-card" onSubmit={saveRecipe}>
          <div className="inventory-card-heading">
            <div><h3>Receta por producto</h3><p>Guardar reemplaza la receta completa; eliminar requiere una acción y confirmación separadas.</p></div>
            <label className="inventory-field inventory-product-select"><span>Producto</span>
              <Dropdown value={selectedProductId} options={products.map(product => ({ label: product.name, value: product.id }))} onChange={event => changeRecipeProduct(event.value)} placeholder="Selecciona un producto" />
            </label>
          </div>
          {!selectedProductId ? <p className="inventory-state">No hay productos disponibles para seleccionar.</p> : (
            <>
              <div className="inventory-recipe-list">
                {recipeRows.map((row, index) => {
                  const ingredient = ingredients.find(item => item.id === row.ingredientId);
                  const currentIngredientIsInactive = recipe.find(line => line.ingredientId === row.ingredientId)?.ingredientActive === false;
                  const used = new Set(recipeRows.filter((_, other) => other !== index).map(line => line.ingredientId));
                  const baseEstimate = estimateRecipeRow(row, ingredient, measurementUnits, ingredientConversions);
                  return <div className="inventory-recipe-row" key={row.id}>
                    <label className="inventory-field"><span>Ingrediente</span><Dropdown disabled={!isAdmin || saving} value={row.ingredientId} placeholder="Selecciona ingrediente" options={[
                      ...(currentIngredientIsInactive && ingredient ? [{ label: `${ingredient.name} · Inactivo`, value: ingredient.id, disabled: true }] : []),
                      ...activeIngredients.filter(item => !used.has(item.id)).map(item => ({ label: item.name, value: item.id })),
                    ]} onChange={event => {
                      const selected = activeIngredients.find(item => item.id === event.value);
                      updateRecipeRow(row.id, { ingredientId: event.value, unitCode: selected?.unit ?? '' });
                    }} /></label>
                    <label className="inventory-field"><span>Unidad de preparación</span>
                       <MeasurementUnitSelect units={measurementUnits} value={row.unitCode} disabled={!isAdmin || saving}
                          compatibleCodes={compatibleUnits(ingredient, measurementUnits, ingredientConversions)}
                         onChange={unitCode => updateRecipeRow(row.id, { unitCode })} />
                    </label>
                    <label className="inventory-field"><span>Cantidad por porción</span><InputNumber disabled={!isAdmin || saving} min={0.001} max={999999999} minFractionDigits={0} maxFractionDigits={3} value={row.quantity ? Number(row.quantity) : null} onValueChange={event => updateRecipeRow(row.id, { quantity: event.value == null ? '' : String(event.value) })} />
                      {currentIngredientIsInactive && <small role="alert">Ingrediente inactivo; la receta no se puede volver a guardar hasta sustituirlo.</small>}
                      {ingredient && baseEstimate !== null && <small>Equivale a {formatQuantity(baseEstimate)} {ingredient.unit} (validación final en servidor).</small>}
                    </label>
                    {isAdmin && <Button className="inventory-remove-button" type="button" icon="pi pi-times" text rounded aria-label="Quitar ingrediente de la receta" onClick={() => {
                      setRecipeRows(rows => rows.filter((_, rowIndex) => rowIndex !== index));
                      setRecipeDirty(true);
                    }} />}
                  </div>;
                })}
                {recipeRows.length === 0 && <p className="inventory-state">Este producto no tiene receta. Su stock propio no se administra desde ingredientes.</p>}
              </div>
              {isAdmin && activeIngredients.length > recipeRows.length && recipeRows.length < 30 && <Button type="button" label="Agregar ingrediente" icon="pi pi-plus" outlined severity="secondary" onClick={() => {
                setRecipeRows(rows => [...rows, newRecipeRow()]);
                setRecipeDirty(true);
              }} />}
              {isAdmin && <div className="inventory-form-footer">
                <span>Máximo 30 ingredientes · cantidades con hasta 3 decimales.</span>
                {recipe.length > 0 && <Button type="button" label="Eliminar receta" icon="pi pi-trash" outlined severity="danger" disabled={saving} onClick={async () => {
                  if (!window.confirm(`¿Eliminar la receta completa de ${products.find(product => product.id === selectedProductId)?.name ?? 'este producto'}? Los pedidos anteriores no cambiarán.`)) return;
                  setSaving(true);
                  setError('');
                  try {
                    await authorized(() => service.deleteRecipe(selectedProductId));
                    setRecipe([]);
                    setRecipeRows([]);
                    setRecipeDirty(false);
                  } catch (cause) {
                    setError(messageFor(cause));
                  } finally {
                    setSaving(false);
                  }
                }} />}
                <Button type="submit" label={saving ? 'Guardando…' : 'Guardar receta'} icon="pi pi-check" disabled={saving || !recipeDirty} />
              </div>}
            </>
          )}
          {recipe.length > 0 && <p className="inventory-helper">Hay {recipe.length} ingrediente{recipe.length === 1 ? '' : 's'} en la receta guardada. Los pedidos existentes conservan sus snapshots.</p>}
        </form>
      )}

      {tab === 'movements' && (
        <div className="inventory-card">
          <div className="inventory-card-heading">
            <div><h3>Libro de movimientos</h3><p>Historial de solo lectura; cada ajuste se registra mediante RPC.</p></div>
            <div className="inventory-movement-filters">
              <label className="inventory-field inventory-product-select"><span>Ingrediente</span><Dropdown value={selectedIngredientId} options={[{ label: 'Selecciona ingrediente', value: '' }, ...ingredients.map(item => ({ label: item.name, value: item.id }))]} onChange={event => {
                setSelectedMovementProductId('');
                setSelectedIngredientId(event.value);
                setMovements([]);
              }} /></label>
              <label className="inventory-field inventory-product-select"><span>Producto</span><Dropdown value={selectedMovementProductId} options={[{ label: 'Selecciona producto', value: '' }, ...products.map(product => ({ label: product.name, value: product.id }))]} onChange={event => {
                const productId = event.value;
                setSelectedMovementProductId(productId);
                setSelectedIngredientId('');
                setMovements([]);
              }} /></label>
              <label className="inventory-field"><span>Tipo</span><Dropdown value={movementTypeFilter} options={movementTypeOptions} onChange={event => setMovementTypeFilter(event.value)} /></label>
              <label className="inventory-field"><span>Dirección</span><Dropdown value={movementDirection} options={movementDirectionOptions} onChange={event => setMovementDirection(event.value)} /></label>
              <label className="inventory-field"><span>Desde</span><Calendar value={toCalendarDate(movementFrom)} onChange={event => setMovementFrom(fromCalendarDate(event.value as Date | null))} dateFormat={CALENDAR_DATE_FORMAT} locale={APP_LOCALE} showIcon maxDate={toCalendarDate(movementTo) ?? undefined} /></label>
              <label className="inventory-field"><span>Hasta</span><Calendar value={toCalendarDate(movementTo)} onChange={event => setMovementTo(fromCalendarDate(event.value as Date | null))} dateFormat={CALENDAR_DATE_FORMAT} locale={APP_LOCALE} showIcon minDate={toCalendarDate(movementFrom) ?? undefined} /></label>
            </div>
          </div>
          {!selectedIngredientId && !selectedMovementProductId ? <p className="inventory-state">Selecciona un ingrediente o producto para consultar movimientos.</p> : movements.length === 0 ? (
            <p className="inventory-state">No hay movimientos para este ingrediente.</p>
          ) : filteredMovements.length === 0 ? <p className="inventory-state">No hay movimientos para los filtros seleccionados.</p> : <><div className="inventory-table-wrap"><DataTable value={filteredMovements} dataKey="id" size="small" stripedRows paginator rows={20} responsiveLayout="scroll" emptyMessage="No hay movimientos disponibles.">
            <Column header="Fecha" body={(movement: InventoryMovement) => new Date(movement.createdAt).toLocaleString(APP_LOCALE)} />
            <Column header="Tipo" body={(movement: InventoryMovement) => <Tag value={movementLabels[movement.type] ?? 'Otro movimiento'} severity={movement.quantityDelta < 0 ? 'warning' : 'success'} />} />
            <Column header="Cantidad" body={(movement: InventoryMovement) => {
              const unit = movement.ingredientId
                ? ingredients.find(ingredient => ingredient.id === movement.ingredientId)?.unit
                : 'unidades';
              return <span className={movement.quantityDelta < 0 ? 'inventory-negative' : 'inventory-positive'}>{movement.quantityDelta > 0 ? '+' : ''}{formatQuantity(movement.quantityDelta)} {unit}</span>;
            }} />
            <Column header="Razón" body={(movement: InventoryMovement) => movement.reason || '—'} />
            <Column header="Usuario" body={(movement: InventoryMovement) => movement.createdBy ? 'Personal autorizado' : '—'} />
          </DataTable></div></>}
        </div>
      )}

      {form && <Dialog visible modal header={form.id ? 'Editar ingrediente' : 'Nuevo ingrediente'} className="inventory-dialog" closable={!saving} closeOnEscape={!saving} dismissableMask={!saving} onHide={() => { if (!saving) setForm(null); }}>
        <form className="inventory-modal" onSubmit={saveIngredient}>
          <p className="inventory-helper">El saldo comienza en cero y se registra como movimiento inicial.</p>
          {error && <div className="inventory-alert" role="alert">{error}</div>}
          <label className="inventory-field"><span>Nombre</span><InputText autoFocus required maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
          <label className="inventory-field"><span>Unidad base</span><Dropdown value={form.unit} disabled={Boolean(form.id)} options={[{ label: 'Gramos (g)', value: 'g' }, { label: 'Mililitros (ml)', value: 'ml' }, { label: 'Unidad (unidad)', value: 'unit' }]} onChange={event => setForm({ ...form, unit: event.value })} /><small>La unidad base no se podrá cambiar cuando existan movimientos o recetas asociados.</small></label>
          <label className="inventory-field"><span>Stock mínimo ({form.unit})</span><InputNumber min={0} minFractionDigits={0} maxFractionDigits={3} value={form.minStock.trim() ? Number(form.minStock) : null} onValueChange={event => setForm({ ...form, minStock: event.value == null ? '' : String(event.value) })} /></label>
          {form.id && <div className="inventory-checkbox"><InputSwitch inputId="ingredient-active" checked={form.active} onChange={event => setForm({ ...form, active: event.value })} /><label htmlFor="ingredient-active">Ingrediente activo</label></div>}
          <div className="inventory-form-footer"><Button type="button" label="Cancelar" outlined severity="secondary" onClick={() => setForm(null)} /><Button label={saving ? 'Guardando…' : 'Guardar'} icon="pi pi-check" disabled={saving} /></div>
        </form>
      </Dialog>}

      {presentationIngredient && <Dialog visible modal header={`Presentaciones de ${presentationIngredient.name}`} className="inventory-dialog inventory-dialog--wide" closable={!saving} closeOnEscape={!saving} dismissableMask={!saving} onHide={() => {
        if (!saving) { setPresentationIngredient(null); setPresentationForm(null); }
      }}>
        <section className="inventory-modal">
          <p className="inventory-helper">Contenido expresado en {presentationIngredient.unit}.</p>
          {error && <div className="inventory-alert" role="alert">{error}</div>}
          <section className="inventory-measurement-settings" aria-labelledby="conversion-heading">
            <div><h4 id="conversion-heading">Equivalencias de {presentationIngredient.name}</h4><p>Define cuánto equivale una unidad seleccionada en {presentationIngredient.unit}. Solo para este ingrediente.</p></div>
            {Object.entries(ingredientConversions[presentationIngredient.id] ?? {}).length > 0 && <ul>
              {Object.entries(ingredientConversions[presentationIngredient.id] ?? {}).map(([unitCode, amount]) => (
                <li key={unitCode}><span>{measurementUnits.find(unit => unit.code === unitCode)?.name ?? unitCode}: {amount.toLocaleString('es', { maximumFractionDigits: 9 })} {presentationIngredient.unit}</span>
                  {isAdmin && <Button className="p-button-sm" label="Quitar" type="button" text severity="danger" disabled={saving} onClick={async () => {
                    setError('');
                    try {
                      await authorized(() => service.deleteIngredientUnitConversion(presentationIngredient.id, unitCode));
                      setIngredientConversions(current => {
                        const next = { ...current, [presentationIngredient.id]: { ...current[presentationIngredient.id] } };
                        delete next[presentationIngredient.id][unitCode];
                        return next;
                      });
                    } catch (cause) { setError(messageFor(cause)); }
                  }} />}
                </li>
              ))}
            </ul>}
            {isAdmin && (conversionForm ? <form className="inventory-presentation-form" onSubmit={saveConversion}>
              <label className="inventory-field"><span>Unidad no compatible automáticamente</span><Dropdown required value={conversionForm.unitCode} options={measurementUnits.filter(unit => unit.category !== 'purchase' && unit.baseUnit !== presentationIngredient.unit).map(unit => ({ label: `${unit.name} (${unit.abbreviation})`, value: unit.code }))} placeholder="Selecciona unidad" onChange={event => setConversionForm({ ...conversionForm, unitCode: event.value })} /></label>
              <label className="inventory-field"><span>Equivalencia en {presentationIngredient.unit}</span><InputNumber required min={0.000000001} minFractionDigits={0} maxFractionDigits={9} value={conversionForm.quantityInBase ? Number(conversionForm.quantityInBase) : null} onValueChange={event => setConversionForm({ ...conversionForm, quantityInBase: event.value == null ? '' : String(event.value) })} placeholder="Ej. 120" /></label>
              <div className="inventory-form-footer"><Button label="Cancelar" type="button" outlined severity="secondary" onClick={() => setConversionForm(null)} /><Button label="Guardar equivalencia" icon="pi pi-check" disabled={saving} /></div>
            </form> : <Button label="Agregar equivalencia" icon="pi pi-plus" type="button" outlined severity="secondary" onClick={() => setConversionForm({ unitCode: '', quantityInBase: '' })} />)}
          </section>
          {presentations.length === 0 ? <p className="inventory-state">No hay presentaciones configuradas.</p> : <div className="inventory-presentation-list">
            {presentations.map(item => <div className="inventory-presentation-item" key={item.id}>
              <div><strong>{item.name}</strong><small>{formatQuantity(item.quantityInBase)} {presentationIngredient.unit} por envase · {measurementUnits.find(unit => unit.code === item.unitCode)?.name ?? item.unitCode}{!item.active && ' · Inactiva'}</small></div>
              <Button className="p-button-sm" label="Editar" type="button" text onClick={() => setPresentationForm({
                id: item.id, name: item.name, unitCode: item.unitCode, quantityInBase: String(item.quantityInBase), active: item.active,
              })} />
              <Button className="p-button-sm" label={item.active ? 'Desactivar' : 'Activar'} type="button" text onClick={async () => {
                try {
                  await authorized(() => service.updateIngredientPresentation(item.id, { active: !item.active }));
                  setPresentations(await authorized(() => service.listIngredientPresentations(presentationIngredient.id, true)));
                } catch (cause) { setError(messageFor(cause)); }
              }} />
            </div>)}
          </div>}
          {presentationForm ? <form className="inventory-presentation-form" onSubmit={savePresentation}>
            <label className="inventory-field"><span>Nombre reconocible</span><InputText maxLength={80} required value={presentationForm.name} onChange={event => setPresentationForm({ ...presentationForm, name: event.target.value })} placeholder="Ej. Caja de 1 litro" /></label>
            <label className="inventory-field"><span>Tipo de envase</span><Dropdown required disabled={Boolean(presentationForm.id)} value={presentationForm.unitCode} options={measurementUnits.filter(unit => unit.category === 'purchase').map(unit => ({ label: unit.name, value: unit.code }))} placeholder="Selecciona presentación" onChange={event => setPresentationForm({ ...presentationForm, unitCode: event.value })} /></label>
            <label className="inventory-field"><span>Contenido por envase ({presentationIngredient.unit})</span><InputNumber min={0.001} minFractionDigits={0} maxFractionDigits={3} required value={presentationForm.quantityInBase ? Number(presentationForm.quantityInBase) : null} onValueChange={event => setPresentationForm({ ...presentationForm, quantityInBase: event.value == null ? '' : String(event.value) })} placeholder={presentationIngredient.unit === 'ml' ? 'Ej. 1000' : presentationIngredient.unit === 'g' ? 'Ej. 500' : 'Ej. 12'} /></label>
            <div className="inventory-form-footer">
              <Button label="Cancelar" type="button" outlined severity="secondary" onClick={() => setPresentationForm(null)} />
              <Button label="Guardar presentación" icon="pi pi-check" disabled={saving} />
            </div>
          </form> : <Button label="Agregar presentación" icon="pi pi-plus" type="button" outlined severity="secondary" onClick={() => setPresentationForm({ name: '', unitCode: '', quantityInBase: '', active: true })} />}
        </section>
      </Dialog>}

      {adjusting && <Dialog visible modal header={`Ajustar ${adjusting.name}`} className="inventory-dialog" closable={!saving} closeOnEscape={!saving} dismissableMask={!saving} onHide={() => { if (!saving) setAdjusting(null); }}>
        <form className="inventory-modal" onSubmit={submitAdjustment}>
          <p className="inventory-helper">Saldo actual: <strong>{formatQuantity(adjusting.stock)} {adjusting.unit}</strong></p>
          {error && <div className="inventory-alert" role="alert">{error}</div>}
          <label className="inventory-field"><span>Tipo de movimiento</span><Dropdown value={adjustment.type} options={adjustmentTypes.map(type => ({ label: type.label, value: type.value, disabled: type.value === 'opening_balance' && adjusting.stock > 0 }))} onChange={event => setAdjustment({ ...adjustment, type: event.value, presentationId: '' })} /></label>
          {adjustment.type === 'purchase' && presentations.length > 0 && <label className="inventory-field"><span>Presentación de compra (opcional)</span><Dropdown value={adjustment.presentationId} options={[{ label: 'Usar unidad de medida', value: '' }, ...presentations.map(item => ({ label: `${item.name} · ${formatQuantity(item.quantityInBase)} ${adjusting.unit}`, value: item.id }))]} onChange={event => setAdjustment({ ...adjustment, presentationId: event.value })} /></label>}
          {!adjustment.presentationId && <label className="inventory-field"><span>Unidad de entrada</span><MeasurementUnitSelect units={measurementUnits} value={adjustment.unitCode} compatibleCodes={compatibleUnits(adjusting, measurementUnits, ingredientConversions)} onChange={unitCode => setAdjustment({ ...adjustment, unitCode })} /></label>}
          <label className="inventory-field"><span>{adjustment.presentationId ? 'Cantidad de presentaciones' : ['count_correction', 'manual_adjustment'].includes(adjustment.type) ? 'Cambio firmado' : 'Cantidad'}</span><InputNumber required minFractionDigits={0} maxFractionDigits={3} value={adjustment.quantity ? Number(adjustment.quantity) : null} onValueChange={event => setAdjustment({ ...adjustment, quantity: event.value == null ? '' : String(event.value) })} placeholder={['count_correction', 'manual_adjustment'].includes(adjustment.type) ? 'Ej. 12 o -4' : 'Ej. 1.5'} /><small>{adjustment.presentationId ? 'Se registrará la cantidad de paquetes seleccionados.' : ['count_correction', 'manual_adjustment'].includes(adjustment.type) ? `Usa positivo para aumentar o negativo para disminuir; se convertirá a ${adjusting.unit}.` : adjustmentTypes.find(type => type.value === adjustment.type)?.sign === -1 ? `La cantidad se restará del saldo en ${adjusting.unit}.` : `La cantidad se sumará al saldo en ${adjusting.unit}.`}</small></label>
          {(() => {
            if (adjustment.presentationId && adjustment.type === 'purchase') {
              const pack = presentations.find(item => item.id === adjustment.presentationId);
              const count = Number(adjustment.quantity);
              if (!pack || !adjustment.quantity.trim() || !Number.isFinite(count) || count <= 0) return null;
              const converted = Math.round(count * pack.quantityInBase * 1000) / 1000;
              return <p className="inventory-helper">Equivale a +{formatQuantity(converted)} {adjusting.unit}. Existencia actual: {formatQuantity(adjusting.stock)}; estimada después: {formatQuantity(adjusting.stock + converted)} {adjusting.unit}. El servidor confirma el saldo final.</p>;
            }
            const estimate = estimateRecipeQuantity(String(Math.abs(Number(adjustment.quantity))), adjustment.unitCode, adjusting, measurementUnits, ingredientConversions);
            if (estimate === null) return null;
            const typeSign = adjustmentTypes.find(type => type.value === adjustment.type)?.sign ?? 0;
            const estimateDelta = typeSign === 0 ? Math.sign(Number(adjustment.quantity)) * estimate : typeSign * estimate;
            const estimatedStock = adjusting.stock + estimateDelta;
            return <p className="inventory-helper">Equivalencia: {estimateDelta < 0 ? '−' : '+'}{formatQuantity(estimate)} {adjusting.unit}. Existencia actual: {formatQuantity(adjusting.stock)}; estimada después: {formatQuantity(estimatedStock)} {adjusting.unit}. {estimatedStock < 0 ? 'La salida supera la existencia; reduce la cantidad.' : 'El servidor confirma el saldo final.'}</p>;
          })()}
          <label className="inventory-field"><span>Razón (opcional)</span><InputText maxLength={250} value={adjustment.reason} onChange={event => setAdjustment({ ...adjustment, reason: event.target.value })} placeholder="Ej. Conteo inicial" /></label>
          {retryInput?.ingredientId === adjusting.id && <p className="inventory-retry-hint">Si falló por conexión, reintentar reutilizará la misma clave para evitar duplicados.</p>}
          <div className="inventory-form-footer"><Button type="button" label="Cancelar" outlined severity="secondary" onClick={() => setAdjusting(null)} /><Button label={saving ? 'Registrando…' : 'Registrar movimiento'} icon="pi pi-check" disabled={saving} /></div>
        </form>
      </Dialog>}
    </section>
  );
}
