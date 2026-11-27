import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { ClipboardList, Coffee, Package, LogOut, RefreshCw, AlertTriangle, ChefHat, CheckCircle, Bell, Ban, Trash2, Clock, Calendar, DollarSign, Plus, X, Save, ShoppingCart, Search, BarChart3, Pencil, Users, Gift, MessageSquareText, Boxes, UserRound, Menu as MenuIcon } from 'lucide-react';
import {
  fetchOrders, fetchOrderById, updateOrderStatus,
  createProduct, deleteProduct, updateProduct
} from '../services/api';
import type { Mesa } from '../services/api';
import type { Order, CartItem } from '../types/Order';
import type { Product } from '../types/Product';
import type { Category } from '../types/Category';
import { getProductImage } from '../utils/productImage';
import { useAuth } from '../auth/AuthContext';
import { PromotionsPanel } from '../components/PromotionsPanel';
import { UsersAdmin } from './admin/UsersAdmin';
import { AdminCatalogPage } from './admin/AdminCatalogPage';
import { TablesSessionsPage } from './admin/TablesSessionsPage';
import { calculateCartPricing, newLineId, MAX_NOTE_LENGTH } from '../utils/promotions';
import { OrdersAdmin } from '../features/orders/OrdersAdmin';
import { ReportsPage } from '../features/reports/ReportsPage';
import { CajaPage } from '../features/caja/CajaPage';
import { createCafeOrdersService, ordersErrorMessage } from '../features/orders/ordersService';
import { createOrderAvailabilityService } from '../features/orders/orderAvailabilityService';
import { createCafeTablesService } from '../services/cafeTables';
import { catalogService, type PublicMenuItem } from '../services/catalog';
import { httpClient } from '../services/http/client';
import { ApiError } from '../services/http/client';
import type { CreateOrderLine } from '../features/orders/model';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';

const InventoryPage = lazy(() => import('../features/inventory/InventoryPage').then(module => ({ default: module.InventoryPage })));

interface OrderItem {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
  product_name?: string;
  notes?: string | null;
  discount?: number;
  promo_name?: string | null;
}

interface OrderWithItems extends Order {
  items: OrderItem[];
}

const STATUS_FLOW: Record<string, { next: string | null; nextLabel: React.ReactNode; btnClass: string }> = {
  pending: { next: 'preparing', nextLabel: <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}><ChefHat size={18} /> Iniciar preparación</span>, btnClass: 'status-btn-preparing' },
  preparing: { next: 'ready', nextLabel: <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}><CheckCircle size={18} /> Marcar como listo</span>, btnClass: 'status-btn-ready' },
  ready: { next: 'delivered', nextLabel: <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}><Bell size={18} /> Marcar entregado</span>, btnClass: 'status-btn-delivered' },
  delivered: { next: null, nextLabel: null, btnClass: '' },
  cancelled: { next: null, nextLabel: null, btnClass: '' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pendiente', color: '#E0247D' },
  preparing: { label: 'Preparando', color: '#1976D2' },
  ready: { label: 'Listo', color: '#388E3C' },
  delivered: { label: 'Entregado', color: '#757575' },
  cancelled: { label: 'Cancelado', color: '#D32F2F' },
};

function getStatus(status?: string) {
  const s = (status || 'pending').toLowerCase();
  return STATUS_LABELS[s] ?? { label: status ?? 'Pendiente', color: '#E0247D' };
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-SV', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const EMPTY_FORM = { name: '', description: '', price: '', image: '', category_id: '' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function getCashSessionId(state: unknown): string | undefined {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  const sessionId = (state as Record<string, unknown>).cashSessionId;
  return typeof sessionId === 'string' && UUID_PATTERN.test(sessionId) ? sessionId : undefined;
}

function legacyProductAdminVisible(role: string, tab: string): boolean {
  void role;
  void tab;
  return false;
}
function legacyOrdersVisible(): boolean { return false; }
function readPendingPosOrder(): { tableId: string; key: string; items: CreateOrderLine[] } | null {
  const storageKey = 'coffee-connect-pending-pos-order';
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as {
      tableId?: unknown; key?: unknown; items?: unknown;
    } | null;
    if (!stored) return null;
    const valid = typeof stored.tableId === 'string' && UUID_PATTERN.test(stored.tableId)
      && typeof stored.key === 'string' && UUID_PATTERN.test(stored.key)
      && Array.isArray(stored.items) && stored.items.length >= 1 && stored.items.length <= 50
      && stored.items.every((line: unknown) => {
        if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
        const item = line as Record<string, unknown>;
        return typeof item.productId === 'string' && UUID_PATTERN.test(item.productId)
          && Number.isInteger(item.quantity) && Number(item.quantity) >= 1 && Number(item.quantity) <= 99
          && (item.notes === undefined || item.notes === null || (typeof item.notes === 'string' && item.notes.length <= 200));
      });
    if (!valid) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return stored as { tableId: string; key: string; items: CreateOrderLine[] };
  } catch {
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage puede estar bloqueado. */ }
    return null;
  }
}

