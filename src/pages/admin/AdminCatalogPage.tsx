import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { FileUpload } from 'primereact/fileupload';
import { IconField } from 'primereact/iconfield';
import { InputNumber } from 'primereact/inputnumber';
import { InputIcon } from 'primereact/inputicon';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dropdown } from 'primereact/dropdown';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { TabPanel, TabView } from 'primereact/tabview';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { FIXED_KIOSK_CATEGORY_NAMES } from '../../features/catalog/categoryNames';
import { adminCatalogErrorMessage, createAdminCatalogService, type AdminCategory, type AdminProduct } from '../../services/adminCatalog';
import { httpClient, ApiError } from '../../services/http/client';
import { filterAdminProducts } from './catalogSearch';

type Editing = { kind: 'product'; value?: AdminProduct } | null;

function ProductImage({ src, name, variant = 'thumbnail' }: { src: string | null; name: string; variant?: 'thumbnail' | 'preview' }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <span className={`admin-catalog__image admin-catalog__image--${variant}`}
    role="img" aria-label={src && failedSrc !== src ? `Vista de imagen de ${name}` : `No hay imagen para ${name}`}>
    {src && failedSrc !== src
      ? <img src={src} alt="" onError={() => setFailedSrc(src)} />
      : <i className="pi pi-image" />}
  </span>;
}

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
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', categoryId: '', price: null as number | null, active: true });
  const [fieldError, setFieldError] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const imageUploadRef = useRef<FileUpload>(null);
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

  function openProduct(value?: AdminProduct) {
    imageUploadRef.current?.clear();
    setEditing({ kind: 'product', value });
    setForm({ name: value?.name ?? '', description: value?.description ?? '', categoryId: value?.categoryId ?? '', price: value?.price ?? null, active: value?.active ?? true });
    setImageFile(null);
    setUploadedImageUrl(value?.imageUrl ?? null);
    setFieldError('');
  }
  function handleImageSelect(file: File | undefined) {
    if (!file) return;
    if (
      file.size <= 0
      || file.size > 5 * 1024 * 1024
      || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ) {
      setFieldError('Selecciona una imagen JPG, PNG o WebP de hasta 5 MB.');
      imageUploadRef.current?.clear();
      return;
    }
    setImageFile(file);
    setFieldError('');
  }
  async function save() {
    if (!editing) return;
    setFieldError('');
    setSaving(true);
    try {
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
      setEditing(null);
      imageUploadRef.current?.clear();
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
  const fixedActiveCategories = FIXED_KIOSK_CATEGORY_NAMES.flatMap(name => {
    const category = categories.find(item => item.name === name && item.active);
    return category ? [category] : [];
  });
  const filteredProducts = useMemo(
    () => filterAdminProducts(products, categories, searchTerm),
    [categories, products, searchTerm],
  );
  return <section className="admin-module admin-catalog">
    <div className="flex align-items-center justify-content-between flex-wrap gap-2">
      <div><h2 className="mt-0 mb-1">Catálogo</h2><p className="mt-0 mb-0">Administra productos del catálogo fijo. Las categorías no se editan; el stock se gestiona desde Inventario.</p></div>
    </div>
    {error && <Message severity="error" text={error} />}
    <TabView>
      <TabPanel header="Productos">
        <section className="flex flex-column gap-3">
          <div className="flex align-items-center justify-content-between flex-wrap gap-2">
            <IconField iconPosition="left" className="admin-catalog__search">
              <InputIcon className="pi pi-search" aria-hidden="true" />
              <InputText value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder="Buscar por nombre, descripción o categoría"
                aria-label="Buscar productos por nombre, descripción o categoría" />
            </IconField>
            <Button label="Nuevo producto" icon="pi pi-plus" onClick={() => openProduct()} />
          </div>
          <div className="admin-table-card admin-catalog__table">
          <DataTable value={filteredProducts} dataKey="id" size="small" stripedRows responsiveLayout="scroll" loading={loading}
            paginator rows={10} rowsPerPageOptions={[10, 20, 50]}
            emptyMessage={searchTerm.trim() ? 'No se encontraron productos.' : 'No hay productos.'}>
            <Column header="Producto" style={{ minWidth: '16rem' }} body={(row: AdminProduct) =>
              <div className="admin-catalog__product">
                <ProductImage src={row.imageUrl} name={row.name} />
                <span className="admin-catalog__product-copy">
                  <strong>{row.name}</strong>
                  {row.description && <small>{row.description}</small>}
                </span>
              </div>
            } />
            <Column header="Categoría" style={{ minWidth: '9rem' }} body={(row: AdminProduct) => categories.find(category => category.id === row.categoryId)?.name ?? 'No disponible'} />
            <Column header="Precio" style={{ minWidth: '7rem' }} body={(row: AdminProduct) => new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' }).format(row.price)} />
            <Column header="Estado" style={{ minWidth: '6rem' }} body={(row: AdminProduct) => <Tag value={row.active ? 'Activo' : 'Inactivo'} severity={row.active ? 'success' : 'secondary'} />} />
            <Column header="Acciones" body={(row: AdminProduct) => <span className="flex gap-2">
              <Button icon="pi pi-pencil" aria-label={`Editar ${row.name}`} text onClick={() => openProduct(row)} />
              <Button icon={row.active ? 'pi pi-ban' : 'pi pi-check'} aria-label={row.active ? `Desactivar ${row.name}` : `Activar ${row.name}`} text onClick={() => void setProductActive(row, !row.active)} />
            </span>} />
          </DataTable>
          </div>
        </section>
      </TabPanel>
      <TabPanel header="Categorías">
        <section aria-labelledby="categories-heading" className="flex flex-column gap-3">
          <div className="flex align-items-center justify-content-between flex-wrap gap-2">
            <div><h3 id="categories-heading" className="mt-0 mb-1">Categorías</h3><p className="mt-0 mb-0">Catálogo fijo de solo lectura. Las categorías y sus iconos se definen en la aplicación.</p></div>
          </div>
          <div className="admin-table-card">
          <DataTable value={fixedActiveCategories} dataKey="id" size="small" stripedRows responsiveLayout="scroll" loading={loading} emptyMessage="No hay categorías fijas activas.">
            <Column field="name" header="Nombre" />
            <Column field="description" header="Descripción" body={(row: AdminCategory) => row.description || '—'} />
            <Column header="Estado" body={(row: AdminCategory) => <Tag value={row.active ? 'Activa' : 'Inactiva'} severity={row.active ? 'success' : 'secondary'} />} />
          </DataTable>
          </div>
        </section>
      </TabPanel>
    </TabView>
    <Dialog visible={editing !== null} header={`${editing?.value ? 'Editar' : 'Nuevo'} producto`} modal
      onHide={() => !saving && setEditing(null)} footer={dialogFooter} className="admin-catalog__dialog w-11 md:w-9 lg:w-7"
      contentStyle={{ maxHeight: '78dvh', overflow: 'auto' }}>
      <div className="admin-catalog__form">
        {fieldError && <Message severity="error" text={fieldError} />}
        <div className="admin-catalog__fields">
          <div className="admin-catalog__field">
            <label htmlFor="admin-name">Nombre *</label>
            <InputText id="admin-name" value={form.name} maxLength={120}
              onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="admin-catalog__field">
            <label htmlFor="admin-description">Descripción</label>
            <InputTextarea id="admin-description" value={form.description} rows={3}
              onChange={event => setForm(current => ({ ...current, description: event.target.value }))} />
          </div>
          <div className="admin-catalog__field">
            <label htmlFor="admin-category">Categoría *</label>
            <Dropdown inputId="admin-category" value={form.categoryId}
              options={fixedActiveCategories.map(item => ({ label: item.name, value: item.id }))}
              onChange={event => setForm(current => ({ ...current, categoryId: event.value }))}
              placeholder="Selecciona una categoría" />
          </div>
          <div className="admin-catalog__field">
            <label htmlFor="admin-price">Precio *</label>
            <InputNumber inputId="admin-price" value={form.price}
              onValueChange={event => setForm(current => ({ ...current, price: event.value ?? null }))}
              mode="currency" currency="USD" locale="es-SV" min={0.01} minFractionDigits={2} maxFractionDigits={2} />
          </div>
          <div className="admin-catalog__active">
            <InputSwitch inputId="admin-active" checked={form.active}
              onChange={event => setForm(current => ({ ...current, active: event.value }))} />
            <label htmlFor="admin-active">Producto activo</label>
          </div>
        </div>
        <section className="admin-catalog__image-field" aria-labelledby="admin-product-image-label">
          <div>
            <h3 id="admin-product-image-label">Imagen del producto</h3>
            <p>JPG, PNG o WebP · máximo 5 MB</p>
          </div>
          <div className="admin-catalog__image-picker">
            <ProductImage src={imagePreview} name={form.name || 'producto'} variant="preview" />
            <FileUpload
              ref={imageUploadRef}
              mode="basic"
              name="file"
              accept="image/jpeg,image/png,image/webp"
              maxFileSize={5 * 1024 * 1024}
              chooseLabel={imageFile || uploadedImageUrl ? 'Cambiar imagen' : 'Seleccionar imagen'}
              chooseOptions={{ icon: 'pi pi-images', className: 'p-button-outlined' }}
              className="admin-catalog__file-upload"
              disabled={saving}
              onSelect={event => handleImageSelect(event.files[0])}
              onValidationFail={file => setFieldError(file.size > 5 * 1024 * 1024
                ? 'La imagen no puede superar 5 MB.'
                : 'Selecciona una imagen JPG, PNG o WebP.')}
            />
            {imageFile && <small className="admin-catalog__file-name">{imageFile.name}</small>}
            {!imageFile && !uploadedImageUrl && <small className="admin-catalog__file-name">Aún no se ha seleccionado una imagen.</small>}
            {(imageFile || uploadedImageUrl) && <Button type="button" label="Quitar imagen" icon="pi pi-times"
              text severity="secondary" disabled={saving} onClick={() => {
                imageUploadRef.current?.clear();
                setImageFile(null);
                setUploadedImageUrl(null);
                setFieldError('');
              }} />}
          </div>
        </section>
      </div>
    </Dialog>
  </section>;
}
