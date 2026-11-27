import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, XCircle, CheckCircle, ShoppingCart, X } from 'lucide-react';
import type { Product } from '../../types/Product';
import type { Category } from '../../types/Category';
import type { CartItem } from '../../types/Order';
import { KioskLayout } from '../../components/layout/KioskoLayout';
import { ProductGrid } from '../../components/ProductGrid';
import { SearchBar } from '../../components/SearchBar';
import { Cart } from '../../components/Cart';
import { PromoBanner } from '../../components/PromoBanner';
import { catalogService, type PublicCategory, type PublicMenuItem } from '../../services/catalog';
import { calculateCartPricing, newLineId } from '../../utils/promotions';
import { createCafeTablesService } from '../../services/cafeTables';
import { httpClient } from '../../services/http/client';
import { createCafeOrdersService, ordersErrorMessage } from '../../features/orders/ordersService';
import type { CreateOrderLine, KioskOrderTracking, OrderStatus } from '../../features/orders/model';
import { ApiError } from '../../services/http/client';

const cafeTablesService = createCafeTablesService(httpClient);
const cafeOrdersService = createCafeOrdersService(httpClient);
const PENDING_ORDER_KEY = 'coffee-connect-pending-kiosk-order';
const TRACKED_ORDER_KEY = 'coffee-connect-tracked-kiosk-order';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type PendingOrder = { tableId: string; key: string; items: CreateOrderLine[] };
type TrackedOrderIntent = { tableId: string; key: string; orderId: string };
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente de confirmación',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  served: 'Entregado',
  cancelled: 'Cancelado',
};

function readPendingOrder(): PendingOrder | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_ORDER_KEY) ?? 'null') as Partial<PendingOrder> | null;
    if (!value) return null;
    const valid = typeof value.tableId === 'string' && UUID_PATTERN.test(value.tableId)
      && typeof value.key === 'string' && UUID_PATTERN.test(value.key)
      && Array.isArray(value.items) && value.items.length >= 1 && value.items.length <= 50
      && value.items.every((line: unknown) => {
        if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
        const item = line as Record<string, unknown>;
        return typeof item.productId === 'string' && UUID_PATTERN.test(item.productId)
          && Number.isInteger(item.quantity) && Number(item.quantity) >= 1 && Number(item.quantity) <= 99
          && (item.notes === undefined || item.notes === null || (typeof item.notes === 'string' && item.notes.length <= 200));
      });
    if (!valid) {
      sessionStorage.removeItem(PENDING_ORDER_KEY);
      return null;
    }
    return value as PendingOrder;
  } catch {
    try { sessionStorage.removeItem(PENDING_ORDER_KEY); } catch { /* Storage puede estar bloqueado. */ }
    return null;
  }
}

function readTrackedOrder(): TrackedOrderIntent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(TRACKED_ORDER_KEY) ?? 'null') as Partial<TrackedOrderIntent> | null;
    if (!value || typeof value.tableId !== 'string' || !UUID_PATTERN.test(value.tableId)
      || typeof value.key !== 'string' || !UUID_PATTERN.test(value.key)
      || typeof value.orderId !== 'string' || !UUID_PATTERN.test(value.orderId)) return null;
    return value as TrackedOrderIntent;
  } catch { return null; }
}

