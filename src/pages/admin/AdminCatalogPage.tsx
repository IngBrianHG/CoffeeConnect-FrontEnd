import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { InputNumber } from 'primereact/inputnumber';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dropdown } from 'primereact/dropdown';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { TabPanel, TabView } from 'primereact/tabview';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { adminCatalogErrorMessage, createAdminCatalogService, type AdminCategory, type AdminProduct } from '../../services/adminCatalog';
import { httpClient, ApiError } from '../../services/http/client';

type Editing = { kind: 'category'; value?: AdminCategory } | { kind: 'product'; value?: AdminProduct } | null;

export function AdminCatalogPage() {
  const { session, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const token = useRef(session?.accessToken);
  token.current = session?.accessToken;
  const service = useMemo(() => createAdminCatalogService(
    httpClient,
    () => token.current,
    async () => {
      const refreshed = await refreshSession().catch(() => null);
      token.current = refreshed?.accessToken;
      return refreshed?.accessToken ?? null;
    },
  ), [refreshSession]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', categoryId: '', price: null as number | null, active: true });
  const [fieldError, setFieldError] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const imagePreview = useMemo(() => imageFile ? URL.createObjectURL(imageFile) : uploadedImageUrl, [imageFile, uploadedImageUrl]);
  useEffect(() => () => {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextCategories, nextProducts] = await Promise.all([service.listCategories(), service.listProducts()]);
      const categoryIds = new Set(nextCategories.map(category => category.id));
      if (nextProducts.some(product => !categoryIds.has(product.categoryId))) {
        throw new ApiError(200, 'El servicio devolvió productos con una categoría inexistente.', 'INVALID_RESPONSE');
      }
      setCategories(nextCategories);
      setProducts(nextProducts);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(adminCatalogErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [navigate, service, signOut]);

  useEffect(() => { void load(); }, [load]);

  function openCategory(value?: AdminCategory) {
    setEditing({ kind: 'category', value });
    setForm({ name: value?.name ?? '', description: value?.description ?? '', categoryId: '', price: null, active: value?.active ?? true });
    setImageFile(null);
    setUploadedImageUrl(null);
    setFieldError('');
  }
  function openProduct(value?: AdminProduct) {
    setEditing({ kind: 'product', value });
    setForm({ name: value?.name ?? '', description: value?.description ?? '', categoryId: value?.categoryId ?? '', price: value?.price ?? null, active: value?.active ?? true });
    setImageFile(null);
    setUploadedImageUrl(value?.imageUrl ?? null);
    setFieldError('');
  }
  async function save() {
    if (!editing) return;
    setFieldError('');
    setSaving(true);
    try {
      if (editing.kind === 'category') {
        const input = { name: form.name, description: form.description, active: form.active };
        if (editing.value) await service.updateCategory(editing.value.id, input);
        else await service.createCategory(input);
      } else {
        const category = categories.find(item => item.id === form.categoryId);
        if (!category || !category.active) {
          setFieldError('Selecciona una categoría existente y activa.');
          return;
        }
        if (form.price === null) {
          setFieldError('El precio es obligatorio.');
          return;
        }
        let imageUrl = uploadedImageUrl;
        if (imageFile) {
          imageUrl = await service.uploadProductImage(imageFile);
          setUploadedImageUrl(imageUrl);
          setImageFile(null);
        }
        const input = { categoryId: form.categoryId, name: form.name, description: form.description, price: form.price, imageUrl, active: form.active };
        if (editing.value) await service.updateProduct(editing.value.id, input);
        else await service.createProduct(input);
      }
      setEditing(null);
      setImageFile(null);
      setUploadedImageUrl(null);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setFieldError(adminCatalogErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function setCategoryActive(category: AdminCategory, active: boolean) {
    try {
      await service.updateCategory(category.id, { name: category.name, description: category.description, active });
      await load();
    } catch (cause) { setError(adminCatalogErrorMessage(cause)); }
  }
  async function setProductActive(product: AdminProduct, active: boolean) {
    try {
      const category = categories.find(item => item.id === product.categoryId);
      if (!category?.active && active) {
        setError('Activa primero la categoría para publicar el producto.');
        return;
      }
      await service.updateProduct(product.id, {
        categoryId: product.categoryId, name: product.name, description: product.description,
        price: product.price, imageUrl: product.imageUrl, active,
      });
      await load();
    } catch (cause) { setError(adminCatalogErrorMessage(cause)); }
  }

  const dialogFooter = <div className="flex justify-content-end gap-2">
    <Button label="Cancelar" severity="secondary" outlined onClick={() => setEditing(null)} disabled={saving} />
    <Button label="Guardar" icon="pi pi-check" onClick={() => void save()} loading={saving} />
  </div>;
  const editCategory = editing?.kind === 'category';
  return <section className="flex flex-column gap-3">
    <div className="flex align-items-center justify-content-between flex-wrap gap-2">
      <div><h2 className="mt-0 mb-1">Catálogo</h2><p className="mt-0 mb-0">Administra productos y categorías. El stock se gestiona desde Inventario.</p></div>
    </div>
    {error && <Message severity="error" text={error} />}
    <TabView>
      <TabPanel header="Productos">
        <section aria-labelledby="products-heading" className="flex flex-column gap-3">
          <div className="flex align-items-center justify-content-between flex-wrap gap-2">
            <div><h3 id="products-heading" className="mt-0 mb-1">Productos</h3><p className="mt-0 mb-0">Gestiona el catálogo y sus imágenes.</p></div>
            <Button label="Nuevo producto" icon="pi pi-plus" onClick={() => openProduct()} />
          </div>
          <DataTable value={products} dataKey="id" size="small" stripedRows responsiveLayout="scroll" loading={loading} emptyMessage="No hay productos.">
            <Column field="name" header="Nombre" />
            <Column header="Categoría" body={(row: AdminProduct) => categories.find(category => category.id === row.categoryId)?.name ?? 'No disponible'} />
            <Column header="Precio" body={(row: AdminProduct) => new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' }).format(row.price)} />
            <Column header="Estado" body={(row: AdminProduct) => <Tag value={row.active ? 'Activo' : 'Inactivo'} severity={row.active ? 'success' : 'secondary'} />} />
            <Column header="Acciones" body={(row: AdminProduct) => <span className="flex gap-2">
              <Button icon="pi pi-pencil" aria-label={`Editar ${row.name}`} text onClick={() => openProduct(row)} />
              <Button icon={row.active ? 'pi pi-ban' : 'pi pi-check'} aria-label={row.active ? `Desactivar ${row.name}` : `Activar ${row.name}`} text onClick={() => void setProductActive(row, !row.active)} />
            </span>} />
          </DataTable>
        </section>
      </TabPanel>
      <TabPanel header="Categorías">
        <section aria-labelledby="categories-heading" className="flex flex-column gap-3">
          <div className="flex align-items-center justify-content-between flex-wrap gap-2">
            <div><h3 id="categories-heading" className="mt-0 mb-1">Categorías</h3><p className="mt-0 mb-0">Organiza los productos del catálogo.</p></div>
            <Button label="Nueva categoría" icon="pi pi-tag" outlined onClick={() => openCategory()} />
          </div>
          <DataTable value={categories} dataKey="id" size="small" stripedRows responsiveLayout="scroll" loading={loading} emptyMessage="No hay categorías.">
            <Column field="name" header="Nombre" />
            <Column field="description" header="Descripción" body={(row: AdminCategory) => row.description || '—'} />
            <Column header="Estado" body={(row: AdminCategory) => <Tag value={row.active ? 'Activa' : 'Inactiva'} severity={row.active ? 'success' : 'secondary'} />} />
            <Column header="Acciones" body={(row: AdminCategory) => <span className="flex gap-2">
              <Button icon="pi pi-pencil" aria-label={`Editar ${row.name}`} text onClick={() => openCategory(row)} />
              <Button icon={row.active ? 'pi pi-ban' : 'pi pi-check'} aria-label={row.active ? `Desactivar ${row.name}` : `Activar ${row.name}`} text onClick={() => void setCategoryActive(row, !row.active)} />
            </span>} />
          </DataTable>
        </section>
      </TabPanel>
    </TabView>
    <Dialog visible={editing !== null} header={`${editing?.value ? 'Editar' : 'Nueva'} ${editCategory ? 'categoría' : 'producto'}`} modal onHide={() => !saving && setEditing(null)} footer={dialogFooter} className="w-11 md:w-8 lg:w-6" contentStyle={{ maxHeight: '75vh', overflow: 'auto' }}>
      <div className="p-fluid flex flex-column gap-3">
        {fieldError && <Message severity="error" text={fieldError} />}
        <div className="field"><label htmlFor="admin-name">Nombre *</label><InputText id="admin-name" value={form.name} maxLength={120} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></div>
        <div className="field"><label htmlFor="admin-description">Descripción</label><InputTextarea id="admin-description" value={form.description} rows={3} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></div>
        {!editCategory && <>
          <div className="field"><label htmlFor="admin-category">Categoría *</label><Dropdown inputId="admin-category" value={form.categoryId} options={categories.filter(item => item.active).map(item => ({ label: item.name, value: item.id }))} onChange={event => setForm(current => ({ ...current, categoryId: event.value }))} placeholder="Selecciona una categoría" /></div>
          <div className="field"><label htmlFor="admin-price">Precio *</label><InputNumber inputId="admin-price" value={form.price} onValueChange={event => setForm(current => ({ ...current, price: event.value ?? null }))} mode="currency" currency="USD" locale="es-SV" min={0.01} minFractionDigits={2} maxFractionDigits={2} /></div>
          <div className="field">
            <label htmlFor="admin-product-image">Imagen del producto</label>
            <input
              id="admin-product-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-describedby="admin-product-image-help"
              disabled={saving}
              onChange={event => {
                const file = event.target.files?.[0] ?? null;
                setImageFile(file);
                setFieldError('');
              }}
            />
            <small id="admin-product-image-help">JPG, PNG o WebP. Máximo 5 MB.</small>
            {imagePreview && <div className="flex align-items-center gap-2">
              <img src={imagePreview} alt={`Vista previa de ${form.name || 'producto'}`} width={88} height={88} style={{ objectFit: 'cover', borderRadius: '.5rem' }} />
              <Button type="button" label="Quitar imagen" icon="pi pi-times" text severity="secondary" disabled={saving} onClick={() => {
                setImageFile(null);
                setUploadedImageUrl(null);
                const input = document.getElementById('admin-product-image') as HTMLInputElement | null;
                if (input) input.value = '';
              }} />
            </div>}
          </div>
        </>}
        <div className="flex align-items-center gap-2"><InputSwitch inputId="admin-active" checked={form.active} onChange={event => setForm(current => ({ ...current, active: event.value }))} /><label htmlFor="admin-active">Activo</label></div>
      </div>
    </Dialog>
  </section>;
}
