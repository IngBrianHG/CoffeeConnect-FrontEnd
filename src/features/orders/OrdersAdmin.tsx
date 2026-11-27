import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { InputTextarea } from 'primereact/inputtextarea';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { Dropdown } from 'primereact/dropdown';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, httpClient } from '../../services/http/client';
import { createCafeOrdersService, ordersErrorMessage } from './ordersService';
import { createCafeTablesService, cafeTablesErrorMessage } from '../../services/cafeTables';
import type { CafeOrder, CafeOrderItem, OrderStatus } from './model';

const PAGE_SIZE = 200;
const labels: Record<OrderStatus, string> = {
  pending: 'Pendiente', confirmed: 'Confirmada', preparing: 'Preparando',
  ready: 'Lista', served: 'Entregada', cancelled: 'Cancelada',
};
function money(value: number): string {
  return new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' }).format(value);
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
  const [items, setItems] = useState<CafeOrderItem[]>([]);
  const [tableNames, setTableNames] = useState<Record<string, string>>({});
  const [tableError, setTableError] = useState('');
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all'>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<CafeOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CafeOrder | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async (nextOffset = 0, append = false, status: OrderStatus | 'all' = filterStatus) => {
    setLoading(true);
    setError('');
    try {
      const page = await service.listOrders({ offset: nextOffset, ...(status === 'all' ? {} : { status }) });
      setOrders(current => append ? [...current, ...page] : page);
      setOffset(nextOffset + page.length);
      setHasMore(page.length === PAGE_SIZE);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(ordersErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [filterStatus, navigate, service, signOut]);
  useEffect(() => { void load(); }, [load]);

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

  async function runAction(action: () => Promise<OrderStatus>, success: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      try {
        await load();
        const refreshed = await service.getOrder(selected.id);
        setSelected(refreshed);
        setItems(refreshed.items);
      } catch {
        setNotice(`${success} La operación se guardó, pero no se pudo actualizar la vista; actualiza para ver el estado.`);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(ordersErrorMessage(cause));
    } finally { setBusy(false); }
  }

  const nextAction: Partial<Record<OrderStatus, { status: 'preparing' | 'ready' | 'served'; label: string }>> = {
    confirmed: { status: 'preparing', label: 'Iniciar preparación' },
    preparing: { status: 'ready', label: 'Marcar lista' },
    ready: { status: 'served', label: 'Marcar entregada' },
  };
  const itemRows = useMemo(() => items.filter(item => item.orderId === selected?.id), [items, selected]);

  return <section className="flex flex-column gap-3" aria-labelledby="orders-heading">
    <div className="flex align-items-center justify-content-between flex-wrap gap-2">
      <div><h2 id="orders-heading" className="mt-0 mb-1">Órdenes</h2>
        <p className="mt-0 mb-0">Confirma para validar existencias y consumir inventario. Los importes y snapshots provienen del servidor.</p></div>
      <div className="flex align-items-center flex-wrap gap-2">
        <label htmlFor="orders-status-filter">Estado</label>
        <Dropdown inputId="orders-status-filter" value={filterStatus}
          options={[
            { label: 'Todos', value: 'all' },
            ...Object.entries(labels).map(([value, label]) => ({ label, value })),
          ]}
          onChange={event => {
            const nextStatus = event.value as OrderStatus | 'all';
            setFilterStatus(nextStatus);
          }}
          optionLabel="label" optionValue="value" className="w-12rem" disabled={loading || busy} />
        <Button label="Actualizar" icon="pi pi-refresh" severity="secondary" outlined
          onClick={() => void load()} disabled={loading || busy} />
      </div>
    </div>
    {error && <Message severity="error" text={error} />}
    {tableError && <Message severity="warn" text={`No se pudieron cargar los nombres de mesa. Se muestran identificadores. ${tableError}`} />}
    {notice && <Message severity="success" text={notice} />}
    <DataTable value={orders} dataKey="id" size="small" stripedRows responsiveLayout="scroll"
      loading={loading} emptyMessage="No hay órdenes visibles.">
      <Column field="createdAt" header="Fecha" body={(order: CafeOrder) => new Date(order.createdAt).toLocaleString('es-SV')} />
      <Column field="tableId" header="Mesa" body={(order: CafeOrder) =>
        <span title={order.tableId}>{tableNames[order.tableId] ?? `Mesa · ${order.tableId.slice(0, 8)}`}</span>
      } />
      <Column header="Origen" body={(order: CafeOrder) => order.createdBy === null ? 'Kiosco' : 'POS / personal'} />
      <Column field="status" header="Estado" body={(order: CafeOrder) =>
        <Tag value={labels[order.status]} severity={order.status === 'served' ? 'success' : order.status === 'cancelled' ? 'danger' : order.status === 'pending' ? 'warning' : 'info'} />
      } />
      <Column field="paymentStatus" header="Pago" body={(order: CafeOrder) => order.paymentStatus === 'paid' ? 'Pagada' : order.paymentStatus === 'partial' ? 'Parcial' : 'Sin pago'} />
      <Column field="total" header="Total" body={(order: CafeOrder) => money(order.total)} />
      <Column header="Detalle" body={(order: CafeOrder) => <Button label="Ver orden" text onClick={() => void openDetail(order)} />} />
    </DataTable>
    {hasMore && <div className="flex justify-content-center">
      <Button label="Cargar más órdenes" icon="pi pi-angle-down" severity="secondary" outlined
        loading={loading} onClick={() => void load(offset, true)} />
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
            onClick={() => void runAction(() => service.confirmOrder(selected.id), 'Orden confirmada.')} />}
          {nextAction[selected.status] && <Button label={nextAction[selected.status]!.label} loading={busy}
            onClick={() => void runAction(() => service.advanceOrder(selected.id, nextAction[selected.status]!.status), 'Estado de la orden actualizado.')} />}
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
              onClick={() => void runAction(() => service.cancelOrder(selected.id, reason || null), 'Orden cancelada.').then(() => setCancelTarget(null))} />
          </div>
        </>}
      </div>}
    </Dialog>
  </section>;
}