export function OrdersHistory() {
  const navigate = useNavigate();
  const location = useLocation();
  const cashSessionId = getCashSessionId(location.state);
  const { session, signOut, refreshSession } = useAuth();
  const accessToken = session?.accessToken;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const ordersService = useMemo(() => createCafeOrdersService(httpClient, () => accessTokenRef.current, async () => {
    const refreshed = await refreshSession().catch(() => null);
    accessTokenRef.current = refreshed?.accessToken;
    return refreshed?.accessToken ?? null;
  }), [refreshSession]);
  const tablesService = useMemo(() => createCafeTablesService(httpClient, () => accessTokenRef.current, async () => {
    const refreshed = await refreshSession().catch(() => null);
    accessTokenRef.current = refreshed?.accessToken;
    return refreshed?.accessToken ?? null;
  }), [refreshSession]);
  const availabilityService = useMemo(() => createOrderAvailabilityService(httpClient, () => accessTokenRef.current, async () => {
    const refreshed = await refreshSession().catch(() => null);
    accessTokenRef.current = refreshed?.accessToken;
    return refreshed?.accessToken ?? null;
  }), [refreshSession]);
  const userRole = session?.profile.role ?? 'waiter';
  const [activeTab, setActiveTab] = useState<'orders' | 'products' | 'mesas' | 'caja' | 'pos' | 'reports' | 'users' | 'promos' | 'inventory' | 'profile'>(userRole === 'admin' ? 'orders' : 'pos');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuWasOpen = useRef(false);
  const [inventoryRecipeDirty, setInventoryRecipeDirty] = useState(false);
  useEffect(() => {
    if (!cashSessionId) return;
    setActiveTab('caja');
    setMobileMenuOpen(false);
  }, [cashSessionId, location.key]);

  const navigateTab = useCallback((nextTab: typeof activeTab) => {
    if (activeTab === 'inventory' && inventoryRecipeDirty
      && !window.confirm('Hay cambios sin guardar en la receta. ¿Salir del inventario y descartarlos?')) return;
    setInventoryRecipeDirty(false);
    setActiveTab(nextTab);
    setMobileMenuOpen(false);
  }, [activeTab, inventoryRecipeDirty]);
  useEffect(() => {
    if (!mobileMenuOpen) {
      if (menuWasOpen.current) {
        menuWasOpen.current = false;
        menuButtonRef.current?.focus();
      }
      return;
    }
    menuWasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusableElements = () => sidebarRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
    focusableElements()?.[0]?.focus();
    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleMenuKeyDown);
    return () => {
      document.removeEventListener('keydown', handleMenuKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);
  const profileName = session?.profile.displayName.trim() || session?.user.email || '';

  // — Pedidos —
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // — Productos —
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const productLoadSequence = useRef(0);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [savingProduct, setSavingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [productSuccess, setProductSuccess] = useState(false);

  // — Edición de Producto —
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // — Mesas —
  const [mesas, setMesas] = useState<Mesa[]>([]);

  // — POS (Punto de Venta) —
  const [posCart, setPosCart] = useState<CartItem[]>([]);
  const [posSelectedMesaId, setPosSelectedMesaId] = useState<string>('');
  const [posSearchTerm, setPosSearchTerm] = useState('');
  const [posSelectedCategory, setPosSelectedCategory] = useState<string | null>(null);
  const [posIsProcessing, setPosIsProcessing] = useState(false);
  const [posAvailabilityError, setPosAvailabilityError] = useState<string | null>(null);
  const [posTableError, setPosTableError] = useState<string | null>(null);
  const [posStockMessage, setPosStockMessage] = useState<string | null>(null);
  const [pendingPosOrder, setPendingPosOrder] = useState<{ tableId: string; key: string; items: CreateOrderLine[] } | null>(readPendingPosOrder);

  // — Reportes —

  // — Usuarios —
  const handleLogout = async () => {
    const confirmation = await Swal.fire({
      icon: 'question',
      title: '¿Cerrar sesión?',
      text: 'Tendrás que volver a iniciar sesión para acceder al panel.',
      showCancelButton: true,
      confirmButtonText: 'Cerrar sesión',
      cancelButtonText: 'Seguir aquí',
      confirmButtonColor: '#DC2626',
      cancelButtonColor: '#6B7280',
      reverseButtons: true,
    });
    if (!confirmation.isConfirmed) return;

    try {
      await signOut();
    } finally {
      navigate('/admin/login', { replace: true });
    }
  };

  const loadOrders = useCallback(async () => {
    try {
      const data = await fetchOrders();
      setOrders(data);
      setError(null);
    } catch {
      setError('No se pudo cargar el historial de pedidos.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    const sequence = ++productLoadSequence.current;
    setLoadingProducts(true);
    setProductError(null);
    setPosAvailabilityError(null);
    try {
      const [menu, cats] = await Promise.all([catalogService.listPublicMenu(), catalogService.listPublicCategories()]);
      if (sequence !== productLoadSequence.current) return;
      const nextProducts = menu.map((item: PublicMenuItem) => ({
        id: item.id, category_id: item.categoryId, name: item.name,
        description: item.description ?? undefined, price: item.price, image: item.imageUrl ?? undefined,
      })) as unknown as Product[];
      setCategories(cats.map(category => ({
        id: category.id, name: category.name, description: category.description ?? undefined,
      })) as unknown as Category[]);
      if (nextProducts.length > 0) {
        try {
          const productIds = nextProducts.map(product => String(product.id));
          const availability = (await Promise.all(
            Array.from({ length: Math.ceil(productIds.length / 100) }, (_, index) =>
              availabilityService.getAvailability(productIds.slice(index * 100, (index + 1) * 100))),
          )).flat();
          if (sequence !== productLoadSequence.current) return;
          const availabilityByProduct = new Map(availability.map(item => [item.productId, item]));
          if (nextProducts.some(product => !availabilityByProduct.has(String(product.id)))) {
            throw new ApiError(200, 'La disponibilidad de productos está incompleta.', 'INVALID_RESPONSE');
          }
          setProducts(nextProducts.map(product => ({
            ...product,
            stock: availabilityByProduct.get(String(product.id))!.orderable
              ? availabilityByProduct.get(String(product.id))!.availableQuantity
              : 0,
            has_recipe: availabilityByProduct.get(String(product.id))!.usesRecipe,
          })));
        } catch (cause) {
          if (sequence !== productLoadSequence.current) return;
          if (cause instanceof ApiError && cause.status === 401) {
            await signOut();
            navigate('/admin/login', { replace: true });
          }
          setProducts(nextProducts);
          setPosAvailabilityError(ordersErrorMessage(cause));
        }
      } else {
        setProducts([]);
      }
      if (pendingPosOrder) {
        const productById = new Map(nextProducts.map(product => [String(product.id), product]));
        const recovered: CartItem[] = pendingPosOrder.items.flatMap(line => {
          const product = productById.get(line.productId);
          return product ? [{
            lineId: newLineId(), product, quantity: line.quantity,
            subtotal: product.price * line.quantity, ...(line.notes ? { notes: line.notes } : {}),
          }] : [];
        });
        if (recovered.length === pendingPosOrder.items.length) {
          setPosCart(recovered);
          setPosSelectedMesaId(pendingPosOrder.tableId);
        }
      }
    } catch (cause) {
      if (sequence !== productLoadSequence.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setProductError('No se pudieron cargar los productos.');
    } finally {
      if (sequence === productLoadSequence.current) setLoadingProducts(false);
    }
  }, [availabilityService, navigate, pendingPosOrder, signOut]);

  const loadMesas = useCallback(async () => {
    setPosTableError(null);
    try {
      const [tables, sessions] = await Promise.all([tablesService.listTables(), tablesService.listOpenSessions()]);
      const openTableIds = new Set(sessions.map(item => item.tableId));
      const takeawayTables = tables.filter(table => table.name.trim().toLocaleLowerCase('es-SV') === 'para llevar');
      if (takeawayTables.length !== 1) {
        setPosTableError(takeawayTables.length === 0
          ? 'No se encontró la mesa configurada “Para llevar”. Verifica que esté activa en el sistema.'
          : 'Hay más de una mesa “Para llevar”. Se requiere una sola mesa virtual activa.');
      } else if (!takeawayTables[0].active || takeawayTables[0].status === 'unavailable') {
        setPosTableError('La mesa “Para llevar” está inactiva o no disponible. Solicita al administrador que la habilite.');
      }
      const selectable = tables.filter(table => {
        if (!table.active || table.status === 'unavailable') return false;
        const isTakeaway = table.name.trim().toLocaleLowerCase('es-SV') === 'para llevar';
        if (isTakeaway && takeawayTables.length !== 1) return false;
        return isTakeaway || openTableIds.has(table.id);
      });
      setMesas(selectable.map(table => ({
        id: table.id,
        name: table.name,
        status: openTableIds.has(table.id) ? 'OCUPADA' as const : 'DISPONIBLE' as const,
      })));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setMesas([]);
      setPosTableError('No se pudieron cargar las mesas y sesiones. Actualiza la vista antes de enviar un pedido.');
    }
  }, [navigate, signOut, tablesService]);

  useEffect(() => {
    if (activeTab === 'pos') { loadMesas(); loadProducts(); }
  }, [activeTab, loadProducts, loadMesas, userRole]);

  useEffect(() => {
    if (activeTab !== 'pos') return;
    const refreshAvailability = () => { void loadProducts(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshAvailability();
    };
    window.addEventListener('focus', refreshAvailability);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshAvailability);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [activeTab, loadProducts]);

  async function handleSelectOrder(order: Order) {
    if (!order.id) return;
    setLoadingDetail(true);
    setStatusError(null);
    try {
      const detail = await fetchOrderById(order.id);
      const normalized = ((detail as unknown as { data?: Order })?.data ?? detail) as Order & { order_items?: OrderItem[] };
      const items = ((normalized.items ?? normalized.order_items ?? []) as unknown) as OrderItem[];
      setSelectedOrder({ ...normalized, items } as OrderWithItems);
    } catch {
      setSelectedOrder({ ...order, items: [] });
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleUpdateStatus(newStatus: string) {
    if (!selectedOrder?.id) return;
    setUpdatingStatus(true);
    setStatusError(null);
    try {
      await updateOrderStatus(selectedOrder.id, newStatus);
      setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, status: newStatus } : o));
      setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : prev);
    } catch {
      setStatusError('No se pudo actualizar el estado. Intenta de nuevo.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleCancelOrder() {
    if (!selectedOrder?.id) return;
    const result = await Swal.fire({
      title: '¿Cancelar pedido?',
      text: "El pedido será marcado como cancelado.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#DC2626',
      cancelButtonColor: '#6B7280',
      confirmButtonText: 'Sí, cancelar',
      cancelButtonText: 'No, mantener'
    });
    if (!result.isConfirmed) return;
    await handleUpdateStatus('cancelled');
  }

  async function handleCreateProduct() {
    setProductError(null);
    if (!form.name.trim()) return setProductError('El nombre es requerido.');
    if (!form.price || Number(form.price) <= 0) return setProductError('El precio debe ser mayor a 0.');
    if (!form.category_id) return setProductError('Selecciona una categoría.');

    setSavingProduct(true);
    try {
      await createProduct({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        price: Number(form.price),
        image: form.image.trim() || undefined,
        category_id: Number(form.category_id),
      });
      setProductSuccess(true);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadProducts();
      setTimeout(() => setProductSuccess(false), 3000);
    } catch {
      setProductError('No se pudo crear el producto. Intenta de nuevo.');
    } finally {
      setSavingProduct(false);
    }
  }

  async function handleDeleteProduct(id: number) {
    const result = await Swal.fire({
      title: '¿Eliminar producto?',
      text: "Esta acción no se puede deshacer.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EF4444',
      cancelButtonColor: '#9CA3AF',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
      await deleteProduct(id);
      setProducts(prev => prev.filter(p => p.id !== id));
      Swal.fire({ title: 'Eliminado', text: 'El producto ha sido eliminado.', icon: 'success', confirmButtonColor: '#10B981' });
    } catch {
      Swal.fire({ title: 'Error', text: 'No se pudo eliminar el producto.', icon: 'error', confirmButtonColor: '#EF4444' });
    }
  }

  function handleOpenEditModal(product: Product) {
    setEditProduct(product);
    setEditForm({
      name: product.name || '',
      description: product.description || '',
      price: String(product.price || ''),
      image: product.image || '',
      category_id: String(product.category_id || ''),
    });
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editProduct) return;
    setEditError(null);
    if (!editForm.name.trim()) return setEditError('El nombre es requerido.');
    if (!editForm.price || Number(editForm.price) <= 0) return setEditError('El precio debe ser mayor a 0.');
    if (!editForm.category_id) return setEditError('Selecciona una categoría.');

    setSavingEdit(true);
    try {
      await updateProduct(editProduct.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || undefined,
        price: Number(editForm.price),
        image: editForm.image.trim() || undefined,
        category_id: Number(editForm.category_id),
      });
      setEditProduct(null);
      await loadProducts();
      Swal.fire({ icon: 'success', title: 'Actualizado', text: 'El producto ha sido actualizado.', confirmButtonColor: '#10B981', timer: 2000, showConfirmButton: false });
    } catch {
      setEditError('No se pudo actualizar el producto. Intenta de nuevo.');
    } finally {
      setSavingEdit(false);
    }
  }

  // ── POS Functions ──
  function posAddToCart(product: Product) {
    if (posAvailabilityError || typeof product.stock !== 'number' || !Number.isInteger(product.stock) || product.stock < 1) {
      setPosStockMessage(posAvailabilityError ?? 'Este producto no tiene existencias disponibles para agregar.');
      return;
    }
    const inCart = posCart
      .filter(item => String(item.product.id) === String(product.id))
      .reduce((total, item) => total + item.quantity, 0);
    const mergeable = posCart.find(item => String(item.product.id) === String(product.id) && !item.notes);
    if (mergeable && mergeable.quantity >= 99) {
      setPosStockMessage('La cantidad máxima por línea es 99.');
      return;
    }
    if (inCart >= product.stock) {
      setPosStockMessage(`Solo hay ${product.stock} unidad(es) disponibles de ${product.name}.`);
      return;
    }
    setPosStockMessage(null);
    setPosCart(prev => {
      // Se suma a la línea del mismo producto SIN comentario; si ya tiene comentario, se crea otra línea
      const existing = prev.find(item => String(item.product.id) === String(product.id) && !item.notes);
      if (existing) {
        return prev.map(item =>
          item.lineId === existing.lineId
            ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * product.price }
            : item
        );
      }
      return [...prev, { lineId: newLineId(), product, quantity: 1, subtotal: product.price }];
    });
  }

  function posIncreaseQty(lineId: string) {
    const line = posCart.find(item => item.lineId === lineId);
    if (!line) return;
    const product = products.find(item => String(item.id) === String(line.product.id));
    if (!product || typeof product.stock !== 'number' || !Number.isInteger(product.stock)) {
      setPosStockMessage(posAvailabilityError ?? 'No se pudo validar la disponibilidad. Actualiza los productos antes de cambiar la cantidad.');
      return;
    }
    const inCart = posCart
      .filter(item => String(item.product.id) === String(line.product.id))
      .reduce((total, item) => total + item.quantity, 0);
    if (inCart >= product.stock || line.quantity >= 99) {
      setPosStockMessage(inCart >= product.stock
        ? `Solo hay ${product.stock} unidad(es) disponibles de ${product.name}.`
        : 'La cantidad máxima por línea es 99.');
      return;
    }
    setPosStockMessage(null);
    setPosCart(prev => prev.map(item =>
      item.lineId === lineId
        ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.product.price }
        : item
    ));
  }

  function posDecreaseQty(lineId: string) {
    setPosCart(prev =>
      prev.map(item =>
        item.lineId === lineId && item.quantity > 1
          ? { ...item, quantity: item.quantity - 1, subtotal: (item.quantity - 1) * item.product.price }
          : item
      )
    );
    setPosStockMessage(null);
  }

  function posRemoveFromCart(lineId: string) {
    setPosCart(prev => prev.filter(item => item.lineId !== lineId));
    setPosStockMessage(null);
  }

  // Comentario del cliente para un producto (ej: "con 2 cucharadas de azúcar")
  function posUpdateNotes(lineId: string, notes: string) {
    setPosCart(prev => prev.map(item => (item.lineId === lineId ? { ...item, notes } : item)));
  }

  async function refreshAndValidatePosStock(lines: CreateOrderLine[]) {
    const productIds = [...new Set(lines.map(item => item.productId))];
    const availability = await availabilityService.getAvailability(productIds);
    const byId = new Map(availability.map(item => [item.productId, item]));
    setProducts(current => current.map(product => {
      const currentAvailability = byId.get(String(product.id));
      return currentAvailability ? {
        ...product,
        stock: currentAvailability.orderable ? currentAvailability.availableQuantity : 0,
        has_recipe: currentAvailability.usesRecipe,
      } : product;
    }));
    const quantities = new Map<string, number>();
    for (const line of lines) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
    for (const [productId, quantity] of quantities) {
      const currentAvailability = byId.get(productId);
      const product = products.find(item => String(item.id) === productId);
      if (!currentAvailability?.orderable) {
        throw new ApiError(409, 'Un producto ya no está disponible. Actualiza el menú y edita el carrito.', 'PRODUCT_UNAVAILABLE');
      }
      if (quantity > currentAvailability.availableQuantity) {
        const name = product?.name ?? 'un producto';
        throw new ApiError(409, `No hay existencias suficientes de ${name}.`, currentAvailability.usesRecipe
          ? 'INSUFFICIENT_INGREDIENT_STOCK'
          : 'INSUFFICIENT_PRODUCT_STOCK');
      }
    }
    setPosAvailabilityError(null);
    setPosStockMessage(null);
  }

  async function ensureTakeawaySession(tableId: string) {
    const selected = mesas.find(table => table.id === tableId);
    if (selected?.name.trim().toLocaleLowerCase('es-SV') !== 'para llevar') return;
    const sessions = await tablesService.listOpenSessions();
    if (sessions.some(item => item.tableId === tableId)) return;
    try {
      await tablesService.openSession(tableId, crypto.randomUUID());
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'TABLE_ALREADY_OPEN') throw error;
      const latestSessions = await tablesService.listOpenSessions();
      if (!latestSessions.some(item => item.tableId === tableId)) throw error;
    }
    await loadMesas();
  }

  async function posConfirmOrder(retryAmbiguous = false) {
    if (posIsProcessing) return;
    if (pendingPosOrder && !retryAmbiguous) {
      Swal.fire({ icon: 'warning', title: 'Envío pendiente', text: 'Reintenta únicamente la intención guardada; no se puede modificar hasta conocer el resultado.' });
      return;
    }
    if (retryAmbiguous && !pendingPosOrder) return;
    if (!pendingPosOrder && (posCart.length === 0 || !posSelectedMesaId)) return;
    const items: CreateOrderLine[] = pendingPosOrder?.items ?? posCart.map(item => ({
      productId: String(item.product.id),
      quantity: item.quantity,
      notes: item.notes?.trim() || null,
    }));
    if (posAvailabilityError && !pendingPosOrder) {
      setPosStockMessage('No se puede enviar el pedido hasta validar existencias. Actualiza los productos e inténtalo de nuevo.');
      return;
    }
    const intent = pendingPosOrder ?? { tableId: posSelectedMesaId!, items, key: crypto.randomUUID() };
    setPosIsProcessing(true);
    setPosStockMessage(null);
    const retryingExistingIntent = pendingPosOrder !== null;
    let orderRequestStarted = false;
    try {
      if (!retryingExistingIntent) {
        try {
          await refreshAndValidatePosStock(items);
        } catch (cause) {
          setPosAvailabilityError(ordersErrorMessage(cause));
          setPosStockMessage(ordersErrorMessage(cause));
          throw cause;
        }
        await ensureTakeawaySession(intent.tableId);
      }
      if (!retryingExistingIntent) {
        setPendingPosOrder(intent);
        try { sessionStorage.setItem('coffee-connect-pending-pos-order', JSON.stringify(intent)); } catch { /* En memoria durante esta vista. */ }
      }
      orderRequestStarted = true;
      await ordersService.createOrder(intent.tableId, intent.items, intent.key);
      try { sessionStorage.removeItem('coffee-connect-pending-pos-order'); } catch { /* La RPC confirmó la creación. */ }
      setPendingPosOrder(null);
      setPosCart([]);
      Swal.fire({ icon: 'success', title: 'Pedido recibido', text: 'Quedó pendiente de confirmación por el personal. La creación no reserva inventario ni inicia preparación.', confirmButtonColor: '#10B981' });
      await loadMesas();
    } catch (e) {
      const ambiguous = orderRequestStarted && e instanceof ApiError && (e.status === 0 || e.status >= 500);
      const stockUnavailable = e instanceof ApiError && [
        'INSUFFICIENT_PRODUCT_STOCK', 'INSUFFICIENT_INGREDIENT_STOCK', 'PRODUCT_UNAVAILABLE',
        'PRODUCT_RECIPE_HAS_INACTIVE_INGREDIENT',
      ].includes(e.code ?? '');
      const definitiveCreateRejection = e instanceof ApiError && [
        'INSUFFICIENT_PRODUCT_STOCK', 'INSUFFICIENT_INGREDIENT_STOCK', 'PRODUCT_UNAVAILABLE',
        'PRODUCT_RECIPE_HAS_INACTIVE_INGREDIENT', 'NO_OPEN_TABLE_SESSION', 'TABLE_NOT_FOUND',
        'TABLE_UNAVAILABLE', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_ORDER', 'INVALID_QUANTITY',
        '22P02', '22023',
      ].includes(e.code ?? '');
      if (e instanceof ApiError && e.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      const mayDiscardIntent = !retryingExistingIntent
        ? !orderRequestStarted || e instanceof ApiError
          && (e.status === 401 || (e.status >= 400 && e.status < 500))
        : orderRequestStarted && definitiveCreateRejection;
      if (!ambiguous && mayDiscardIntent) {
        try { sessionStorage.removeItem('coffee-connect-pending-pos-order'); } catch { /* El envío ya no se puede reintentar. */ }
        setPendingPosOrder(null);
      }
      if (stockUnavailable) {
        setPosStockMessage(ordersErrorMessage(e));
        void loadProducts();
      }
      Swal.fire({ icon: ambiguous ? 'warning' : 'error', title: ambiguous ? 'Resultado sin confirmar' : 'No se pudo crear el pedido',
        text: ambiguous ? 'Conservamos la misma clave. Usa “Reintentar envío pendiente” sin modificar el carrito.' : ordersErrorMessage(e) });
    } finally {
      setPosIsProcessing(false);
    }
  }

  const posFilteredProducts = products.filter(p => {
    const catMatch = posSelectedCategory === null || String(p.category_id) === String(posSelectedCategory);
    const searchMatch = posSearchTerm === '' || p.name.toLowerCase().includes(posSearchTerm.toLowerCase());
    return catMatch && searchMatch;
  });

  const posPricing = calculateCartPricing(posCart, []);
  const posTotal = posPricing.total;
  const posItemCount = posCart.reduce((sum, item) => sum + item.quantity, 0);
  const posSelectedMesa = mesas.find(m => m.id === posSelectedMesaId);

  const filtered = filterStatus === 'all'
    ? orders
    : orders.filter(o => (o.status || 'pending').toLowerCase() === filterStatus);

  const totalPending = orders.filter(o => (o.status || 'pending') === 'pending').length;
  const totalToday = orders.filter(o => {
    if (!o.created_at) return false;
    return new Date(o.created_at).toDateString() === new Date().toDateString();
  }).length;
  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const currentStatusKey = (selectedOrder?.status || 'pending').toLowerCase();
  const flow = STATUS_FLOW[currentStatusKey] ?? STATUS_FLOW['pending'];
  const activeSection = {
    orders: { label: 'Pedidos', Icon: ClipboardList },
    mesas: { label: 'Mesas y Sesiones', Icon: Coffee },
    caja: { label: 'Caja', Icon: DollarSign },
    products: { label: 'Productos', Icon: Package },
    promos: { label: 'Promociones', Icon: Gift },
    inventory: { label: 'Inventario', Icon: Boxes },
    pos: { label: 'Nuevo Pedido', Icon: ShoppingCart },
    reports: { label: 'Reportes', Icon: BarChart3 },
    users: { label: 'Usuarios', Icon: Users },
    profile: { label: 'Mi perfil', Icon: UserRound },
  }[activeTab];

  return (
    <div className="admin-layout">

      {/* SIDEBAR */}
      <aside
        ref={sidebarRef}
        id="admin-navigation"
        className={`admin-sidebar${mobileMenuOpen ? ' admin-sidebar--open' : ''}`}
      >
        <div className="sidebar-header admin-sidebar__brand">
          <img src="/turron-logo.jpg" alt="Logotipo de Turrón Pastelería" />
          <div className="admin-sidebar__brand-copy">
            <strong>TURRÓN</strong>
            <span>Pastelería</span>
          </div>
          <button type="button" className="admin-sidebar__close" aria-label="Cerrar menú"
            onClick={() => setMobileMenuOpen(false)}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Navegación administrativa">
          {userRole === 'admin' && (
            <button
              onClick={() => navigateTab('orders')}
              aria-current={activeTab === 'orders' ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'orders' ? '#FDF2F8' : 'transparent', color: activeTab === 'orders' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'orders' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'orders') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'orders') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <ClipboardList size={20} /> Pedidos
            </button>
          )}
          <button
            onClick={() => navigateTab('mesas')}
            aria-current={activeTab === 'mesas' ? 'page' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'mesas' ? '#FDF2F8' : 'transparent', color: activeTab === 'mesas' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'mesas' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
            onMouseEnter={(e) => { if (activeTab !== 'mesas') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
            onMouseLeave={(e) => { if (activeTab !== 'mesas') e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <Coffee size={20} /> Mesas y Sesiones
          </button>
          {(userRole === 'admin' || userRole === 'cashier') && (
            <button
              onClick={() => navigateTab('caja')}
              aria-current={activeTab === 'caja' ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'caja' ? '#FDF2F8' : 'transparent', color: activeTab === 'caja' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'caja' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'caja') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'caja') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <DollarSign size={20} /> Caja
            </button>
          )}
          {userRole === 'admin' && (
            <button
              onClick={() => navigateTab('products')}
              aria-current={activeTab === 'products' ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'products' ? '#FDF2F8' : 'transparent', color: activeTab === 'products' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'products' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'products') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'products') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Package size={20} /> Productos
            </button>
          )}
          {userRole === 'admin' && (
            <button
              onClick={() => navigateTab('promos')}
              aria-current={activeTab === 'promos' ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'promos' ? '#FDF2F8' : 'transparent', color: activeTab === 'promos' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'promos' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'promos') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'promos') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Gift size={20} /> Promociones
            </button>
          )}
          <button
            onClick={() => navigateTab('inventory')}
            aria-current={activeTab === 'inventory' ? 'page' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'inventory' ? '#FDF2F8' : 'transparent', color: activeTab === 'inventory' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'inventory' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
            onMouseEnter={(e) => { if (activeTab !== 'inventory') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
            onMouseLeave={(e) => { if (activeTab !== 'inventory') e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <Boxes size={20} /> Inventario
          </button>
          <button
            onClick={() => navigateTab('pos')}
            aria-current={activeTab === 'pos' ? 'page' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'pos' ? '#FDF2F8' : 'transparent', color: activeTab === 'pos' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'pos' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
            onMouseEnter={(e) => { if (activeTab !== 'pos') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
            onMouseLeave={(e) => { if (activeTab !== 'pos') e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <ShoppingCart size={20} /> Nuevo Pedido
          </button>
          {(userRole === 'admin' || userRole === 'cashier') && (
            <button
              onClick={() => navigateTab('reports')}
              aria-current={activeTab === 'reports' ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'reports' ? '#FDF2F8' : 'transparent', color: activeTab === 'reports' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'reports' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'reports') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'reports') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <BarChart3 size={20} /> Reportes
            </button>
          )}
          {userRole === 'admin' && (
            <button
              onClick={() => navigateTab('users')}
              aria-current={activeTab === 'users' ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'users' ? '#FDF2F8' : 'transparent', color: activeTab === 'users' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'users' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'users') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'users') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Users size={20} /> Usuarios
            </button>
          )}
          <button
            onClick={() => navigateTab('profile')}
            aria-current={activeTab === 'profile' ? 'page' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'profile' ? '#FDF2F8' : 'transparent', color: activeTab === 'profile' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'profile' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
          >
            <UserRound size={20} /> Mi perfil
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: 'transparent', color: '#DC2626', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s ease', width: '100%', textAlign: 'left', fontSize: '1rem' }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#FEE2E2'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <LogOut size={20} /> Cerrar Sesión
          </button>
        </div>
      </aside>
      {mobileMenuOpen && <button type="button" className="admin-sidebar-overlay" aria-hidden="true" tabIndex={-1}
        onClick={() => setMobileMenuOpen(false)} />}

      {/* MAIN CONTENT */}
      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar__title">
            <button type="button" ref={menuButtonRef} className="admin-menu-toggle"
              aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={mobileMenuOpen} aria-controls="admin-navigation"
              onClick={() => setMobileMenuOpen(open => !open)}>
              {mobileMenuOpen ? <X size={22} aria-hidden="true" /> : <MenuIcon size={22} aria-hidden="true" />}
            </button>
            <h1>
              <activeSection.Icon className="admin-topbar__icon" size={18} aria-hidden="true" />
              <span>{activeSection.label}</span>
            </h1>
          </div>
          <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <button
              type="button"
              className="admin-topbar__profile"
              onClick={() => navigateTab('profile')}
              style={{ border: 0, background: 'transparent', textAlign: 'right', cursor: 'pointer', color: '#374151' }}
              aria-label="Abrir mi perfil"
            >
              <strong style={{ display: 'block' }}>{profileName}</strong>
              <span style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'capitalize' }}>{userRole}</span>
            </button>
            {legacyOrdersVisible() ? (
              <>
                <label className="auto-refresh-toggle" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#4B5563', fontSize: '0.95rem', cursor: 'pointer', fontWeight: '500' }}>
                  <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ accentColor: '#E0247D', width: '16px', height: '16px' }} />
                  Auto-actualizar
                </label>
                <button
                  className="refresh-btn"
                  onClick={loadOrders}
                  style={{ padding: '0.6rem 1.25rem', background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#E5E7EB'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#F3F4F6'}
                >
                  <RefreshCw size={16} /> Actualizar
                </button>
              </>
            ) : null}
          </div>
        </header>

        <div className="admin-content">

          {activeTab === 'profile' && session && (
            <section aria-label="Perfil de usuario" style={{ maxWidth: '640px', background: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '2rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <dl style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '1rem', margin: 0 }}>
                <dt style={{ color: '#6B7280' }}>Nombre</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{session.profile.displayName.trim() || session.user.email}</dd>
                <dt style={{ color: '#6B7280' }}>Correo electrónico</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{session.user.email}</dd>
                <dt style={{ color: '#6B7280' }}>Rol</dt>
                <dd style={{ margin: 0, fontWeight: 600, textTransform: 'capitalize' }}>{session.profile.role}</dd>
              </dl>
            </section>
          )}

          {activeTab === 'orders' && !legacyOrdersVisible() && <OrdersAdmin />}
          {activeTab === 'orders' && legacyOrdersVisible() && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>

              <div className="orders-filters">
                {[
                  { key: 'all', label: 'Todos' },
                  { key: 'pending', label: 'Pendientes' },
                  { key: 'preparing', label: 'Preparando' },
                  { key: 'ready', label: 'Listos' },
                  { key: 'delivered', label: 'Entregados' },
                ].map(f => (
                  <button key={f.key} className={`filter-btn ${filterStatus === f.key ? 'active' : ''}`} onClick={() => setFilterStatus(f.key)}>
                    {f.label}
                    {f.key !== 'all' && (
                      <span className="filter-count">{orders.filter(o => (o.status || 'pending').toLowerCase() === f.key).length}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="orders-content">
                <div className="orders-list-panel">
                  {loading ? (
                    <div className="orders-loading"><div className="orders-spinner"></div><p>Cargando pedidos...</p></div>
                  ) : error ? (
                    <div className="orders-error-state">
                      <AlertTriangle size={24} className="error-emoji" style={{ color: '#D32F2F', marginBottom: '0.5rem' }} /><p>{error}</p>
                      <button className="retry-btn" onClick={loadOrders}>Reintentar</button>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="orders-empty">
                      <ClipboardList size={48} className="empty-emoji" style={{ color: '#9CA3AF', marginBottom: '1rem' }} />
                      <p>No hay pedidos{filterStatus !== 'all' ? ' con este estado' : ''}</p>
                    </div>
                  ) : (
                    <div className="orders-list">
                      {filtered.map(order => {
                        const st = getStatus(order.status);
                        return (
                          <div key={order.id} className={`order-card ${selectedOrder?.id === order.id ? 'selected' : ''}`} onClick={() => handleSelectOrder(order)}>
                            <div className="order-card-header">
                              <span className="order-id">#{order.id}</span>
                              <span className="order-status-badge" style={{ background: st.color }}>{st.label}</span>
                            </div>
                            <div className="order-card-body">
                              <div className="order-customer" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Coffee size={16} className="order-icon" />
                                <strong>Mesa: {order.mesa_name || (order.mesa_id ? order.mesa_id.substring(0, 8) : 'No asignada')}</strong>
                              </div>
                              {Number(order.notes_count) > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: '0.35rem 0', color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '0.15rem 0.5rem', fontSize: '0.78rem', fontWeight: '600', width: 'fit-content' }}>
                                  <MessageSquareText size={13} /> {order.notes_count} {Number(order.notes_count) === 1 ? 'producto con comentario' : 'productos con comentario'}
                                </div>
                              )}
                              <div className="order-meta">
                                <span className="order-date">{formatDate(order.created_at)}</span>
                                <span className="order-total">${Number(order.total).toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className={`order-detail-panel ${selectedOrder ? 'visible' : ''}`}>
                  {!selectedOrder ? (
                    <div className="detail-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9CA3AF' }}>
                      <ClipboardList size={48} className="detail-empty-icon" style={{ marginBottom: '1rem' }} />
                      <p>Selecciona un pedido para ver sus detalles</p>
                    </div>
                  ) : loadingDetail ? (
                    <div className="orders-loading"><div className="orders-spinner"></div><p>Cargando detalle...</p></div>
                  ) : (
                    <div className="order-detail">
                      <div className="detail-header" style={{ alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <h2 className="detail-title" style={{ margin: 0 }}>Pedido #{selectedOrder.id}</h2>
                            <span style={{
                              fontSize: '1.15rem',
                              fontWeight: '800',
                              color: '#E0247D',
                              background: '#FDF2F8',
                              padding: '2px 6px',
                              borderRadius: '6px',
                              border: '1px solid rgba(224, 36, 125, 0.2)'
                            }}>
                              ${Number(selectedOrder.total).toFixed(2)}
                            </span>
                          </div>
                          <p className="detail-subtitle" style={{ margin: '4px 0 0 0' }}>Mesa: {selectedOrder.mesa_name || selectedOrder.mesa_id}</p>
                        </div>
                        <button className="close-detail-btn" onClick={() => setSelectedOrder(null)}><X size={16} /></button>
                      </div>
                      <div className="detail-info">
                        <div className="detail-info-row">
                          <span className="detail-info-label">Estado</span>
                          <span className="order-status-badge" style={{ background: getStatus(selectedOrder.status).color }}>
                            {getStatus(selectedOrder.status).label}
                          </span>
                        </div>
                        <div className="detail-info-row">
                          <span className="detail-info-label">Fecha</span>
                          <span>{formatDate(selectedOrder.created_at)}</span>
                        </div>
                      </div>
                      <div className="detail-actions">
                        {statusError && <p className="detail-status-error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#D32F2F' }}><AlertTriangle size={18} /> {statusError}</p>}
                        {flow.next && (
                          <button className={`status-btn ${flow.btnClass}`} onClick={() => handleUpdateStatus(flow.next!)} disabled={updatingStatus}>
                            {updatingStatus ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}><RefreshCw size={18} className="spin-icon" /> Actualizando...</span> : flow.nextLabel}
                          </button>
                        )}
                        {currentStatusKey !== 'delivered' && currentStatusKey !== 'cancelled' && (
                          <button className="status-btn status-btn-cancel" onClick={handleCancelOrder} disabled={updatingStatus}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}><Ban size={18} /> Cancelar pedido</span>
                          </button>
                        )}
                        {(currentStatusKey === 'delivered' || currentStatusKey === 'cancelled') && (
                          <p className="detail-status-final" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', fontWeight: 'bold', color: currentStatusKey === 'delivered' ? '#388E3C' : '#D32F2F' }}>
                            {currentStatusKey === 'delivered' ? <><CheckCircle size={18} /> Pedido completado</> : <><Ban size={18} /> Pedido cancelado</>}
                          </p>
                        )}
                      </div>
                      <div className="detail-items">
                        <h3 className="detail-items-title">Productos</h3>
                        {selectedOrder.items?.length > 0 ? (
                          <div className="detail-items-list">
                            {selectedOrder.items.map((item, idx) => (
                              <div key={idx}>
                                <div className="detail-item">
                                  <div className="detail-item-left">
                                    <span className="detail-item-qty">×{item.quantity}</span>
                                    <span className="detail-item-name">{item.product_name || `Producto #${item.product_id}`}</span>
                                  </div>
                                  <span className="detail-item-subtotal">${Number(item.subtotal).toFixed(2)}</span>
                                </div>
                                {Number(item.discount) > 0 && (
                                  <div style={{ margin: '0.2rem 0 0.4rem 2.2rem', fontSize: '0.8rem', color: '#059669', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                    <Gift size={13} /> {item.promo_name} (-${Number(item.discount).toFixed(2)})
                                  </div>
                                )}
                                {item.notes && (
                                  <div className="detail-item-notes">
                                    <MessageSquareText size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                                    <span>{item.notes}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                            {Number(selectedOrder.discount_total) > 0 && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed #E5E7EB', color: '#059669', fontWeight: '600', fontSize: '0.9rem' }}>
                                <span>Ahorro por promociones</span>
                                <span>-${Number(selectedOrder.discount_total).toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        ) : <p className="detail-no-items">Sin detalle de productos disponible</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* RESUMEN COMPACTO (MOVIDO ABAJO) */}
              <div className="orders-summary-footer" style={{ display: 'flex', gap: '1.5rem', padding: '1rem 1.5rem', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #E5E7EB', alignItems: 'center', justifyContent: 'flex-start', marginTop: 'auto', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingRight: '1.5rem', borderRight: '1px solid #E5E7EB' }}><Clock size={20} color="#E0247D" /> <div><strong style={{ fontSize: '1.25rem', color: '#111827', lineHeight: 1 }}>{totalPending}</strong> <span style={{ color: '#6B7280', fontSize: '0.85rem', display: 'block' }}>Pendientes</span></div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingRight: '1.5rem', borderRight: '1px solid #E5E7EB' }}><Calendar size={20} color="#1976D2" /> <div><strong style={{ fontSize: '1.25rem', color: '#111827', lineHeight: 1 }}>{totalToday}</strong> <span style={{ color: '#6B7280', fontSize: '0.85rem', display: 'block' }}>Pedidos Hoy</span></div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingRight: '1.5rem', borderRight: '1px solid #E5E7EB' }}><ClipboardList size={20} color="#6B7280" /> <div><strong style={{ fontSize: '1.25rem', color: '#111827', lineHeight: 1 }}>{orders.length}</strong> <span style={{ color: '#6B7280', fontSize: '0.85rem', display: 'block' }}>Total Histórico</span></div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginLeft: 'auto' }}><DollarSign size={24} color="#10B981" /> <div><strong style={{ fontSize: '1.5rem', color: '#10B981', lineHeight: 1 }}>${totalRevenue.toFixed(2)}</strong> <span style={{ color: '#6B7280', fontSize: '0.85rem', display: 'block' }}>Ingresos Totales</span></div></div>
              </div>

            </div>
          )}

          {/* ══ TAB MESAS Y PAGOS ══ */}
          {activeTab === 'mesas' && <TablesSessionsPage />}

          {/* ══ TAB PRODUCTOS ══ */}
          {activeTab === 'products' && userRole === 'admin' && <AdminCatalogPage />}
          {legacyProductAdminVisible(userRole, activeTab) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
              <div className="products-admin-header" style={{ marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.25rem', color: '#374151' }}>Administrar Catálogo</h2>
                <button
                  className="add-product-btn"
                  onClick={() => { setShowForm(true); setProductError(null); }}
                  style={{ background: '#E0247D', borderRadius: '8px', padding: '0.6rem 1.25rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', border: 'none', color: '#fff' }}
                >
                  <Plus size={18} /> Agregar producto
                </button>
              </div>

              {productSuccess && <div style={{ background: '#D1FAE5', color: '#065F46', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CheckCircle size={18} /> Producto creado exitosamente</div>}
              {productError && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle size={18} /> {productError}</div>}

              {showForm && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
                  <div className="product-form" style={{ background: 'white', padding: '2rem', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                      <h3 style={{ margin: 0, color: '#111827', fontSize: '1.25rem' }}>Nuevo Producto</h3>
                      <button onClick={() => setShowForm(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6B7280' }}>
                        <X size={24} />
                      </button>
                    </div>

                    <div className="product-form-grid">
                      <div className="form-field">
                        <label>Nombre *</label>
                        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Café Latte" />
                      </div>
                      <div className="form-field">
                        <label>Precio ($) *</label>
                        <input type="number" step="0.01" min="0" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
                      </div>
                      <div className="form-field">
                        <label>Categoría *</label>
                        <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                          <option value="">Seleccionar...</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="form-field form-field-full">
                        <label>URL de imagen</label>
                        <input value={form.image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))} placeholder="https://..." />
                      </div>
                      <div className="form-field form-field-full">
                        <label>Descripción</label>
                        <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción del producto..." />
                      </div>
                    </div>

                    {form.image && (
                      <div className="image-preview" style={{ marginTop: '1rem' }}>
                        <img src={form.image} alt="preview" style={{ borderRadius: '8px' }} onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                      <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '0.75rem', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}>
                        Cancelar
                      </button>
                      <button className="save-product-btn" onClick={handleCreateProduct} disabled={savingProduct} style={{ flex: 1, background: '#10B981', padding: '0.75rem', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                        {savingProduct ? <><RefreshCw size={18} className="spin-icon" /> Guardando...</> : <><Save size={18} /> Guardar producto</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {loadingProducts ? (
                <div className="orders-loading"><div className="orders-spinner"></div><p>Cargando productos...</p></div>
              ) : (
                <div className="products-admin-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                  {products.map(product => (
                    <div
                      key={product.id}
                      className="product-admin-card"
                      onClick={() => handleOpenEditModal(product)}
                      style={{ display: 'flex', flexDirection: 'column', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', padding: 0, gap: 0, cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative' }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 24px -4px rgba(224,36,125,0.2)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)'; }}
                    >
                      {/* Edit hint overlay */}
                      <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'rgba(255,255,255,0.9)', borderRadius: '50%', padding: '0.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Pencil size={16} color="#E0247D" />
                      </div>
                      <img
                        src={product.image && product.image.trim() !== '' ? product.image : getProductImage(product.name)}
                        alt={product.name}
                        className="product-admin-img"
                        style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '12px 12px 0 0' }}
                        onError={e => { (e.target as HTMLImageElement).src = getProductImage(product.name); }}
                      />
                      <div className="product-admin-info" style={{ padding: '1.25rem', width: '100%' }}>
                        <strong className="product-admin-name" style={{ fontSize: '1.1rem' }}>{product.name}</strong>
                        {product.description && (
                          <span className="product-admin-desc" style={{ marginTop: '0.5rem', color: '#6B7280', display: 'block', fontSize: '0.85rem', lineHeight: '1.4' }}>{product.description}</span>
                        )}
                        <span className="product-admin-price" style={{ marginTop: '0.75rem', fontWeight: 'bold', color: '#E0247D', fontSize: '1.15rem', display: 'block' }}>${Number(product.price).toFixed(2)}</span>
                      </div>
                      <div className="product-admin-meta" style={{ padding: '0.75rem 1.25rem', background: '#F9FAFB', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        {product.stock !== undefined && product.stock !== null ? (
                          <span style={{ fontSize: '0.85rem', fontWeight: '600', color: product.stock > 0 ? '#388E3C' : '#D32F2F' }}>
                            {product.stock > 0 ? `Stock: ${product.stock}${product.has_recipe ? ' (receta)' : ''}` : 'Agotado'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>Sin control de stock</span>
                        )}
                        <span style={{ fontSize: '0.75rem', color: '#9CA3AF', fontStyle: 'italic' }}>Clic para editar</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ TAB PUNTO DE VENTA ══ */}
          {activeTab === 'pos' && (
            <div className="admin-pos">
              {/* IZQUIERDA: Catálogo */}
              <div className="pos-catalog">
                {/* Selector de Mesa */}
                <div className="pos-table-picker" style={{ background: '#fff', padding: '1rem 1.25rem', borderRadius: '10px', border: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <Coffee size={20} color="#E0247D" />
                  <label htmlFor="pos-table-select" className="sr-only">Mesa o tipo de pedido</label>
                  <Dropdown inputId="pos-table-select" value={posSelectedMesaId}
                    options={[{ label: 'Seleccionar mesa', value: '' }, ...mesas.map(m => ({
                      label: m.name.trim().toLocaleLowerCase('es-SV') === 'para llevar'
                        ? 'Para llevar'
                        : `${m.name} (${m.status === 'OCUPADA' ? 'sesión abierta' : 'disponible'})`,
                      value: m.id,
                    }))]}
                    optionLabel="label" optionValue="value" className="w-full"
                    onChange={event => { setPosSelectedMesaId(event.value); setPosStockMessage(null); }}
                    disabled={Boolean(pendingPosOrder) || posIsProcessing} />
                </div>
                {posTableError && <div role="status" style={{ color: '#9A6700', background: '#FFF8C5', padding: '0.75rem 1rem', borderRadius: '8px' }}>
                  {posTableError} <button type="button" onClick={() => void loadMesas()}>Actualizar mesas</button>
                </div>}
                {posAvailabilityError && <div role="alert" style={{ color: '#9B1C1C', background: '#FEF2F2', padding: '0.75rem 1rem', borderRadius: '8px' }}>
                  {posAvailabilityError} <button type="button" onClick={() => void loadProducts()} disabled={loadingProducts}>Actualizar disponibilidad</button>
                </div>}
                {productError && <div role="alert" style={{ color: '#9B1C1C', background: '#FEF2F2', padding: '0.75rem 1rem', borderRadius: '8px' }}>
                  {productError} <button type="button" onClick={() => void loadProducts()} disabled={loadingProducts}>Actualizar productos</button>
                </div>}
                {posStockMessage && <div role="alert" style={{ color: '#9B1C1C', background: '#FEF2F2', padding: '0.75rem 1rem', borderRadius: '8px' }}>{posStockMessage}</div>}

                {/* Búsqueda y Filtros */}
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div className="pos-searchbox" style={{ position: 'relative', flex: 1 }}>
                    <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                    <InputText type="search" placeholder="Buscar producto..." value={posSearchTerm}
                      onChange={e => setPosSearchTerm(e.target.value)} className="w-full" aria-label="Buscar producto" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Button label="Todas" size="small" outlined={posSelectedCategory !== null}
                    className={posSelectedCategory === null ? 'is-selected' : ''} onClick={() => setPosSelectedCategory(null)} />
                  {categories.map(cat => (
                    <Button key={cat.id} label={cat.name} size="small" outlined={posSelectedCategory !== String(cat.id)}
                      className={posSelectedCategory === String(cat.id) ? 'is-selected' : ''}
                      onClick={() => setPosSelectedCategory(String(cat.id))} />
                  ))}
                </div>

                {/* Grid de Productos */}
                <div className="pos-product-list">
                  <div className="pos-product-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                    {posFilteredProducts.map(product => (
                      <Button
                        className="pos-product-card"
                        type="button"
                        key={product.id}
                        onClick={() => posAddToCart(product)}
                        disabled={loadingProducts || Boolean(posAvailabilityError) || !Number.isInteger(product.stock) || product.stock === 0}
                        aria-label={`Agregar ${product.name} al pedido`}
                      >
                        <img
                          src={product.image && product.image.trim() !== '' ? product.image : getProductImage(product.name)}
                          alt={product.name}
                          style={{ width: '100%', height: '120px', objectFit: 'cover' }}
                          onError={e => { (e.target as HTMLImageElement).src = getProductImage(product.name); }}
                        />
                        <div className="pos-product-card__body">
                          <strong style={{ fontSize: '0.9rem', color: '#111827' }}>{product.name}</strong>
                          <div className="pos-product-card__price">
                            <span style={{ fontWeight: '700', color: '#E0247D', fontSize: '1rem' }}>${Number(product.price).toFixed(2)}</span>
                            {(
                              <span style={{ fontSize: '0.75rem', color: product.stock === 0 ? '#EF4444' : '#6B7280' }}>
                                {product.stock === undefined ? 'Validando…' : product.stock === 0 ? 'Agotado' : `Disponible: ${product.stock}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                  {posFilteredProducts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '3rem', color: '#9CA3AF' }}>
                      <Package size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                      <p>No se encontraron productos</p>
                    </div>
                  )}
                </div>
              </div>

              {/* DERECHA: Carrito */}
              <div className="pos-cart-panel">
                <div className="pos-cart-header">
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ShoppingCart size={20} color="#E0247D" /> Carrito
                  </h3>
                  <span style={{ background: '#FDF2F8', color: '#E0247D', padding: '0.2rem 0.75rem', borderRadius: '20px', fontWeight: '700', fontSize: '0.85rem' }}>{posItemCount}</span>
                </div>

                <div className="pos-cart-content" style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
                  {posCart.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#9CA3AF' }}>
                      <ShoppingCart size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                      <p style={{ margin: 0, fontWeight: '500' }}>Carrito vacío</p>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>Haz clic en un producto para agregarlo</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {posCart.map(item => {
                        const line = posPricing.lines[item.lineId];
                        const hasDiscount = !!line && line.discount > 0;
                        return (
                          <div key={item.lineId} className="pos-cart-item">
                            <div className="pos-cart-line">
                              <div className="pos-cart-item__product">
                                <p>{item.product.name}</p>
                                <small>${item.product.price.toFixed(2)} c/u</small>
                              </div>
                              <div className="pos-cart-item__quantity">
                                <Button icon="pi pi-minus" text rounded size="small" aria-label={`Quitar una unidad de ${item.product.name}`} onClick={() => posDecreaseQty(item.lineId)} disabled={item.quantity <= 1} />
                                <span>{item.quantity}</span>
                                <Button icon="pi pi-plus" text rounded size="small" aria-label={`Agregar una unidad de ${item.product.name}`} onClick={() => posIncreaseQty(item.lineId)} />
                              </div>
                              <strong className="pos-cart-item__subtotal">
                                {hasDiscount && <s style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', fontWeight: '500' }}>${item.subtotal.toFixed(2)}</s>}
                                ${(line ? line.net : item.subtotal).toFixed(2)}
                              </strong>
                              <Button className="pos-cart-item__remove" icon="pi pi-trash" text rounded severity="danger" aria-label={`Quitar ${item.product.name} del pedido`} onClick={() => posRemoveFromCart(item.lineId)} />
                            </div>
                            {hasDiscount && (
                              <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#059669', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <Gift size={13} /> {line.promoNames.join(', ')}
                              </div>
                            )}
                            <InputText
                              type="text"
                              value={item.notes ?? ''}
                              maxLength={MAX_NOTE_LENGTH}
                              onChange={e => posUpdateNotes(item.lineId, e.target.value)}
                              placeholder="Comentario (ej: con 2 cucharadas de azúcar)"
                              className="w-full mt-2"
                            />
                          </div>
                        );
                      })}
                      {posPricing.hints.map((hint, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: '#ECFDF5', color: '#047857', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600' }}>
                          <Gift size={15} style={{ flexShrink: 0 }} /> <span>{hint}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {posCart.length > 0 && (
                  <div style={{ padding: '1.25rem', borderTop: '2px solid #E5E7EB' }}>
                    {posSelectedMesa && (
                      <div style={{ padding: '0.5rem 0.75rem', background: '#F3F4F6', borderRadius: '6px', marginBottom: '0.75rem', fontSize: '0.85rem', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Pedido:</span> <strong style={{ color: '#111827' }}>{posSelectedMesa.name.trim().toLocaleLowerCase('es-SV') === 'para llevar' ? 'Para llevar' : posSelectedMesa.name}</strong>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <span style={{ fontWeight: '600', color: '#4B5563' }}>Estimado (sin promociones):</span>
                      <strong style={{ fontSize: '1.5rem', color: '#10B981' }}>${posTotal.toFixed(2)}</strong>
                    </div>
                    <Button
                      onClick={() => posConfirmOrder()}
                      disabled={posIsProcessing || Boolean(pendingPosOrder) || loadingProducts || !posSelectedMesaId || Boolean(posAvailabilityError)}
                      className="w-full"
                      severity="success"
                      icon={posIsProcessing ? 'pi pi-spin pi-spinner' : 'pi pi-check'}
                      label={posIsProcessing ? 'Procesando…' : loadingProducts ? 'Validando productos…' : posAvailabilityError ? 'Actualiza disponibilidad' : !posSelectedMesaId ? 'Selecciona una mesa' : 'Confirmar pedido'}
                    >
                    </Button>
                  </div>
                )}
                {pendingPosOrder && <div role="status" className="flex flex-column gap-2" style={{ padding: '1rem', borderTop: '1px solid #E5E7EB' }}>
                  <p style={{ margin: 0 }}>Hay un envío sin resultado confirmado. Conservamos la misma clave y el mismo carrito; reintenta sin modificar la intención.</p>
                  <Button type="button" label={posIsProcessing ? 'Consultando resultado…' : 'Reintentar envío pendiente'}
                    icon="pi pi-refresh" outlined className="w-full" onClick={() => posConfirmOrder(true)} disabled={posIsProcessing} />
                </div>}
              </div>
            </div>
          )}

          {/* ══ TAB PROMOCIONES ══ */}
          {activeTab === 'promos' && userRole === 'admin' && <PromotionsPanel />}
          {activeTab === 'inventory' && <Suspense fallback={<div role="status">Cargando inventario…</div>}><InventoryPage onUnsavedChangesChange={setInventoryRecipeDirty} /></Suspense>}

          {/* ══ TAB REPORTES ══ */}
          {activeTab === 'caja' && (userRole === 'admin' || userRole === 'cashier') && <CajaPage initialSessionId={cashSessionId} />}
          {activeTab === 'reports' && (userRole === 'admin' || userRole === 'cashier') && <ReportsPage />}

          {/* ══ TAB USUARIOS ══ */}
          {activeTab === 'users' && userRole === 'admin' && <UsersAdmin />}
        </div>
      </main>

      {/* MODAL DE EDICIÓN DE PRODUCTO */}
      {editProduct && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditProduct(null); }}
        >
          <div className="product-form" style={{ background: 'white', padding: '2rem', borderRadius: '16px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, color: '#111827', fontSize: '1.35rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ background: '#FDF2F8', padding: '0.5rem', borderRadius: '8px', display: 'flex' }}>
                  <Pencil size={20} color="#E0247D" />
                </div>
                Editar Producto
              </h3>
              <button onClick={() => setEditProduct(null)} style={{ background: '#F3F4F6', border: 'none', cursor: 'pointer', color: '#6B7280', borderRadius: '8px', padding: '0.5rem', display: 'flex', transition: 'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#E5E7EB'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#F3F4F6'}
              >
                <X size={22} />
              </button>
            </div>

            {/* Preview de imagen actual */}
            <div style={{ marginBottom: '1.5rem', borderRadius: '12px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
              <img
                src={editForm.image && editForm.image.trim() !== '' ? editForm.image : getProductImage(editForm.name)}
                alt={editForm.name || 'Producto'}
                style={{ width: '100%', height: '200px', objectFit: 'cover', display: 'block' }}
                onError={e => { (e.target as HTMLImageElement).src = getProductImage(editForm.name); }}
              />
            </div>

            {editError && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.85rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}><AlertTriangle size={18} /> {editError}</div>}

            <div className="product-form-grid">
              <div className="form-field">
                <label>Nombre *</label>
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Café Latte" />
              </div>
              <div className="form-field">
                <label>Precio ($) *</label>
                <input type="number" step="0.01" min="0" value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="form-field">
                <label>Categoría *</label>
                <select value={editForm.category_id} onChange={e => setEditForm(f => ({ ...f, category_id: e.target.value }))}>
                  <option value="">Seleccionar...</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-field form-field-full">
                <label>URL de imagen</label>
                <input value={editForm.image} onChange={e => setEditForm(f => ({ ...f, image: e.target.value }))} placeholder="https://..." />
              </div>
              <div className="form-field form-field-full">
                <label>Descripción</label>
                <textarea
                  value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Descripción del producto..."
                  rows={3}
                  style={{ width: '100%', padding: '0.65rem 0.75rem', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.95rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
                />
              </div>
            </div>

            <p style={{ margin: '1rem 0 0', color: '#6B7280', fontSize: '0.85rem' }}>
              El stock y las recetas se administran desde la sección <strong>Inventario</strong> mediante operaciones auditables.
            </p>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                onClick={() => { handleDeleteProduct(editProduct.id); setEditProduct(null); }}
                style={{ padding: '0.75rem 1rem', background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.15s', fontSize: '0.95rem' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#FECACA'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#FEE2E2'}
              >
                <Trash2 size={18} /> Eliminar
              </button>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setEditProduct(null)}
                style={{ padding: '0.75rem 1.5rem', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s', fontSize: '0.95rem' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#E5E7EB'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#F3F4F6'}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                style={{ padding: '0.75rem 1.5rem', background: '#10B981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: savingEdit ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.15s', fontSize: '0.95rem', opacity: savingEdit ? 0.7 : 1 }}
              >
                {savingEdit ? <><RefreshCw size={18} className="spin-icon" /> Guardando...</> : <><Save size={18} /> Guardar cambios</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
