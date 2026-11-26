import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, XCircle, CheckCircle, ShoppingCart, X } from 'lucide-react';
import type { Product } from '../../types/Product';
import type { Category } from '../../types/Category';
import type { CartItem } from '../../types/Order';
import type { Promotion } from '../../types/Promotion';
import { KioskLayout } from '../../components/layout/KioskoLayout';
import { ProductGrid } from '../../components/ProductGrid';
import { SearchBar } from '../../components/SearchBar';
import { Cart } from '../../components/Cart';
import { PromoBanner } from '../../components/PromoBanner';
import { createOrder, fetchMesaPublic, fetchActivePromotions } from '../../services/api';
import { catalogService, type PublicCategory, type PublicMenuItem } from '../../services/catalog';
import { calculateCartPricing, newLineId } from '../../utils/promotions';

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
  const [promotions, setPromotions] = useState<Promotion[]>([]);

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

  // Mobile cart sheet
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Splash Screen State
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splashShown'));
  const [fadeOutSplash, setFadeOutSplash] = useState(false);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true);
      setLoadingError(null);
      const [categoriesData, menuData, mesa, promotionsData] = await Promise.all([
        catalogService.listPublicCategories(signal),
        catalogService.listPublicMenu(signal),
        mesa_id ? fetchMesaPublic(mesa_id) : Promise.resolve(null),
        // Si falla, el menú funciona igual, solo sin ofertas
        fetchActivePromotions().catch(() => [] as Promotion[]),
      ]);
      setCategories(toKioskCategories(categoriesData));
      setProducts(toKioskProducts(menuData));
      setPromotions(promotionsData);

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
      const categoryMatch = selectedCategory === null || product.category_id === selectedCategory;
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
    setCart(currentCart =>
      currentCart.map(item =>
        item.lineId === lineId
          ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.product.price }
          : item
      )
    );
  }

  function handleDecreaseQuantity(lineId: string) {
    setCart(currentCart =>
      currentCart.map(item =>
        item.lineId === lineId && item.quantity > 1
          ? { ...item, quantity: item.quantity - 1, subtotal: (item.quantity - 1) * item.product.price }
          : item
      )
    );
  }

  function handleRemoveFromCart(lineId: string) {
    setCart(currentCart => currentCart.filter(item => item.lineId !== lineId));
  }

  // Comentario del cliente sobre un producto (ej: "con 2 cucharadas de azúcar")
  function handleUpdateNotes(lineId: string, notes: string) {
    setCart(currentCart =>
      currentCart.map(item => (item.lineId === lineId ? { ...item, notes } : item))
    );
  }

  async function handleConfirmOrder() {
    if (cart.length === 0) return;

    if (!resolvedMesaId) {
      setError('ID de mesa inválido. Por favor escanea el código QR de nuevo.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // El servidor calcula precios y promociones; aquí solo se envía qué y cuántos (+ comentario)
      const order = {
        mesa_id: resolvedMesaId,
        items: cart.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          notes: item.notes?.trim() || undefined,
        })),
      };

      const result = await createOrder(order);
      setOrderSuccess(true);
      setCart([]);
      setMobileCartOpen(false);

      // El cliente permanece en el menú; el personal ve y gestiona el pedido desde su panel.
      void result;
      setTimeout(() => setOrderSuccess(false), 5000);
    } catch (e) {
      // Si falta inventario el servidor lo explica (ej: "No hay suficiente inventario: Leche para ...")
      const message = e instanceof Error ? e.message : '';
      setError(message.startsWith('No hay suficiente inventario')
        ? `${message}. Ajusta tu pedido e intenta de nuevo.`
        : 'Error al crear el pedido. Por favor intenta de nuevo.');
      // Puede que algo se haya agotado: se refresca lo disponible en el menú
      catalogService.listPublicMenu()
        .then(menu => setProducts(toKioskProducts(menu)))
        .catch(() => { /* se mantiene el menú actual */ });
    } finally {
      setIsProcessing(false);
    }
  }

  // Cart totals for the floating button
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const pricing = calculateCartPricing(cart, promotions);
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
          <p className="success-message">¡Pedido enviado! Un mesero lo atenderá en tu mesa.</p>
        </div>
      )}
      {error && (
        <div className="order-error-notification">
          <div className="error-icon" style={{ display: 'flex', justifyContent: 'center' }}><AlertTriangle size={24} color="#fff" /></div>
          <p className="error-message">{error}</p>
        </div>
      )}

      <main className="kiosk-main">
        <PromoBanner promotions={promotions} />
        <SearchBar searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        <ProductGrid products={filteredProducts} onAddToCart={handleAddToCart} promotions={promotions} />
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
          isProcessing={isProcessing}
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
                isProcessing={isProcessing}
              />
            </div>
          </div>
        </div>
      )}
    </KioskLayout>
  );
}
