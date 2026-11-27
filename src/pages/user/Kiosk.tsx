import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, XCircle, CheckCircle, ShoppingCart, X, CircleHelp, RefreshCw, Receipt } from 'lucide-react';
import { Dialog } from 'primereact/dialog';
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
import type { CreateOrderLine, KioskTableAccount, OrderStatus } from '../../features/orders/model';
import { ApiError } from '../../services/http/client';

const cafeTablesService = createCafeTablesService(httpClient);
const cafeOrdersService = createCafeOrdersService(httpClient);
const PENDING_ORDER_KEY = 'coffee-connect-pending-kiosk-order';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type PendingOrder = { tableId: string; key: string; items: CreateOrderLine[] };
const CURRENCY_FORMATTER = new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' });
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-SV', { dateStyle: 'medium', timeStyle: 'short' });
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Recibido · pendiente de confirmación',
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isInvalidMesa, setIsInvalidMesa] = useState(false);
  const [resolvedMesaId, setResolvedMesaId] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(readPendingOrder);
  const [tableAccount, setTableAccount] = useState<KioskTableAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountRefreshKey, setAccountRefreshKey] = useState(0);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);

  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const mobileCartButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCartCloseRef = useRef<HTMLButtonElement>(null);
  const mobileCartDialogRef = useRef<HTMLDivElement>(null);
  const kioskMainRef = useRef<HTMLElement>(null);

  const loadData = useCallback(async (signal?: AbortSignal, background = false) => {
    try {
      if (!background) setIsLoading(true);
      if (!background) setLoadingError(null);
      setRefreshError(null);
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
      if (background) setRefreshError('No pudimos actualizar el menú. Conservamos lo que ya estaba cargado; puedes reintentar.');
      else setLoadingError('No pudimos cargar el menú. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      if (!signal?.aborted && !background) setIsLoading(false);
    }
  }, [mesa_id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  useEffect(() => {
    if (!resolvedMesaId) return;
    let stopped = false;
    let inFlight = false;
    let timer = 0;
    const controller = new AbortController();
    setAccountLoading(true);
    setAccountError(null);
    const updateTableAccount = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const result = await cafeOrdersService.getPublicKioskTableAccount(resolvedMesaId, controller.signal);
        if (stopped) return;
        setTableAccount(result);
        setAccountError(null);
      } catch (cause) {
        if (stopped) return;
        setAccountError(ordersErrorMessage(cause));
        if (cause instanceof ApiError && cause.code === 'TABLE_ACCOUNT_NOT_CONFIGURED') window.clearInterval(timer);
      } finally {
        inFlight = false;
        if (!stopped) setAccountLoading(false);
      }
    };
    timer = window.setInterval(() => { void updateTableAccount(); }, 10_000);
    void updateTableAccount();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      controller.abort();
    };
  }, [accountRefreshKey, resolvedMesaId]);

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const categoryMatch = selectedCategory === null || String(product.category_id) === String(selectedCategory);
      const searchMatch = searchTerm === '' ||
        product.name.toLowerCase().includes(searchTerm.toLowerCase());
      return categoryMatch && searchMatch;
    });
  }, [products, selectedCategory, searchTerm]);

  const availableCategories = useMemo(() => {
    return categories;
  }, [categories]);
  const selectedCategoryName = selectedCategory === null
    ? 'Todo el menú'
    : availableCategories.find(category => String(category.id) === String(selectedCategory))?.name ?? 'Todo el menú';
  const tableAccountForCurrentTable = tableAccount?.tableId === resolvedMesaId ? tableAccount : null;
  const billableOrders = tableAccountForCurrentTable?.orders.filter(order => order.status !== 'cancelled') ?? [];
  const servedOrders = billableOrders.filter(order => order.status === 'served');
  const tableAccountSubtotal = billableOrders.reduce((sum, order) => sum + order.subtotal, 0);
  const tableAccountDiscount = billableOrders.reduce((sum, order) => sum + order.discountTotal, 0);
  const tableAccountDeliveredTotal = servedOrders.reduce((sum, order) => sum + order.total, 0);
  const tableAccountTotal = billableOrders.reduce((sum, order) => sum + order.total, 0);
  const refreshMenu = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadData(undefined, true);
      setAccountRefreshKey(current => current + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadData]);

  useEffect(() => {
    if (!mobileCartOpen) return;
    const triggerElement = mobileCartButtonRef.current;
    const fallbackFocusElement = kioskMainRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mobileCartCloseRef.current?.focus();

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileCartOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !mobileCartDialogRef.current) return;
      const elements = mobileCartDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      );
      const first = elements.item(0);
      const last = elements.item(elements.length - 1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleDialogKeyDown);
      if (triggerElement?.isConnected) triggerElement.focus();
      else fallbackFocusElement?.focus();
    };
  }, [mobileCartOpen]);

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
      await cafeOrdersService.createOrder(intent.tableId, intent.items, intent.key);
      setAccountRefreshKey(current => current + 1);
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

  // Cart totals for the floating button
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const pricing = calculateCartPricing(cart, []);
  const cartTotal = pricing.total;

  if (isLoading) {
    return (
      <div className="kiosk-loading kiosk-screen-state">
        <div className="loading-spinner"></div>
        <p className="loading-message">Preparando el menú para ti…</p>
      </div>
    );
  }

  if (loadingError) {
    return (
      <div className="kiosk-error kiosk-screen-state">
        <div className="error-icon"><AlertTriangle size={42} aria-hidden="true" /></div>
        <p className="error-message">{loadingError}</p>
        <button type="button" className="retry-btn" onClick={() => void loadData()}>Reintentar</button>
      </div>
    );
  }

  if (isInvalidMesa) {
    return (
      <div className="kiosk-error kiosk-screen-state">
        <div className="error-icon"><XCircle size={52} aria-hidden="true" /></div>
        <h2>Mesa no válida</h2>
        <p className="error-message">
          El código QR es inválido o la mesa no está registrada en el sistema.
          Por favor, escanea nuevamente el código correcto de tu mesa.
        </p>
      </div>
    );
  }

  return (
    <KioskLayout
      categories={availableCategories}
      selectedCategory={selectedCategory}
      onSelectCategory={setSelectedCategory}
      mesaName={mesaName}
      onRefresh={() => void refreshMenu()}
      isRefreshing={isRefreshing}
      >
        {refreshError && <div className="kiosk-refresh-error" role="alert">{refreshError}</div>}
        {orderSuccess && (
        <div className="order-success-notification" role="status" aria-live="polite">
          <div className="success-icon"><CheckCircle size={32} aria-hidden="true" /></div>
          <p className="success-message">Pedido recibido y pendiente de confirmación por el personal.</p>
        </div>
      )}
      <main ref={kioskMainRef} className="kiosk-main" tabIndex={-1}>
        {pendingOrder && <div role="status" className="order-error-notification">Hay un envío pendiente de recuperación. Reintenta solo con el mismo carrito y la misma clave.</div>}
        <Dialog
          visible={accountDialogOpen}
          header={`Ver mi cuenta · ${mesaName}`}
          modal
          dismissableMask
          draggable={false}
          className="kiosk-account-dialog"
          headerClassName="kiosk-account-dialog-header"
          contentClassName="kiosk-account-dialog-content"
          onHide={() => setAccountDialogOpen(false)}
        >
          <section className="kiosk-session-account" aria-label="Detalle de la cuenta">
            <div className="kiosk-session-account-header">
              {tableAccountForCurrentTable && <p className="kiosk-session-account-meta">
                <time dateTime={tableAccountForCurrentTable.openedAt}>
                  {DATE_TIME_FORMATTER.format(new Date(tableAccountForCurrentTable.openedAt))}
                </time>
              </p>}
              <button
                type="button"
                className="kiosk-account-refresh"
                onClick={() => setAccountRefreshKey(current => current + 1)}
                disabled={accountLoading}
                aria-label={accountLoading ? 'Actualizando cuenta' : 'Actualizar cuenta'}
              >
                <RefreshCw size={18} aria-hidden="true" />
              </button>
            </div>
            {accountError && <p className="kiosk-session-account-error" role="alert">
              {accountError}{tableAccountForCurrentTable ? ' Mostramos los últimos datos cargados; intenta actualizar de nuevo.' : ''}
            </p>}
            {accountLoading && !tableAccountForCurrentTable && <p role="status">Cargando la cuenta de esta mesa…</p>}
            {!accountLoading && !accountError && !tableAccountForCurrentTable && <p className="kiosk-session-account-empty">
              Esta mesa no tiene una sesión abierta en este momento.
            </p>}
            {tableAccountForCurrentTable && <>
              {tableAccountForCurrentTable.orders.length > 0 ? <ul className="kiosk-session-orders" aria-label="Pedidos de la sesión">
                {tableAccountForCurrentTable.orders.map(order => (
                  <li key={order.id} className={`kiosk-session-order ${order.status === 'cancelled' ? 'is-cancelled' : ''}`}>
                    <div className="kiosk-session-order-header">
                      <div>
                        <strong>Pedido · {order.id.slice(0, 8)}</strong>
                        <time dateTime={order.createdAt}>{DATE_TIME_FORMATTER.format(new Date(order.createdAt))}</time>
                      </div>
                      <span className={`kiosk-order-status kiosk-order-status-${order.status}`}>{ORDER_STATUS_LABELS[order.status]}</span>
                    </div>
                    <ul>
                      {order.items.map(item => (
                        <li key={item.id}>
                          <div className="kiosk-session-item-row">
                            <span>
                              {item.productName} ×{item.quantity}
                              {item.promotionName ? ` · ${item.promotionName}` : ''}
                            </span>
                            <span>{CURRENCY_FORMATTER.format(item.subtotal)}</span>
                          </div>
                          {item.notes?.trim() && <p className="kiosk-session-item-note">
                            <strong>Comentario:</strong> {item.notes.trim()}
                          </p>}
                        </li>
                      ))}
                    </ul>
                    <div className="kiosk-session-order-total">
                      <span>
                        {order.status === 'cancelled'
                          ? 'Total cancelado'
                          : order.status === 'served'
                            ? 'Total entregado'
                            : 'Total del pedido'}
                      </span>
                      <strong>{CURRENCY_FORMATTER.format(order.total)}</strong>
                    </div>
                  </li>
                ))}
              </ul> : <p className="kiosk-session-account-empty">Todavía no hay pedidos en esta sesión.</p>}
              <div className="kiosk-session-summary" aria-label="Totales de la sesión">
                <div><span>Subtotal</span><span>{CURRENCY_FORMATTER.format(tableAccountSubtotal)}</span></div>
                <div><span>Descuentos</span><span>−{CURRENCY_FORMATTER.format(tableAccountDiscount)}</span></div>
                <div className="kiosk-session-delivered-total">
                  <span>Total entregado</span>
                  <strong>{CURRENCY_FORMATTER.format(tableAccountDeliveredTotal)}</strong>
                </div>
                <div className="kiosk-session-account-total">
                  <span>Total general</span>
                  <strong>{CURRENCY_FORMATTER.format(tableAccountTotal)}</strong>
                </div>
              </div>
              <p className="kiosk-session-account-meta">
                El total entregado suma solo pedidos entregados. El total general excluye pedidos cancelados, no descuenta pagos y no representa un saldo pendiente.
              </p>
            </>}
          </section>
        </Dialog>
        <section className="kiosk-menu-heading" aria-labelledby="kiosk-menu-title">
          <div>
            <p className="kiosk-eyebrow">Recién hecho para ti</p>
            <h2 id="kiosk-menu-title">{selectedCategoryName}</h2>
          </div>
          <span className="kiosk-result-count" aria-live="polite">
            {filteredProducts.length} {filteredProducts.length === 1 ? 'opción' : 'opciones'}
          </span>
        </section>
        <PromoBanner promotions={[]} />
        <SearchBar searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        <ProductGrid products={filteredProducts} onAddToCart={handleAddToCart} promotions={[]} />
        <footer className="kiosk-help" id="kiosk-help">
          <CircleHelp size={17} aria-hidden="true" />
          <p>¿Necesitas ayuda? Nuestro equipo estará encantado de atenderte en tu mesa.</p>
        </footer>
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

      <div className="kiosk-floating-actions" role="group" aria-label="Accesos rápidos">
        <button
          type="button"
          className="kiosk-account-open"
          onClick={() => setAccountDialogOpen(true)}
          aria-label="Ver mi cuenta"
          aria-haspopup="dialog"
          aria-expanded={accountDialogOpen}
        >
          <Receipt size={22} aria-hidden="true" />
          {tableAccountForCurrentTable && tableAccountForCurrentTable.orders.length > 0 && (
            <span className="kiosk-account-open-summary" aria-hidden="true">
              {tableAccountForCurrentTable.orders.length}
            </span>
          )}
        </button>
        {cartItemCount > 0 && (
          <button
            ref={mobileCartButtonRef}
            type="button"
            className="mobile-cart-fab"
            onClick={() => setMobileCartOpen(true)}
            aria-haspopup="dialog"
            aria-label={`Ver carrito, ${cartItemCount} artículos, total estimado $${cartTotal.toFixed(2)}`}
          >
            <ShoppingCart size={22} aria-hidden="true" />
            <span className="mobile-cart-fab-text">
              Ver carrito · ${cartTotal.toFixed(2)}
            </span>
            <span className="mobile-cart-fab-badge">{cartItemCount}</span>
          </button>
        )}
      </div>

      {/* Mobile cart bottom sheet */}
      {mobileCartOpen && (
        <div className="mobile-cart-overlay" onMouseDown={() => setMobileCartOpen(false)}>
          <div
            ref={mobileCartDialogRef}
            className="mobile-cart-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-cart-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mobile-cart-sheet-header">
              <h3 id="mobile-cart-title" className="mobile-cart-sheet-title">
                <ShoppingCart size={20} /> Tu Pedido
              </h3>
              <button
                ref={mobileCartCloseRef}
                type="button"
                className="mobile-cart-close"
                aria-label="Cerrar carrito"
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
