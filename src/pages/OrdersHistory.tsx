import { Suspense, lazy, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { ClipboardList, Coffee, Package, LogOut, RefreshCw, AlertTriangle, ChefHat, CheckCircle, Bell, Ban, Trash2, CreditCard, Clock, Calendar, DollarSign, Plus, X, Save, ShoppingCart, Minus, Search, Wallet, BarChart3, Banknote, Smartphone, Hash, Pencil, Users, Gift, MessageSquareText, Boxes, UserRound } from 'lucide-react';
import {
  fetchOrders, fetchOrderById, updateOrderStatus,
  fetchProducts, fetchCategories, createProduct, deleteProduct, updateProduct,
  fetchMesas, payTableOrders, createOrder, fetchReport, fetchActivePromotions
} from '../services/api';
import type { Mesa, ReportData } from '../services/api';
import type { Order, CartItem } from '../types/Order';
import type { Product } from '../types/Product';
import type { Category } from '../types/Category';
import type { Promotion } from '../types/Promotion';
import { getProductImage } from '../utils/productImage';
import { useAuth } from '../auth/AuthContext';
import { PromotionsPanel } from '../components/PromotionsPanel';
import { UsersAdmin } from './admin/UsersAdmin';
import { AdminCatalogPage } from './admin/AdminCatalogPage';
import { calculateCartPricing, newLineId, getProductPromos, promoLabel, MAX_NOTE_LENGTH } from '../utils/promotions';

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
function legacyProductAdminVisible(role: string, tab: string): boolean {
  void role;
  void tab;
  return false;
}

export function OrdersHistory() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const userRole = session?.profile.role ?? 'waiter';
  const [activeTab, setActiveTab] = useState<'orders' | 'products' | 'mesas' | 'pos' | 'reports' | 'users' | 'promos' | 'inventory' | 'profile'>(userRole === 'admin' ? 'orders' : 'pos');
  const [inventoryRecipeDirty, setInventoryRecipeDirty] = useState(false);
  const navigateTab = useCallback((nextTab: typeof activeTab) => {
    if (activeTab === 'inventory' && inventoryRecipeDirty
      && !window.confirm('Hay cambios sin guardar en la receta. ¿Salir del inventario y descartarlos?')) return;
    setInventoryRecipeDirty(false);
    setActiveTab(nextTab);
  }, [activeTab, inventoryRecipeDirty]);
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
  const [loadingMesas, setLoadingMesas] = useState(false);
  const [processingPayment, setProcessingPayment] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{ mesaId: string; mesaName: string; total: number; count: number; } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo');

  // — POS (Punto de Venta) —
  const [posCart, setPosCart] = useState<CartItem[]>([]);
  const [posSelectedMesaId, setPosSelectedMesaId] = useState<string>('');
  const [posSearchTerm, setPosSearchTerm] = useState('');
  const [posSelectedCategory, setPosSelectedCategory] = useState<number | null>(null);
  const [posIsProcessing, setPosIsProcessing] = useState(false);
  const [posPromotions, setPosPromotions] = useState<Promotion[]>([]);

  // — Reportes —
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportFilterType, setReportFilterType] = useState<'day' | 'range'>('day');
  const [reportDateFrom, setReportDateFrom] = useState(() => new Date().toISOString().split('T')[0]);
  const [reportDateTo, setReportDateTo] = useState(() => new Date().toISOString().split('T')[0]);

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

  async function loadReport() {
    setReportLoading(true);
    try {
      const from = reportDateFrom;
      const to = reportFilterType === 'range' ? reportDateTo : reportDateFrom;
      const data = await fetchReport(from, to);
      setReportData(data);
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar el reporte.', confirmButtonColor: '#EF4444' });
    } finally {
      setReportLoading(false);
    }
  }

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
    setLoadingProducts(true);
    try {
      const [prods, cats] = await Promise.all([fetchProducts(), fetchCategories()]);
      setProducts(prods);
      setCategories(cats);
    } catch {
      setProductError('No se pudieron cargar los productos.');
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  const loadMesas = useCallback(async () => {
    setLoadingMesas(true);
    try {
      const data = await fetchMesas();
      setMesas(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMesas(false);
    }
  }, []);

  const loadPosPromotions = useCallback(async () => {
    try {
      setPosPromotions(await fetchActivePromotions());
    } catch {
      setPosPromotions([]);
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  useEffect(() => {
    if (activeTab === 'mesas') loadMesas();
    if (activeTab === 'pos') { loadMesas(); loadProducts(); loadPosPromotions(); }
  }, [activeTab, loadProducts, loadMesas, userRole, loadPosPromotions]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (activeTab === 'orders') loadOrders();
      if (activeTab === 'mesas') loadMesas();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab, loadOrders, loadMesas]);

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

  function handlePayMesa(mesa: Mesa) {
    const mesaOrders = orders.filter(o => o.mesa_id === mesa.id && o.status === 'delivered' && !o.pago_id);
    if (mesaOrders.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Sin pedidos por cobrar',
        text: 'No hay pedidos "Entregados" pendientes de cobro para esta mesa.',
        confirmButtonColor: '#E0247D'
      });
      return;
    }
    const total = mesaOrders.reduce((sum, o) => sum + Number(o.total), 0);
    setPaymentModal({ mesaId: mesa.id, mesaName: mesa.name, total, count: mesaOrders.length });
  }

  async function confirmPaymentMesa() {
    if (!paymentModal) return;
    setProcessingPayment(paymentModal.mesaId);
    try {
      const res = await payTableOrders(paymentModal.mesaId, paymentMethod);
      Swal.fire({
        icon: 'success',
        title: '¡Cobro Exitoso!',
        text: res.message || `Total cobrado: $${res.data?.total_paid}`,
        confirmButtonColor: '#10B981'
      });
      await loadMesas();
      await loadOrders();
    } catch (e) {
      Swal.fire({
        icon: 'error',
        title: 'Error de Cobro',
        text: (e instanceof Error ? e.message : '') || 'Error al procesar el pago.',
        confirmButtonColor: '#EF4444'
      });
    } finally {
      setProcessingPayment(null);
      setPaymentModal(null);
      setPaymentMethod('efectivo');
    }
  }

  // ── POS Functions ──
  function posAddToCart(product: Product) {
    setPosCart(prev => {
      // Se suma a la línea del mismo producto SIN comentario; si ya tiene comentario, se crea otra línea
      const existing = prev.find(item => item.product.id === product.id && !item.notes);
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
    setPosCart(prev =>
      prev.map(item =>
        item.lineId === lineId
          ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.product.price }
          : item
      )
    );
  }

  function posDecreaseQty(lineId: string) {
    setPosCart(prev =>
      prev.map(item =>
        item.lineId === lineId && item.quantity > 1
          ? { ...item, quantity: item.quantity - 1, subtotal: (item.quantity - 1) * item.product.price }
          : item
      )
    );
  }

  function posRemoveFromCart(lineId: string) {
    setPosCart(prev => prev.filter(item => item.lineId !== lineId));
  }

  // Comentario del cliente para un producto (ej: "con 2 cucharadas de azúcar")
  function posUpdateNotes(lineId: string, notes: string) {
    setPosCart(prev => prev.map(item => (item.lineId === lineId ? { ...item, notes } : item)));
  }

  async function posConfirmOrder() {
    if (posCart.length === 0 || !posSelectedMesaId) return;
    setPosIsProcessing(true);
    try {
      // El servidor calcula precios y promociones; aquí solo se envía qué y cuántos (+ comentario)
      const order = {
        mesa_id: posSelectedMesaId,
        items: posCart.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          notes: item.notes?.trim() || undefined,
        })),
      };
      await createOrder(order);
      setPosCart([]);
      Swal.fire({ icon: 'success', title: '¡Pedido Creado!', text: `El pedido fue asignado correctamente a la mesa seleccionada.`, confirmButtonColor: '#10B981' });
      await loadOrders();
      await loadMesas();
      await loadProducts(); // el inventario cambió: refresca lo disponible
    } catch (e) {
      // El servidor explica el motivo (ej: "No hay suficiente inventario: Leche para ...")
      Swal.fire({ icon: 'error', title: 'No se pudo crear el pedido', text: e instanceof Error && e.message ? e.message : 'Intenta de nuevo.', confirmButtonColor: '#EF4444' });
      loadProducts(); // puede que algo se haya agotado: refresca lo disponible
    } finally {
      setPosIsProcessing(false);
    }
  }

  const posFilteredProducts = products.filter(p => {
    const catMatch = posSelectedCategory === null || p.category_id === posSelectedCategory;
    const searchMatch = posSearchTerm === '' || p.name.toLowerCase().includes(posSearchTerm.toLowerCase());
    return catMatch && searchMatch;
  });

  const posPricing = calculateCartPricing(posCart, posPromotions);
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

  return (
    <div className="admin-layout" style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: '#F3F4F6', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* SIDEBAR */}
      <aside className="admin-sidebar" style={{ width: '260px', backgroundColor: '#ffffff', borderRight: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', padding: '1.5rem', zIndex: 10 }}>
        <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '2.5rem' }}>
          <img src="/turron-logo.jpg" alt="Logo TURRÓN" style={{ width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #E0247D' }} />
          <div>
            <h2 style={{ fontSize: '1.25rem', color: '#111827', margin: 0, fontWeight: '800', lineHeight: 1.1 }}>TURRÓN</h2>
            <span style={{ fontSize: '0.75rem', color: '#E0247D', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Pastelería</span>
          </div>
        </div>

        <nav className="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
          {userRole === 'admin' && (
            <button
              onClick={() => navigateTab('orders')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'orders' ? '#FDF2F8' : 'transparent', color: activeTab === 'orders' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'orders' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'orders') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'orders') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <ClipboardList size={20} /> Pedidos
            </button>
          )}
          {userRole === 'admin' && (
            <button
              onClick={() => navigateTab('mesas')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'mesas' ? '#FDF2F8' : 'transparent', color: activeTab === 'mesas' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'mesas' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'mesas') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'mesas') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Coffee size={20} /> Mesas y Pagos
            </button>
          )}
          {userRole === 'admin' && (
            <button
              onClick={() => navigateTab('products')}
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
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'promos' ? '#FDF2F8' : 'transparent', color: activeTab === 'promos' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'promos' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'promos') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'promos') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Gift size={20} /> Promociones
            </button>
          )}
          <button
            onClick={() => navigateTab('inventory')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'inventory' ? '#FDF2F8' : 'transparent', color: activeTab === 'inventory' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'inventory' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
            onMouseEnter={(e) => { if (activeTab !== 'inventory') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
            onMouseLeave={(e) => { if (activeTab !== 'inventory') e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <Boxes size={20} /> Inventario
          </button>
          <button
            onClick={() => navigateTab('pos')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'pos' ? '#FDF2F8' : 'transparent', color: activeTab === 'pos' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'pos' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
            onMouseEnter={(e) => { if (activeTab !== 'pos') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
            onMouseLeave={(e) => { if (activeTab !== 'pos') e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <ShoppingCart size={20} /> Nuevo Pedido
          </button>
          {userRole === 'admin' && (
            <button
              onClick={() => navigateTab('reports')}
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
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'users' ? '#FDF2F8' : 'transparent', color: activeTab === 'users' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'users' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
              onMouseEnter={(e) => { if (activeTab !== 'users') e.currentTarget.style.backgroundColor = '#F9FAFB'; }}
              onMouseLeave={(e) => { if (activeTab !== 'users') e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Users size={20} /> Usuarios
            </button>
          )}
          <button
            onClick={() => navigateTab('profile')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '8px', border: 'none', background: activeTab === 'profile' ? '#FDF2F8' : 'transparent', color: activeTab === 'profile' ? '#E0247D' : '#4B5563', fontWeight: activeTab === 'profile' ? '600' : '500', cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'left', fontSize: '1rem' }}
          >
            <UserRound size={20} /> Mi perfil
          </button>
        </nav>

        <div className="sidebar-footer" style={{ borderTop: '1px solid #E5E7EB', paddingTop: '1.5rem', marginTop: 'auto' }}>
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

      {/* MAIN CONTENT */}
      <main className="admin-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header className="admin-topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2.5rem', backgroundColor: '#ffffff', borderBottom: '1px solid #E5E7EB', zIndex: 5 }}>
          <h1 style={{ fontSize: '1.5rem', color: '#111827', margin: 0, fontWeight: '700' }}>
            {activeTab === 'orders' ? 'Gestión de Pedidos' : activeTab === 'mesas' ? 'Mesas y Pagos' : activeTab === 'products' ? 'Catálogo de Productos' : activeTab === 'pos' ? 'Punto de Venta' : activeTab === 'users' ? 'Gestión de Usuarios' : activeTab === 'promos' ? 'Promociones y Ofertas' : activeTab === 'inventory' ? 'Inventario de Ingredientes' : activeTab === 'profile' ? 'Mi perfil' : 'Reportes'}
          </h1>
          <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <button
              type="button"
              onClick={() => navigateTab('profile')}
              style={{ border: 0, background: 'transparent', textAlign: 'right', cursor: 'pointer', color: '#374151' }}
              aria-label="Abrir mi perfil"
            >
              <strong style={{ display: 'block' }}>{profileName}</strong>
              <span style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'capitalize' }}>{userRole}</span>
            </button>
            {activeTab === 'orders' || activeTab === 'mesas' ? (
              <>
                <label className="auto-refresh-toggle" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#4B5563', fontSize: '0.95rem', cursor: 'pointer', fontWeight: '500' }}>
                  <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ accentColor: '#E0247D', width: '16px', height: '16px' }} />
                  Auto-actualizar
                </label>
                <button
                  className="refresh-btn"
                  onClick={() => activeTab === 'orders' ? loadOrders() : loadMesas()}
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

        <div className="admin-content" style={{ flex: 1, overflowY: 'auto', padding: '2.5rem' }}>

          {activeTab === 'profile' && session && (
            <section aria-labelledby="profile-title" style={{ maxWidth: '640px', background: '#fff', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '2rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <h2 id="profile-title" style={{ margin: '0 0 1.5rem', color: '#111827' }}>Mi perfil</h2>
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

          {activeTab === 'orders' && (
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
          {activeTab === 'mesas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
              {loadingMesas ? (
                <div className="orders-loading"><div className="orders-spinner"></div><p>Cargando mesas...</p></div>
              ) : (
                <div className="products-admin-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                  {mesas.map(mesa => (
                    <div key={mesa.id} className="product-admin-card" style={{ padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                      <div className="product-admin-info" style={{ width: '100%' }}>
                        <strong className="product-admin-name" style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>{mesa.name}</strong>
                        <div style={{ marginBottom: '1rem' }}>
                          <span className="order-status-badge" style={{
                            background: mesa.status === 'DISPONIBLE' ? '#388E3C' :
                              mesa.status === 'OCUPADA' ? '#E0247D' :
                                mesa.status === 'ASIGNADA' ? '#1976D2' : '#757575',
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.85rem'
                          }}>
                            {mesa.status}
                          </span>
                        </div>

                        {mesa.status === 'OCUPADA' && (
                          <button
                            onClick={() => handlePayMesa(mesa)}
                            disabled={processingPayment === mesa.id}
                            style={{
                              width: '100%',
                              padding: '0.75rem',
                              background: '#E0247D',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: processingPayment === mesa.id ? 'not-allowed' : 'pointer',
                              fontWeight: '600',
                              transition: 'background 0.2s',
                              boxShadow: '0 2px 4px rgba(224, 36, 125, 0.25)'
                            }}
                            onMouseEnter={(e) => { if (processingPayment !== mesa.id) e.currentTarget.style.backgroundColor = '#C2185B'; }}
                            onMouseLeave={(e) => { if (processingPayment !== mesa.id) e.currentTarget.style.backgroundColor = '#E0247D'; }}
                          >
                            <CreditCard size={18} /> {processingPayment === mesa.id ? 'Cobrando...' : 'Cobrar Pedidos'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
            <div style={{ display: 'flex', gap: '1.5rem', height: '100%' }}>
              {/* IZQUIERDA: Catálogo */}
              <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'hidden' }}>
                {/* Selector de Mesa */}
                <div style={{ background: '#fff', padding: '1rem 1.25rem', borderRadius: '10px', border: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <Coffee size={20} color="#E0247D" />
                  <select
                    value={posSelectedMesaId}
                    onChange={e => setPosSelectedMesaId(e.target.value)}
                    style={{ flex: 1, padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.95rem', color: '#111827', fontWeight: '500' }}
                  >
                    <option value="">— Seleccionar Mesa —</option>
                    {mesas.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.status === 'DISPONIBLE' ? '🟢 Disponible' : m.status === 'OCUPADA' ? '🔴 Ocupada' : m.status === 'ASIGNADA' ? '🔵 Asignada' : '⚪ No disponible'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Búsqueda y Filtros */}
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                    <input
                      type="text"
                      placeholder="Buscar producto..."
                      value={posSearchTerm}
                      onChange={e => setPosSearchTerm(e.target.value)}
                      style={{ width: '100%', padding: '0.6rem 0.75rem 0.6rem 2.5rem', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.95rem', outline: 'none' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setPosSelectedCategory(null)}
                    style={{ padding: '0.4rem 0.9rem', borderRadius: '20px', border: 'none', background: posSelectedCategory === null ? '#E0247D' : '#F3F4F6', color: posSelectedCategory === null ? '#fff' : '#4B5563', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}
                  >Todas</button>
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setPosSelectedCategory(cat.id)}
                      style={{ padding: '0.4rem 0.9rem', borderRadius: '20px', border: 'none', background: posSelectedCategory === cat.id ? '#E0247D' : '#F3F4F6', color: posSelectedCategory === cat.id ? '#fff' : '#4B5563', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}
                    >{cat.name}</button>
                  ))}
                </div>

                {/* Grid de Productos */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                    {posFilteredProducts.map(product => (
                      <div
                        key={product.id}
                        onClick={() => product.stock !== 0 && posAddToCart(product)}
                        style={{ display: 'flex', flexDirection: 'column', borderRadius: '10px', overflow: 'hidden', background: '#fff', border: '1px solid #E5E7EB', cursor: product.stock === 0 ? 'not-allowed' : 'pointer', opacity: product.stock === 0 ? 0.5 : 1, transition: 'all 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
                        onMouseEnter={e => { if (product.stock !== 0) { e.currentTarget.style.borderColor = '#E0247D'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(224,36,125,0.15)'; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'; }}
                      >
                        <img
                          src={product.image && product.image.trim() !== '' ? product.image : getProductImage(product.name)}
                          alt={product.name}
                          style={{ width: '100%', height: '120px', objectFit: 'cover' }}
                          onError={e => { (e.target as HTMLImageElement).src = getProductImage(product.name); }}
                        />
                        <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <strong style={{ fontSize: '0.9rem', color: '#111827' }}>{product.name}</strong>
                          {getProductPromos(product, posPromotions).length > 0 && (
                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                              {getProductPromos(product, posPromotions).map(p => (
                                <span key={p.id} title={p.name} style={{ background: '#ECFDF5', color: '#047857', fontSize: '0.7rem', fontWeight: '800', padding: '0.1rem 0.45rem', borderRadius: '20px', border: '1px solid #A7F3D0' }}>{promoLabel(p)}</span>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                            <span style={{ fontWeight: '700', color: '#E0247D', fontSize: '1rem' }}>${Number(product.price).toFixed(2)}</span>
                            {product.stock !== undefined && product.stock !== null && (
                              <span style={{ fontSize: '0.75rem', color: product.stock === 0 ? '#EF4444' : '#6B7280' }}>
                                {product.stock === 0 ? 'Agotado' : `Stock: ${product.stock}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
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
              <div style={{ width: '340px', flexShrink: 0, background: '#fff', borderRadius: '12px', border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '1.25rem', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ShoppingCart size={20} color="#E0247D" /> Carrito
                  </h3>
                  <span style={{ background: '#FDF2F8', color: '#E0247D', padding: '0.2rem 0.75rem', borderRadius: '20px', fontWeight: '700', fontSize: '0.85rem' }}>{posItemCount}</span>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
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
                          <div key={item.lineId} style={{ padding: '0.75rem', background: '#F9FAFB', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ margin: 0, fontWeight: '600', fontSize: '0.9rem', color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.product.name}</p>
                                <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#6B7280' }}>${item.product.price.toFixed(2)} c/u</p>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <button onClick={() => posDecreaseQty(item.lineId)} disabled={item.quantity <= 1} style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151' }}><Minus size={14} /></button>
                                <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: '700', fontSize: '0.9rem' }}>{item.quantity}</span>
                                <button onClick={() => posIncreaseQty(item.lineId)} style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151' }}><Plus size={14} /></button>
                              </div>
                              <strong style={{ fontSize: '0.9rem', color: '#111827', minWidth: '55px', textAlign: 'right' }}>
                                {hasDiscount && <s style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', fontWeight: '500' }}>${item.subtotal.toFixed(2)}</s>}
                                ${(line ? line.net : item.subtotal).toFixed(2)}
                              </strong>
                              <button onClick={() => posRemoveFromCart(item.lineId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: '0.2rem' }}><Trash2 size={16} /></button>
                            </div>
                            {hasDiscount && (
                              <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#059669', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <Gift size={13} /> {line.promoNames.join(', ')}
                              </div>
                            )}
                            <input
                              type="text"
                              value={item.notes ?? ''}
                              maxLength={MAX_NOTE_LENGTH}
                              onChange={e => posUpdateNotes(item.lineId, e.target.value)}
                              placeholder="Comentario (ej: con 2 cucharadas de azúcar)"
                              style={{ width: '100%', marginTop: '0.5rem', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px dashed #D1D5DB', background: '#fff', fontSize: '0.8rem', color: '#374151', outline: 'none', boxSizing: 'border-box' }}
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
                        <span>Mesa:</span> <strong style={{ color: '#111827' }}>{posSelectedMesa.name}</strong>
                      </div>
                    )}
                    {posPricing.discountTotal > 0 && (
                      <div style={{ marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4B5563' }}>
                          <span>Subtotal</span><span>${posPricing.subtotal.toFixed(2)}</span>
                        </div>
                        {posPricing.applied.map(a => (
                          <div key={a.promoId} style={{ display: 'flex', justifyContent: 'space-between', color: '#059669', fontWeight: '600' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Gift size={13} /> {a.name}</span>
                            <span>-${a.discount.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <span style={{ fontWeight: '600', color: '#4B5563' }}>Total:</span>
                      <strong style={{ fontSize: '1.5rem', color: '#10B981' }}>${posTotal.toFixed(2)}</strong>
                    </div>
                    <button
                      onClick={posConfirmOrder}
                      disabled={posIsProcessing || !posSelectedMesaId}
                      style={{ width: '100%', padding: '0.85rem', background: !posSelectedMesaId ? '#9CA3AF' : '#10B981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '1rem', cursor: !posSelectedMesaId ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', transition: 'background 0.2s' }}
                    >
                      {posIsProcessing ? <><RefreshCw size={18} className="spin-icon" /> Procesando...</> : !posSelectedMesaId ? 'Selecciona una mesa' : <><CheckCircle size={18} /> Confirmar Pedido</>}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ TAB PROMOCIONES ══ */}
          {activeTab === 'promos' && userRole === 'admin' && <PromotionsPanel />}
          {activeTab === 'inventory' && <Suspense fallback={<div role="status">Cargando inventario…</div>}><InventoryPage onUnsavedChangesChange={setInventoryRecipeDirty} /></Suspense>}

          {/* ══ TAB REPORTES ══ */}
          {activeTab === 'reports' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
              {/* Filtro de Fechas */}
              <div style={{ background: '#fff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #E5E7EB', display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#6B7280', marginBottom: '0.35rem' }}>Tipo de filtro</label>
                  <select
                    value={reportFilterType}
                    onChange={e => setReportFilterType(e.target.value as 'day' | 'range')}
                    style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.9rem', fontWeight: '500' }}
                  >
                    <option value="day">Por día</option>
                    <option value="range">Rango de fechas</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#6B7280', marginBottom: '0.35rem' }}>{reportFilterType === 'day' ? 'Fecha' : 'Desde'}</label>
                  <input type="date" value={reportDateFrom} onChange={e => setReportDateFrom(e.target.value)} style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.9rem' }} />
                </div>
                {reportFilterType === 'range' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#6B7280', marginBottom: '0.35rem' }}>Hasta</label>
                    <input type="date" value={reportDateTo} onChange={e => setReportDateTo(e.target.value)} style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.9rem' }} />
                  </div>
                )}
                <button
                  onClick={loadReport}
                  disabled={reportLoading}
                  style={{ padding: '0.55rem 1.5rem', borderRadius: '8px', border: 'none', background: '#E0247D', color: '#fff', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', transition: 'background 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#C2185B'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = '#E0247D'}
                >
                  {reportLoading ? <><RefreshCw size={16} className="spin-icon" /> Cargando...</> : <><Search size={16} /> Generar Reporte</>}
                </button>
              </div>

              {reportData ? (
                <>
                  {/* KPI Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                    {/* Total */}
                    <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '10px', border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6B7280', fontSize: '0.85rem', fontWeight: '600' }}><DollarSign size={18} color="#10B981" /> Ingresos Totales</div>
                      <strong style={{ fontSize: '1.75rem', color: '#10B981' }}>${Number(reportData.total_income).toFixed(2)}</strong>
                      <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>{Number(reportData.total_transactions)} transacciones</span>
                    </div>
                    {/* Efectivo */}
                    <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '10px', border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6B7280', fontSize: '0.85rem', fontWeight: '600' }}><Banknote size={18} color="#16A34A" /> Efectivo</div>
                      <strong style={{ fontSize: '1.75rem', color: '#111827' }}>${Number(reportData.income_efectivo).toFixed(2)}</strong>
                      <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>{Number(reportData.count_efectivo)} pagos</span>
                    </div>
                    {/* Tarjeta */}
                    <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '10px', border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6B7280', fontSize: '0.85rem', fontWeight: '600' }}><CreditCard size={18} color="#2563EB" /> Tarjeta</div>
                      <strong style={{ fontSize: '1.75rem', color: '#111827' }}>${Number(reportData.income_tarjeta).toFixed(2)}</strong>
                      <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>{Number(reportData.count_tarjeta)} pagos</span>
                    </div>
                    {/* Transferencia */}
                    <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '10px', border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6B7280', fontSize: '0.85rem', fontWeight: '600' }}><Smartphone size={18} color="#7C3AED" /> Transferencia</div>
                      <strong style={{ fontSize: '1.75rem', color: '#111827' }}>${Number(reportData.income_transferencia).toFixed(2)}</strong>
                      <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>{Number(reportData.count_transferencia)} pagos</span>
                    </div>
                  </div>

                  {/* Items Vendidos */}
                  <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '10px', border: '1px solid #E5E7EB' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                      <h3 style={{ margin: 0, color: '#111827', fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Package size={20} color="#E0247D" /> Productos Vendidos
                      </h3>
                      <span style={{ background: '#FDF2F8', color: '#E0247D', padding: '0.3rem 0.85rem', borderRadius: '20px', fontWeight: '700', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Hash size={14} /> {reportData.total_items_sold} items
                      </span>
                    </div>
                    {reportData.items_breakdown && reportData.items_breakdown.length > 0 ? (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                              <th style={{ textAlign: 'left', padding: '0.75rem', color: '#6B7280', fontWeight: '600' }}>Producto</th>
                              <th style={{ textAlign: 'center', padding: '0.75rem', color: '#6B7280', fontWeight: '600' }}>Cantidad</th>
                              <th style={{ textAlign: 'right', padding: '0.75rem', color: '#6B7280', fontWeight: '600' }}>Ingresos</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.items_breakdown.map((item, idx: number) => (
                              <tr key={idx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                                <td style={{ padding: '0.75rem', color: '#111827', fontWeight: '500' }}>{item.product_name}</td>
                                <td style={{ padding: '0.75rem', textAlign: 'center', color: '#374151' }}>{Number(item.total_qty)}</td>
                                <td style={{ padding: '0.75rem', textAlign: 'right', color: '#10B981', fontWeight: '600' }}>${Number(item.total_revenue).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p style={{ textAlign: 'center', color: '#9CA3AF', padding: '2rem' }}>No hay productos vendidos en este período.</p>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '5rem', color: '#9CA3AF' }}>
                  <BarChart3 size={64} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                  <p style={{ fontSize: '1.1rem', fontWeight: '500' }}>Selecciona una fecha y genera tu reporte</p>
                </div>
              )}
            </div>
          )}

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


      {/* MODAL DE PAGO */}
      {paymentModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', color: '#111827' }}>
              <div style={{ background: '#FDF2F8', padding: '0.75rem', borderRadius: '50%' }}>
                <DollarSign size={24} color="#E0247D" />
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0 }}>Confirmar Cobro</h2>
            </div>

            <div style={{ background: '#F9FAFB', padding: '1.25rem', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #E5E7EB' }}>
              <p style={{ margin: '0 0 0.5rem 0', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                <span>Mesa:</span> <strong style={{ color: '#111827' }}>{paymentModal.mesaName}</strong>
              </p>
              <p style={{ margin: '0 0 0.5rem 0', color: '#4B5563', display: 'flex', justifyContent: 'space-between' }}>
                <span>Pedidos Entregados:</span> <strong style={{ color: '#111827' }}>{paymentModal.count}</strong>
              </p>
              <hr style={{ borderTop: '1px solid #E5E7EB', margin: '1rem 0' }} />
              <p style={{ margin: 0, fontSize: '1.1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#4B5563', fontWeight: '500' }}>Total a Cobrar:</span>
                <strong style={{ fontSize: '1.5rem', color: '#10B981' }}>${paymentModal.total.toFixed(2)}</strong>
              </p>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#4B5563', marginBottom: '0.5rem' }}>
                <Wallet size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.35rem' }} /> Método de Pago
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['efectivo', 'tarjeta', 'transferencia'] as const).map(method => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      borderRadius: '8px',
                      border: paymentMethod === method ? '2px solid #E0247D' : '1px solid #D1D5DB',
                      background: paymentMethod === method ? '#FDF2F8' : '#fff',
                      color: paymentMethod === method ? '#E0247D' : '#4B5563',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      textTransform: 'capitalize',
                      transition: 'all 0.15s'
                    }}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => { setPaymentModal(null); setPaymentMethod('efectivo'); }}
                style={{ flex: 1, padding: '0.75rem', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
                disabled={processingPayment !== null}
              >
                Cancelar
              </button>
              <button
                onClick={confirmPaymentMesa}
                style={{ flex: 1, padding: '0.75rem', background: '#10B981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                disabled={processingPayment !== null}
              >
                {processingPayment ? <RefreshCw size={18} className="spin-icon" /> : 'Confirmar Pago'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
