import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { InputTextarea } from 'primereact/inputtextarea';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { Dropdown } from 'primereact/dropdown';
import Swal from 'sweetalert2';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, httpClient } from '../../services/http/client';
import { createCafeOrdersService, ordersErrorMessage } from './ordersService';
import { createCafeTablesService, cafeTablesErrorMessage } from '../../services/cafeTables';
import type { CafeOrder, CafeOrderItem, OrderStatus } from './model';

const PAGE_SIZE = 200;
const AUTO_REFRESH_INTERVAL = 10_000;
const labels: Record<OrderStatus, string> = {
  pending: 'Pendiente', confirmed: 'Confirmada', preparing: 'Preparando',
  ready: 'Lista', served: 'Entregada', cancelled: 'Cancelada',
};
function money(value: number): string {
  return new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' }).format(value);
}
function brandColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim();
}

export function OrdersAdmin() {
  const { session, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const token = useRef(session?.accessToken);
  token.current = session?.accessToken;
  const service = useMemo(() => createCafeOrdersService(httpClient, () => token.current, async () => {
    const renewed = await refreshSession().catch(() => null);
    token.current = renewed?.accessToken;
    return renewed?.accessToken ?? null;
  }), [refreshSession]);
  const tablesService = useMemo(() => createCafeTablesService(httpClient, () => token.current, async () => {
    const renewed = await refreshSession().catch(() => null);
    token.current = renewed?.accessToken;
    return renewed?.accessToken ?? null;
  }), [refreshSession]);
  const [orders, setOrders] = useState<CafeOrder[]>([]);
  const [commandItems, setCommandItems] = useState<CafeOrderItem[]>([]);
  const [items, setItems] = useState<CafeOrderItem[]>([]);
  const [tableNames, setTableNames] = useState<Record<string, string>>({});
  const [tableError, setTableError] = useState('');
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all'>('all');
  const [activeOffset, setActiveOffset] = useState(0);
  const [terminalOffset, setTerminalOffset] = useState(0);
  const [filteredOffset, setFilteredOffset] = useState(0);
  const [activeHasMore, setActiveHasMore] = useState(false);
  const [terminalHasMore, setTerminalHasMore] = useState(false);
  const [filteredHasMore, setFilteredHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const requestInFlight = useRef(false);
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CafeOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CafeOrder | null>(null);
  const [reason, setReason] = useState('');
  const actionInFlight = useRef(false);

  const load = useCallback(async (status: OrderStatus | 'all' = filterStatus) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      if (status === 'all') {
        const activePage = await service.listOrders({ statusGroup: 'active' });
        const terminalPage = activePage.length < PAGE_SIZE
          ? await service.listOrders({ statusGroup: 'terminal' })
          : [];
        const [activeItems, terminalItems] = await Promise.all([
          activePage.length ? service.listOrderItems(activePage.map(order => order.id)) : Promise.resolve([]),
          terminalPage.length ? service.listOrderItems(terminalPage.map(order => order.id)) : Promise.resolve([]),
        ]);
        setOrders([...activePage, ...terminalPage]);
        setCommandItems([...activeItems, ...terminalItems]);
        setActiveOffset(activePage.length);
        setTerminalOffset(terminalPage.length);
        setActiveHasMore(activePage.length === PAGE_SIZE);
        setTerminalHasMore(terminalPage.length === PAGE_SIZE);
        setFilteredOffset(0);
        setFilteredHasMore(false);
      } else {
        const page = await service.listOrders({ status, offset: 0 });
        const pageItems = page.length ? await service.listOrderItems(page.map(order => order.id)) : [];
        setOrders(page);
        setCommandItems(pageItems);
        setFilteredOffset(page.length);
        setFilteredHasMore(page.length === PAGE_SIZE);
        setActiveOffset(0);
        setTerminalOffset(0);
        setActiveHasMore(false);
        setTerminalHasMore(false);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(ordersErrorMessage(cause));
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [filterStatus, navigate, service, signOut]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !loading && !busy) void load();
    }, AUTO_REFRESH_INTERVAL);
    return () => window.clearInterval(intervalId);
  }, [busy, load, loading]);

  const hasMore = filterStatus === 'all'
    ? activeHasMore || terminalHasMore
    : filteredHasMore;

  async function loadMore() {
    if (requestInFlight.current || loading || busy || !hasMore) return;
    requestInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      if (filterStatus === 'all' && activeHasMore) {
        const page = await service.listOrders({ statusGroup: 'active', offset: activeOffset });
        const pageItems = page.length ? await service.listOrderItems(page.map(order => order.id)) : [];
        setOrders(current => [...current, ...page]);
        setCommandItems(current => [...current, ...pageItems]);
        setActiveOffset(current => current + page.length);
        const moreActive = page.length === PAGE_SIZE;
        setActiveHasMore(moreActive);
        if (!moreActive) {
          setTerminalHasMore(true);
          const terminalPage = await service.listOrders({ statusGroup: 'terminal' });
          const terminalItems = terminalPage.length ? await service.listOrderItems(terminalPage.map(order => order.id)) : [];
          setOrders(current => [...current, ...terminalPage]);
          setCommandItems(current => [...current, ...terminalItems]);
          setTerminalOffset(terminalPage.length);
          setTerminalHasMore(terminalPage.length === PAGE_SIZE);
        }
      } else if (filterStatus === 'all') {
        const page = await service.listOrders({ statusGroup: 'terminal', offset: terminalOffset });
        const pageItems = page.length ? await service.listOrderItems(page.map(order => order.id)) : [];
        setOrders(current => [...current, ...page]);
        setCommandItems(current => [...current, ...pageItems]);
        setTerminalOffset(current => current + page.length);
        setTerminalHasMore(page.length === PAGE_SIZE);
      } else {
        const page = await service.listOrders({ status: filterStatus, offset: filteredOffset });
        const pageItems = page.length ? await service.listOrderItems(page.map(order => order.id)) : [];
        setOrders(current => [...current, ...page]);
        setCommandItems(current => [...current, ...pageItems]);
        setFilteredOffset(current => current + page.length);
        setFilteredHasMore(page.length === PAGE_SIZE);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(ordersErrorMessage(cause));
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    tablesService.listTables().then(tables => {
      if (!active) return;
      setTableNames(Object.fromEntries(tables.map(table => [table.id, table.name])));
      setTableError('');
    }).catch(async cause => {
      if (!active) return;
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setTableError(cafeTablesErrorMessage(cause));
    });
    return () => { active = false; };
  }, [navigate, signOut, tablesService]);

  async function openDetail(order: CafeOrder) {
    setSelected(order);
    setItems([]);
    setDetailLoading(true);
    setError('');
    try {
      setItems(await service.listOrderItems([order.id]));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(ordersErrorMessage(cause));
    } finally { setDetailLoading(false); }
  }

  async function runAction(
    order: CafeOrder,
    action: () => Promise<OrderStatus>,
    success: string,
  ): Promise<boolean> {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    const refreshSelected = selected?.id === order.id;
    setActionOrderId(order.id);
    setBusy(true);
    setError('');
    try {
      const updatedStatus = await action();
      setOrders(current => current.flatMap(currentOrder => {
        if (currentOrder.id !== order.id) return [currentOrder];
        if (filterStatus !== 'all' && filterStatus !== updatedStatus) return [];
        return [{ ...currentOrder, status: updatedStatus }];
      }));
      let detailRefreshFailed = false;
      if (refreshSelected) {
        try {
          const refreshed = await service.getOrder(order.id);
          setSelected(refreshed);
          setItems(refreshed.items);
        } catch {
          detailRefreshFailed = true;
        }
      }
      await Swal.fire({
        toast: true,
        position: 'top-end',
        icon: detailRefreshFailed ? 'warning' : 'success',
        title: detailRefreshFailed ? 'Pedido actualizado' : 'Estado actualizado',
        text: detailRefreshFailed
          ? `${success} La operación se guardó, pero no se pudo actualizar el detalle.`
          : success,
        showConfirmButton: false,
        timer: detailRefreshFailed ? 5000 : 1800,
        timerProgressBar: true,
      });
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo actualizar el pedido',
        text: ordersErrorMessage(cause),
        confirmButtonColor: brandColor(),
      });
      return false;
    } finally {
      setBusy(false);
      setActionOrderId(null);
      actionInFlight.current = false;
    }
  }

  const nextAction: Partial<Record<OrderStatus, { status: 'preparing' | 'ready' | 'served'; label: string }>> = {
    confirmed: { status: 'preparing', label: 'Iniciar preparación' },
    preparing: { status: 'ready', label: 'Marcar lista' },
    ready: { status: 'served', label: 'Marcar entregada' },
  };
  const commandItemsByOrder = useMemo(() => {
    const grouped = new Map<string, CafeOrderItem[]>();
    for (const item of commandItems) {
      const current = grouped.get(item.orderId) ?? [];
      current.push(item);
      grouped.set(item.orderId, current);
    }
    return grouped;
  }, [commandItems]);
  const sortedOrders = useMemo(() => [...orders].sort((left, right) => {
    const rank = (status: OrderStatus) => status === 'cancelled' ? 2 : status === 'served' ? 1 : 0;
    const rankDifference = rank(left.status) - rank(right.status);
    if (rankDifference !== 0) return rankDifference;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
  }), [orders]);
  const itemRows = useMemo(() => items.filter(item => item.orderId === selected?.id), [items, selected]);

  return <section className="admin-module orders-admin" aria-label="Pedidos">
    <div className="orders-admin__header">
      <p className="mt-0 mb-0">Seguimiento de pedidos · los más antiguos aparecen primero.</p>
      <div className="orders-admin__controls">
        <label className="orders-admin__filter-label" htmlFor="orders-status-filter">Estado</label>
        <Dropdown inputId="orders-status-filter" value={filterStatus}
          aria-label="Filtrar comandas por estado"
          options={[
            { label: 'Todos', value: 'all' },
            ...Object.entries(labels).map(([value, label]) => ({ label, value })),
          ]}
          onChange={event => {
            const nextStatus = event.value as OrderStatus | 'all';
            setFilterStatus(nextStatus);
          }}
          optionLabel="label" optionValue="value" className="orders-admin__filter" disabled={loading || busy} />
        <Button icon="pi pi-refresh" aria-label="Actualizar comandas" tooltip="Actualizar comandas"
          severity="secondary" outlined onClick={() => void load()} disabled={loading || busy}
          loading={loading} className="orders-admin__refresh" />
      </div>
    </div>
    {error && <Message severity="error" text={error} />}
    {tableError && <Message severity="warn" text={`No se pudieron cargar los nombres de mesa. Se muestran identificadores. ${tableError}`} />}
    {loading && orders.length === 0
      ? <div className="order-command-state" role="status"><i className="pi pi-spin pi-spinner" aria-hidden="true" /> Cargando comandas…</div>
      : sortedOrders.length === 0
        ? <div className="order-command-state">{error ? 'No se pudieron cargar las comandas.' : 'No hay comandas para este estado.'}</div>
        : <div className="order-command-board">
          {sortedOrders.map(order => {
            const orderAction = order.status === 'pending'
              ? { label: 'Confirmar y validar' }
              : nextAction[order.status];
            const orderItems = commandItemsByOrder.get(order.id) ?? [];
            return <article className={`order-command-card order-command-card--${order.status}`} key={order.id}>
              <header className="order-command-card__header">
                <div className="order-command-card__topline">
                  <time className="order-command-card__datetime" dateTime={order.createdAt}>
                    <i className="pi pi-clock" aria-hidden="true" />
                    {new Date(order.createdAt).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit' })}
                  </time>
                  <Tag className="order-command-card__status" value={labels[order.status]}
                    icon={order.status === 'served' ? 'pi pi-check-circle' : order.status === 'cancelled' ? 'pi pi-times-circle' : order.status === 'pending' ? 'pi pi-clock' : 'pi pi-sync'}
                    severity={order.status === 'served' ? 'success' : order.status === 'cancelled' ? 'danger' : order.status === 'pending' ? 'warning' : 'info'} />
                </div>
                <div className="order-command-card__identity">
                  <h3>{tableNames[order.tableId] ?? `Mesa · ${order.tableId.slice(0, 8)}`}</h3>
                </div>
              </header>
              <dl className="order-command-card__facts">
                <div>
                  <dt className="order-command-card__visually-hidden">Canal</dt>
                  <dd title={order.createdBy === null ? 'Kiosco' : 'POS / personal'}>
                    <i className="pi pi-shopping-bag" aria-hidden="true" />
                    <span>{order.createdBy === null ? 'Kiosco' : 'POS / personal'}</span>
                  </dd>
                </div>
                <div>
                  <dt className="order-command-card__visually-hidden">Pago</dt>
                  <dd title={order.paymentStatus === 'paid' ? 'Pagada' : order.paymentStatus === 'partial' ? 'Pago parcial' : 'Sin pago'}>
                    <i className="pi pi-wallet" aria-hidden="true" />
                    <span>{order.paymentStatus === 'paid' ? 'Pagada' : order.paymentStatus === 'partial' ? 'Pago parcial' : 'Sin pago'}</span>
                  </dd>
                </div>
              </dl>
              <div className="order-command-card__total">
                <span>Total del pedido</span>
                <strong>{money(order.total)}</strong>
              </div>
              <section className="order-command-card__products" aria-label="Productos del pedido">
                <div className="order-command-card__products-heading">
                  <span>{orderItems.length} {orderItems.length === 1 ? 'artículo' : 'artículos'}</span>
                </div>
                <ul className="order-command-card__items">
                  {orderItems.map(item => <li key={item.id}>
                    <span><b>{item.quantity}×</b> {item.productName}</span>
                    <strong>{money(item.subtotal)}</strong>
                    {item.notes && <small><i className="pi pi-comment" aria-hidden="true" /> {item.notes}</small>}
                  </li>)}
                  {!orderItems.length && <li className="order-command-card__empty">Sin productos</li>}
                </ul>
              </section>
              {order.notes && <p className="order-command-card__note"><i className="pi pi-info-circle" aria-hidden="true" /> {order.notes}</p>}
              <footer className="order-command-card__actions">
                {orderAction && <Button label={orderAction.label} icon="pi pi-arrow-right" className="order-command-card__primary-action"
                  disabled={busy} loading={busy && actionOrderId === order.id}
                  onClick={() => void runAction(order,
                    () => order.status === 'pending'
                      ? service.confirmOrder(order.id)
                      : service.advanceOrder(order.id, nextAction[order.status]!.status),
                    order.status === 'pending' ? 'Orden confirmada.' : 'Estado de la orden actualizado.',
                  )} />}
                <Button icon="pi pi-eye" aria-label="Ver detalle del pedido" tooltip="Ver detalle"
                  severity="secondary" outlined onClick={() => void openDetail(order)} disabled={busy} />
              </footer>
            </article>;
          })}
        </div>}
    {hasMore && <div className="flex justify-content-center">
      <Button label={loading ? 'Cargando…' : 'Cargar más comandas'} icon="pi pi-angle-down" severity="secondary" outlined
        loading={loading} disabled={loading || busy} onClick={() => void loadMore()} />
    </div>}
      <Dialog visible={selected !== null} modal header={selected ? `Orden · ${selected.id.slice(0, 8)}` : 'Orden'}
      className="w-11 md:w-8 lg:w-6" contentStyle={{ maxHeight: '75vh', overflow: 'auto' }}
      onHide={() => !busy && setSelected(null)}>
      {selected && <div className="flex flex-column gap-3">
        <p className="m-0">{tableNames[selected.tableId] ?? `Mesa · ${selected.tableId.slice(0, 8)}`} · Sesión {selected.tableSessionId.slice(0, 8)} · {new Date(selected.createdAt).toLocaleString('es-SV')}</p>
        <p className="m-0">Estado: <Tag value={labels[selected.status]} />
          {' · Pago: '}{selected.paymentStatus === 'paid' ? 'Pagada' : selected.paymentStatus === 'partial' ? 'Parcial' : 'Sin pago'}
        </p>
        {error && <Message severity="error" text={error} />}
        <DataTable value={itemRows} dataKey="id" size="small" loading={detailLoading} emptyMessage="No hay líneas de orden.">
          <Column field="productName" header="Producto" />
          <Column field="quantity" header="Cantidad" />
          <Column field="unitPrice" header="Precio snapshot" body={(item: CafeOrderItem) => money(item.unitPrice)} />
          <Column field="subtotal" header="Subtotal" body={(item: CafeOrderItem) => money(item.subtotal)} />
          <Column field="notes" header="Notas" />
        </DataTable>
        <div className="flex flex-wrap justify-content-between gap-2" aria-label="Resumen de importes">
          <span>Subtotal: {money(selected.subtotal)}</span>
          <span>Descuento: {money(selected.discountTotal)}</span>
          <strong>Total: {money(selected.total)}</strong>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.status === 'pending' && <Button label="Confirmar y validar existencias" loading={busy}
            onClick={() => void runAction(selected, () => service.confirmOrder(selected.id), 'Orden confirmada.')} />}
          {nextAction[selected.status] && <Button label={nextAction[selected.status]!.label} loading={busy}
            onClick={() => void runAction(selected, () => service.advanceOrder(selected.id, nextAction[selected.status]!.status), 'Estado de la orden actualizado.')} />}
          {['pending', 'confirmed'].includes(selected.status) && <Button label="Cancelar orden" severity="danger" outlined disabled={busy}
            onClick={() => { setReason(''); setCancelTarget(selected); }} />}
        </div>
        {cancelTarget?.id === selected.id && <>
          <label htmlFor="order-cancel-reason">Motivo de cancelación (opcional)</label>
          <InputTextarea id="order-cancel-reason" value={reason} maxLength={250} rows={3} autoResize
            onChange={event => setReason(event.target.value)} />
          <div className="flex gap-2">
            <Button label="Volver" severity="secondary" outlined disabled={busy} onClick={() => setCancelTarget(null)} />
            <Button label="Confirmar cancelación" severity="danger" loading={busy}
              onClick={() => void runAction(selected, () => service.cancelOrder(selected.id, reason || null), 'Orden cancelada.')
                .then(succeeded => { if (succeeded) setCancelTarget(null); })} />
          </div>
        </>}
      </div>}
    </Dialog>
  </section>;
}