function SplashScreen({ fadeOut, mesaName }: { fadeOut: boolean, mesaName: string }) {
  return (
    <div className={`splash-screen ${fadeOut ? 'splash-fade-out' : ''}`}>
      <div className="splash-content">
        <img src="/turron-logo.jpg" alt="Logo TURRÓN" className="splash-logo" style={{ borderRadius: '50%', border: '3px solid #E0247D', objectFit: 'cover' }} />
        <h1 className="splash-title">TURRÓN Pastelería</h1>
        <p className="splash-subtitle">Bienvenido a {mesaName}</p>
        <div className="splash-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  );
}

function toKioskCategories(categories: PublicCategory[]): Category[] {
  // UUID stays a string at runtime; this casts only to reuse legacy presentational props.
  return categories.map(({ id, name, description }) => ({
    id,
    name,
    description: description ?? undefined,
  })) as unknown as Category[];
}

function toKioskProducts(items: PublicMenuItem[]): Product[] {
  // Do not coerce UUIDs to numbers: the later order migration must consume these IDs as UUIDs.
  return items.map(({ id, categoryId, name, description, price, imageUrl }) => ({
    id,
    category_id: categoryId,
    name,
    description: description ?? undefined,
    price,
    image: imageUrl ?? undefined,
  })) as unknown as Product[];
}

export function Kiosk() {
  const { mesa_id } = useParams();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [mesaName, setMesaName] = useState('');

  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [isInvalidMesa, setIsInvalidMesa] = useState(false);
  const [resolvedMesaId, setResolvedMesaId] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(readPendingOrder);
  const [trackedOrderIntent, setTrackedOrderIntent] = useState<TrackedOrderIntent | null>(readTrackedOrder);
  const [trackedOrder, setTrackedOrder] = useState<KioskOrderTracking | null>(null);
  const [trackingMessage, setTrackingMessage] = useState('');

  // Mobile cart sheet
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Splash Screen State
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splashShown'));
  const [fadeOutSplash, setFadeOutSplash] = useState(false);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true);
      setLoadingError(null);
      const [categoriesData, menuData, mesa] = await Promise.all([
        catalogService.listPublicCategories(signal),
        catalogService.listPublicMenu(signal),
        mesa_id ? cafeTablesService.getPublicTable(mesa_id, signal) : Promise.resolve(null),
      ]);
      setCategories(toKioskCategories(categoriesData));
      setProducts(toKioskProducts(menuData));
      const savedIntent = readPendingOrder();
      if (savedIntent && mesa_id === savedIntent.tableId) {
        const productsById = new Map(toKioskProducts(menuData).map(product => [String(product.id), product]));
        const recoveredCart: CartItem[] = savedIntent.items.flatMap(line => {
          const product = productsById.get(line.productId);
          return product ? [{
            lineId: newLineId(),
            product,
            quantity: line.quantity,
            subtotal: product.price * line.quantity,
            ...(line.notes ? { notes: line.notes } : {}),
          }] : [];
        });
        if (recoveredCart.length === savedIntent.items.length) {
          setPendingOrder(savedIntent);
          setCart(recoveredCart);
        }
      }
      const savedTracking = readTrackedOrder();
      if (savedTracking && mesa_id === savedTracking.tableId) setTrackedOrderIntent(savedTracking);

      if (mesa_id) {
        if (mesa) {
          setMesaName(mesa.name);
          setResolvedMesaId(mesa.id);
          setIsInvalidMesa(false);
        } else {
          setMesaName('Mesa Desconocida');
          setIsInvalidMesa(true);
        }
      } else {
        setIsInvalidMesa(true);
      }
    } catch {
      if (signal?.aborted) return;
      setLoadingError('Error al cargar los datos. Verifica que el servidor esté funcionando.');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [mesa_id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  useEffect(() => {
    if (!trackedOrderIntent || trackedOrderIntent.tableId !== resolvedMesaId) return;
    let stopped = false;
    let inFlight = false;
    let timer = 0;
    const updateTrackedOrder = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const result = await cafeOrdersService.getKioskOrderStatus(trackedOrderIntent.key);
        if (stopped) return;
        if (!result) {
          setTrackingMessage('No encontramos este pedido para seguimiento. Puedes consultar al personal.');
          stopped = true;
          window.clearInterval(timer);
          return;
        }
        setTrackedOrder(result);
        setTrackingMessage('');
        if (result.status === 'served' || result.status === 'cancelled') {
          stopped = true;
          window.clearInterval(timer);
        }
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && cause.code === 'TRACKING_NOT_CONFIGURED') {
          setTrackingMessage('El pedido sí se creó, pero el seguimiento aún requiere habilitar la migración segura en el servidor.');
          stopped = true;
          window.clearInterval(timer);
        } else {
          setTrackingMessage(ordersErrorMessage(cause));
        }
      } finally {
        inFlight = false;
      }
    };
    timer = window.setInterval(() => { void updateTrackedOrder(); }, 10_000);
    void updateTrackedOrder();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [resolvedMesaId, trackedOrderIntent]);

  useEffect(() => {
    if (!showSplash) return;
    const fadeTimer = setTimeout(() => setFadeOutSplash(true), 2000);
    const hideTimer = setTimeout(() => {
      setShowSplash(false);
      sessionStorage.setItem('splashShown', 'true');
    }, 2500);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [showSplash]);

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const categoryMatch = selectedCategory === null || String(product.category_id) === String(selectedCategory);
      const searchMatch = searchTerm === '' ||
        product.name.toLowerCase().includes(searchTerm.toLowerCase());
      return categoryMatch && searchMatch;
    });
  }, [products, selectedCategory, searchTerm]);

  const availableCategories = useMemo(() => {
    const catMap = new Map();
    categories.forEach(cat => {
      if (products.some(p => p.category_id === cat.id)) {
        catMap.set(cat.id, cat);
      }
    });
    return Array.from(catMap.values());
  }, [categories, products]);

  function handleAddToCart(product: Product) {
    const existingItem = cart.find(item => item.product.id === product.id && !item.notes);
    if (existingItem && existingItem.quantity >= 99) {
      setError('La cantidad máxima por línea es 99. Divide el pedido si necesitas más.');
      return;
    }
    setCart(currentCart => {
      // Se suma a la línea del mismo producto que NO tenga comentario. Si esa línea ya tiene un
      // comentario, se crea una línea nueva para no mezclar (ej: un café con azúcar y otro sin).
      const existingItem = currentCart.find(item => item.product.id === product.id && !item.notes);
      if (existingItem) {
        const newQuantity = existingItem.quantity + 1;
        return currentCart.map(item =>
          item.lineId === existingItem.lineId
            ? { ...item, quantity: newQuantity, subtotal: newQuantity * product.price }
            : item
        );
      }
      return [...currentCart, { lineId: newLineId(), product, quantity: 1, subtotal: product.price }];
    });
    setError(null);
  }

  function handleIncreaseQuantity(lineId: string) {
    const line = cart.find(item => item.lineId === lineId);
    if (line?.quantity && line.quantity >= 99) {
      setError('La cantidad máxima por línea es 99. Divide el pedido si necesitas más.');
      return;
    }
    setCart(currentCart =>
      currentCart.map(item =>
        item.lineId === lineId
          ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.product.price }
          : item
      )
    );
    setError(null);
  }

  function handleDecreaseQuantity(lineId: string) {
    setCart(currentCart =>
      currentCart.map(item =>
        item.lineId === lineId && item.quantity > 1
          ? { ...item, quantity: item.quantity - 1, subtotal: (item.quantity - 1) * item.product.price }
          : item
      )
    );
    setError(null);
  }

  function handleRemoveFromCart(lineId: string) {
    setCart(currentCart => currentCart.filter(item => item.lineId !== lineId));
    setError(null);
  }

  // Comentario del cliente sobre un producto (ej: "con 2 cucharadas de azúcar")
  function handleUpdateNotes(lineId: string, notes: string) {
    setCart(currentCart =>
      currentCart.map(item => (item.lineId === lineId ? { ...item, notes } : item))
    );
    setError(null);
  }

  async function handleConfirmOrder(retryAmbiguous = false) {
    if (import.meta.env.DEV) {
      console.info('[Kiosco órdenes] clic en confirmar', {
        cartItems: cart.length,
        mesaIdentificada: Boolean(resolvedMesaId),
        mesaId: resolvedMesaId,
        retryAmbiguous,
        processing: isProcessing,
      });
    }
    if (cart.length === 0) {
      if (import.meta.env.DEV) console.warn('[Kiosco órdenes] envío detenido: carrito vacío');
      return;
    }

    if (!resolvedMesaId) {
      if (import.meta.env.DEV) console.warn('[Kiosco órdenes] envío detenido: no hay UUID de mesa resuelto');
      setError('ID de mesa inválido. Por favor escanea el código QR de nuevo.');
      return;
    }

    const items: CreateOrderLine[] = cart.map(item => ({
      productId: String(item.product.id),
      quantity: item.quantity,
      notes: item.notes?.trim() || null,
    }));
    if (pendingOrder && (pendingOrder.tableId !== resolvedMesaId || JSON.stringify(pendingOrder.items) !== JSON.stringify(items))) {
      if (import.meta.env.DEV) console.warn('[Kiosco órdenes] envío detenido: el carrito no coincide con el envío pendiente');
      setError('Hay un envío anterior cuyo resultado no se confirmó. Restaura exactamente el mismo carrito para reintentar; no cambies la intención hasta resolverlo.');
      return;
    }
    const intent = pendingOrder ?? { tableId: resolvedMesaId, items, key: crypto.randomUUID() };
    if (retryAmbiguous && !pendingOrder) {
      if (import.meta.env.DEV) console.warn('[Kiosco órdenes] reintento detenido: no existe envío pendiente');
      return;
    }
    if (import.meta.env.DEV) {
      console.info('[Kiosco órdenes] intención de envío', {
        endpoint: '/rest/v1/rpc/create_public_order',
        method: 'POST',
        body: {
          p_table_id: intent.tableId,
          p_items: items.map(item => ({
            product_id: item.productId,
            quantity: item.quantity,
            notes: item.notes,
          })),
          p_idempotency_key: '[oculta]',
        },
      });
    }
    if (!pendingOrder) {
      try { sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(intent)); } catch { /* Se conserva en memoria mientras esta vista exista. */ }
      setPendingOrder(intent);
    }
    setIsProcessing(true);
    setError(null);

    try {
      const orderId = await cafeOrdersService.createOrder(intent.tableId, intent.items, intent.key);
      const trackedIntent = { tableId: intent.tableId, key: intent.key, orderId };
      try { sessionStorage.setItem(TRACKED_ORDER_KEY, JSON.stringify(trackedIntent)); } catch { /* Seguimiento en memoria mientras viva esta vista. */ }
      setTrackedOrderIntent(trackedIntent);
      setTrackedOrder({
        orderId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        items: cart.map(item => ({ productName: item.product.name, quantity: item.quantity })),
      });
      setTrackingMessage('');
      try { sessionStorage.removeItem(PENDING_ORDER_KEY); } catch { /* La RPC ya confirmó la creación. */ }
      setPendingOrder(null);
      setOrderSuccess(true);
      setCart([]);
      setMobileCartOpen(false);
      setTimeout(() => setOrderSuccess(false), 7000);
    } catch (e) {
      const ambiguous = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      if (!ambiguous) {
        try { sessionStorage.removeItem(PENDING_ORDER_KEY); } catch { /* La clave ya no es reintentable. */ }
        setPendingOrder(null);
      }
      setError(ambiguous
        ? 'No pudimos confirmar el resultado del envío. Conservamos el pedido y su clave; reintenta explícitamente sin modificar el carrito.'
        : ordersErrorMessage(e));
      if (e instanceof ApiError && ['PRODUCT_UNAVAILABLE', 'PRODUCT_RECIPE_HAS_INACTIVE_INGREDIENT', 'INSUFFICIENT_PRODUCT_STOCK', 'INSUFFICIENT_INGREDIENT_STOCK'].includes(e.code ?? '')) {
        catalogService.listPublicMenu().then(menu => setProducts(toKioskProducts(menu))).catch(() => {});
      }
    } finally {
      setIsProcessing(false);
    }
  }

  function clearTrackedOrder() {
    try { sessionStorage.removeItem(TRACKED_ORDER_KEY); } catch { /* Se limpia el estado de la vista aunque storage esté bloqueado. */ }
    setTrackedOrderIntent(null);
    setTrackedOrder(null);
    setTrackingMessage('');
  }

  // Cart totals for the floating button
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const pricing = calculateCartPricing(cart, []);
  const cartTotal = pricing.total;

  if (isLoading) {
    return (
      <div className="kiosk-loading">
        <div className="loading-spinner"></div>
        <p className="loading-message">Cargando menú...</p>
      </div>
    );
  }

  if (loadingError) {
    return (
      <div className="kiosk-error">
        <div className="error-icon" style={{ display: 'flex', justifyContent: 'center' }}><AlertTriangle size={48} color="#E0247D" /></div>
        <p className="error-message">{loadingError}</p>
        <button className="retry-btn" onClick={() => loadData()}>Reintentar</button>
      </div>
    );
  }

  if (isInvalidMesa) {
    return (
      <div className="kiosk-error" style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', padding: '1.5rem' }}>
        <div className="error-icon" style={{ marginBottom: '1rem' }}><XCircle size={64} color="#D32F2F" /></div>
        <h2 style={{ color: '#D32F2F', marginBottom: '1rem' }}>Mesa no válida</h2>
        <p className="error-message" style={{ textAlign: 'center', maxWidth: '400px', lineHeight: '1.5', color: '#666' }}>
          El código QR es inválido o la mesa no está registrada en el sistema.
          Por favor, escanea nuevamente el código correcto de tu mesa.
        </p>
      </div>
    );
  }

  if (showSplash) {
    return <SplashScreen fadeOut={fadeOutSplash} mesaName={mesaName} />;
  }

  return (
    <KioskLayout
      categories={availableCategories}
      selectedCategory={selectedCategory}
      onSelectCategory={setSelectedCategory}
    >
      {orderSuccess && (
        <div className="order-success-notification">
          <div className="success-icon" style={{ display: 'flex', justifyContent: 'center' }}><CheckCircle size={32} color="#fff" /></div>
          <p className="success-message">Pedido recibido y pendiente de confirmación por el personal.</p>
        </div>
      )}
      <main className="kiosk-main">
        {pendingOrder && <div role="status" className="order-error-notification">Hay un envío pendiente de recuperación. Reintenta solo con el mismo carrito y la misma clave.</div>}
        {trackedOrderIntent?.tableId === resolvedMesaId && <section className="kiosk-order-tracking" aria-live="polite" aria-labelledby="kiosk-order-tracking-title">
          <div className="kiosk-order-tracking-header">
            <div>
              <h2 id="kiosk-order-tracking-title">Tu pedido</h2>
              <p>Pedido · {trackedOrder?.orderId.slice(0, 8) ?? trackedOrderIntent.orderId.slice(0, 8)}</p>
            </div>
            {trackedOrder && <strong className={`kiosk-order-status kiosk-order-status-${trackedOrder.status}`}>
              {ORDER_STATUS_LABELS[trackedOrder.status]}
            </strong>}
          </div>
          {trackedOrder && <ul>
            {trackedOrder.items.map((item, index) => <li key={`${item.productName}-${index}`}>
              <span>{item.productName}</span><span>×{item.quantity}</span>
            </li>)}
          </ul>}
          {!trackedOrder && !trackingMessage && <p role="status">Consultando el estado del pedido…</p>}
          {trackingMessage && <p role="status" className="kiosk-order-tracking-message">{trackingMessage}</p>}
          {trackedOrder && (trackedOrder.status === 'served' || trackedOrder.status === 'cancelled')
            && <button type="button" onClick={clearTrackedOrder}>Ocultar pedido</button>}
        </section>}
        <PromoBanner promotions={[]} />
        <SearchBar searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        <ProductGrid products={filteredProducts} onAddToCart={handleAddToCart} promotions={[]} />
      </main>

      {/* Desktop cart — always visible in sidebar */}
      <aside className="kiosk-cart">
        <Cart
          cart={cart}
          pricing={pricing}
          mesaName={mesaName}
          onIncreaseQuantity={handleIncreaseQuantity}
          onDecreaseQuantity={handleDecreaseQuantity}
          onRemoveFromCart={handleRemoveFromCart}
          onUpdateNotes={handleUpdateNotes}
          onConfirmOrder={handleConfirmOrder}
          errorMessage={error}
          isProcessing={isProcessing}
          onRetryAmbiguous={pendingOrder ? () => handleConfirmOrder(true) : undefined}
        />
      </aside>

      {/* Mobile floating cart button */}
      {cartItemCount > 0 && (
        <button
          className="mobile-cart-fab"
          onClick={() => setMobileCartOpen(true)}
        >
          <ShoppingCart size={22} />
          <span className="mobile-cart-fab-text">
            Ver carrito · ${cartTotal.toFixed(2)}
          </span>
          <span className="mobile-cart-fab-badge">{cartItemCount}</span>
        </button>
      )}

      {/* Mobile cart bottom sheet */}
      {mobileCartOpen && (
        <div className="mobile-cart-overlay" onClick={() => setMobileCartOpen(false)}>
          <div className="mobile-cart-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-cart-sheet-header">
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                <ShoppingCart size={20} /> Tu Pedido
              </h3>
              <button
                className="mobile-cart-close"
                onClick={() => setMobileCartOpen(false)}
              >
                <X size={22} />
              </button>
            </div>
            <div className="mobile-cart-sheet-body">
              <Cart
                cart={cart}
                pricing={pricing}
                mesaName={mesaName}
                onIncreaseQuantity={handleIncreaseQuantity}
                onDecreaseQuantity={handleDecreaseQuantity}
                onRemoveFromCart={handleRemoveFromCart}
                onUpdateNotes={handleUpdateNotes}
                onConfirmOrder={handleConfirmOrder}
                errorMessage={error}
                isProcessing={isProcessing}
                onRetryAmbiguous={pendingOrder ? () => handleConfirmOrder(true) : undefined}
              />
            </div>
          </div>
        </div>
      )}
    </KioskLayout>
  );
}
