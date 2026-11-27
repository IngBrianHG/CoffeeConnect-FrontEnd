import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import Swal from 'sweetalert2';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { ApiError, httpClient } from '../../../services/http/client';
import type {
  AccountLine, PaymentAllocation, PaymentMethod, PreparedOrderDisposition, SessionAccount,
  SessionOrderCancellation, SessionPayment,
} from '../accountModel';
import { validatePaymentAllocations } from '../accountValidation';
import { accountErrorMessage, createAccountService } from '../accountService';

const METHODS: Record<PaymentMethod, string> = {
  cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro',
};
const PENDING_KEY = 'coffee-connect-pending-session-payment';
const PENDING_CLOSE_KEY = 'coffee-connect-pending-session-close';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PendingPayment {
  sessionId: string;
  key: string;
  method: PaymentMethod;
  allocations: PaymentAllocation[];
  payerLabel: string | null;
  reference: string | null;
}
interface PendingClose {
  sessionId: string;
  key: string;
  cancellations: SessionOrderCancellation[];
}

function currency(value: number): string {
  return new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' }).format(value);
}

function readPending(sessionId: string): PendingPayment | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as Partial<PendingPayment> | null;
    if (!value || value.sessionId !== sessionId || typeof value.key !== 'string' || !UUID.test(value.key)
      || !Array.isArray(value.allocations) || !Object.keys(METHODS).includes(String(value.method))) return null;
    return value as PendingPayment;
  } catch {
    return null;
  }
}
function readPendingClose(sessionId: string): PendingClose | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_CLOSE_KEY) ?? 'null') as Partial<PendingClose> | null;
    if (!value || value.sessionId !== sessionId || typeof value.key !== 'string' || !UUID.test(value.key)
      || !Array.isArray(value.cancellations)) return null;
    return value as PendingClose;
  } catch {
    return null;
  }
}

export function SessionAccountPage({
  sessionId,
  onSessionClosed,
}: {
  sessionId: string;
  onSessionClosed?: () => void | Promise<void>;
}) {
  const { session, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const token = useRef(session?.accessToken);
  token.current = session?.accessToken;
  const service = useMemo(() => createAccountService(httpClient, () => token.current, async () => {
    const renewed = await refreshSession().catch(() => null);
    token.current = renewed?.accessToken;
    return renewed?.accessToken ?? null;
  }), [refreshSession]);
  const canPay = session?.profile.role === 'admin' || session?.profile.role === 'cashier';
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<PendingPayment | null>(() => readPending(sessionId));
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(() => readPendingClose(sessionId));
  const [method, setMethod] = useState<PaymentMethod>(() => pending?.method ?? 'cash');
  const [payerLabel, setPayerLabel] = useState(() => pending?.payerLabel ?? '');
  const [reference, setReference] = useState(() => pending?.reference ?? '');
  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries((pending?.allocations ?? []).map(allocation => [allocation.orderItemId, allocation.amount])));
  const [closeDialogVisible, setCloseDialogVisible] = useState(false);
  const [preparedDispositions, setPreparedDispositions] = useState<Record<string, PreparedOrderDisposition | ''>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAccount(await service.getSessionAccount(sessionId));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(accountErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [navigate, service, sessionId, signOut]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    try {
      if (pending) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      else sessionStorage.removeItem(PENDING_KEY);
    } catch {
      // The intent remains in memory if storage is unavailable.
    }
  }, [pending]);
  useEffect(() => {
    try {
      if (pendingClose) sessionStorage.setItem(PENDING_CLOSE_KEY, JSON.stringify(pendingClose));
      else sessionStorage.removeItem(PENDING_CLOSE_KEY);
    } catch {
      // The intent remains in memory if storage is unavailable.
    }
  }, [pendingClose]);

  const allocations = useMemo<PaymentAllocation[]>(() =>
    Object.entries(amounts)
      .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
      .map(([orderItemId, amount]) => ({ orderItemId, amount })),
  [amounts]);
  const amountTotal = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const projectedBalance = account
    ? Math.max(0, account.balance - allocations.reduce((sum, allocation) => sum + allocation.amount, 0))
    : 0;

  function setAllEligible() {
    if (!account) return;
    setAmounts(Object.fromEntries(account.lines
      .filter(line => line.orderStatus === 'served' && line.balance > 0)
      .map(line => [line.orderItemId, line.balance])));
  }

  async function submitPayment(retry = false) {
    if (!account || paying) return;
    const intent: PendingPayment = retry && pending?.sessionId === sessionId ? pending : {
      sessionId,
      key: crypto.randomUUID(),
      method,
      allocations,
      payerLabel: payerLabel.trim() || null,
      reference: reference.trim() || null,
    };
    setPaying(true);
    setError('');
    setNotice('');
    try {
      validatePaymentAllocations(intent.allocations, account.lines, intent.method);
      const result = await service.recordPayment(
        sessionId, intent.method, intent.allocations, intent.key, intent.payerLabel, intent.reference,
      );
      setPending(null);
      setNotice(result.idempotentReplay
        ? `Se confirmó el pago anterior por ${currency(result.amount)}.`
        : `Pago registrado por ${currency(result.amount)}.${result.sessionClosed ? ' La sesión se cerró y la mesa quedó disponible.' : ''}`);
      await load();
      setAmounts({});
      if (result.sessionClosed) await onSessionClosed?.();
    } catch (cause) {
      const ambiguous = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500);
      setPending(ambiguous ? intent : null);
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(ambiguous
        ? 'No se confirmó el resultado del pago. Reintenta con la misma intención; no generes una clave nueva.'
        : accountErrorMessage(cause));
    } finally {
      setPaying(false);
    }
  }

  const activeOrders = account?.orders.filter(order => ['pending', 'confirmed', 'preparing', 'ready'].includes(order.status)) ?? [];
  const preparedOrders = activeOrders.filter(order => order.status === 'preparing' || order.status === 'ready');
  const orderedOrders = useMemo(() => [...(account?.orders ?? [])].sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)),
  [account?.orders]);
  const canCloseWithCancellations = Boolean(account && account.sessionStatus === 'open'
    && account.balance === 0 && activeOrders.length > 0);

  async function confirmPayment() {
    if (!account || allocations.length === 0 || paying) return;
    try {
      validatePaymentAllocations(allocations, account.lines, method);
    } catch (cause) {
      setError(accountErrorMessage(cause));
      return;
    }
    const confirmation = await Swal.fire({
      title: 'Confirmar cobro',
      text: `${allocations.length} línea(s) · ${currency(amountTotal)} mediante ${METHODS[method]}. Saldo después del pago: ${currency(projectedBalance)}.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Confirmar cobro',
      cancelButtonText: 'Seguir editando',
      confirmButtonColor: '#6f4e37',
      reverseButtons: true,
      focusCancel: true,
      customClass: { container: 'account-payment-swal-container' },
    });
    if (confirmation.isConfirmed) await submitPayment();
  }

  async function closeAndCancel(retry = false) {
    if (!account || paying) return;
    const intent = retry && pendingClose?.sessionId === sessionId ? pendingClose : {
      sessionId,
      key: crypto.randomUUID(),
      cancellations: activeOrders.map(order => ({
        orderId: order.id,
        preparedDisposition: order.status === 'preparing' || order.status === 'ready'
          ? preparedDispositions[order.id] || null
          : null,
      })),
    };
    setPaying(true);
    setError('');
    setNotice('');
    try {
      const result = await service.closeSessionAndCancelUnservedOrders(sessionId, intent.cancellations, intent.key);
      setPendingClose(null);
      setCloseDialogVisible(false);
      setNotice(result.idempotentReplay
        ? 'Se confirmó el cierre anterior de la sesión.'
        : 'Órdenes no entregadas canceladas. La cuenta quedó cerrada y la mesa está disponible.');
      await load();
      await onSessionClosed?.();
    } catch (cause) {
      const ambiguous = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500);
      setPendingClose(ambiguous ? intent : null);
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(ambiguous
        ? 'No se confirmó el cierre. Reintenta con la misma intención guardada; no inicies otro cierre.'
        : accountErrorMessage(cause));
    } finally {
      setPaying(false);
    }
  }

  return <div className="account-page" aria-labelledby="account-heading">
    <header className="account-page__header">
      <div>
        <h3 id="account-heading">{account?.tableName ?? 'Cuenta de sesión'}</h3>
        {account && <p>
          Sesión #{account.tableSessionId.slice(0, 8)} · Apertura{' '}
          <time dateTime={account.openedAt}>{new Date(account.openedAt).toLocaleString('es-SV')}</time>
        </p>}
      </div>
      <div className="account-page__header-actions">
        {account && <Tag value={account.sessionStatus === 'open' ? 'Abierta' : account.sessionStatus === 'closed' ? 'Cerrada' : 'Cancelada'}
          severity={account.sessionStatus === 'open' ? 'warning' : 'secondary'} />}
        <Button label="Actualizar" aria-label="Actualizar cuenta" icon="pi pi-refresh" outlined severity="secondary" loading={loading}
          onClick={() => void load()} disabled={paying} />
      </div>
    </header>
    {error && <Message severity="error" text={error} />}
    {notice && <Message severity="success" text={notice} />}
    {pending && <Message severity="warn" text="Hay un pago con resultado ambiguo. Reintenta solo con esta clave e importes." />}
    {pendingClose && <Message severity="warn" text="Hay un cierre con resultado ambiguo. Reintenta con la misma selección antes de iniciar otro." />}
    {account && <>
      <div className="account-metrics">
        <div className="account-metric"><strong>Total servido</strong><div>{currency(account.totalServed)}</div></div>
        <div className="account-metric"><strong>Total pagado</strong><div>{currency(account.totalPaid)}</div></div>
        <div className="account-metric account-metric--balance"><strong>Saldo por cobrar</strong><div>{currency(account.balance)}</div></div>
      </div>
      {activeOrders.length > 0 && <Message severity="warn" text={account.balance > 0
        ? 'Hay órdenes no entregadas y saldo pendiente de órdenes entregadas. Cobra todo lo servido antes de cerrar.'
        : 'El saldo servido está pagado, pero quedan órdenes no entregadas. Para cerrar la mesa debes cancelarlas explícitamente.'} />}
      <div className="account-workspace">
        <div className="account-workspace__details">
          <div className="account-order-list">
            {orderedOrders.length === 0 && <p className="account-empty">Esta sesión todavía no tiene órdenes.</p>}
            {orderedOrders.map(order => <section className="account-order-card" key={order.id}>
        <header className="account-order-card__header">
          <div>
            <strong>Orden #{order.id.slice(0, 8)}</strong>
            <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
          <Tag value={order.status === 'served' ? 'Entregada' : order.status === 'cancelled' ? 'Cancelada' : 'No cobrable'}
            severity={order.status === 'served' ? 'success' : order.status === 'cancelled' ? 'secondary' : 'warning'} />
        </header>
        {order.notes && <p className="account-order-card__notes"><strong>Notas:</strong> {order.notes}</p>}
        <DataTable value={account.lines.filter(line => line.orderId === order.id)} dataKey="orderItemId"
          size="small" responsiveLayout="scroll" emptyMessage="Esta orden no tiene líneas.">
          <Column field="productName" header="Producto" />
          <Column field="quantity" header="Cant." />
          <Column header="Total" body={(line: AccountLine) => currency(line.lineTotal)} />
          <Column header="Pagado" body={(line: AccountLine) => currency(line.paidAmount)} />
          <Column header="Saldo" body={(line: AccountLine) => currency(line.balance)} />
          <Column header="Cobro" body={(line: AccountLine) => line.orderStatus === 'served'
            ? <div className="account-line-payment">
              <InputNumber inputId={`amount-${line.orderItemId}`} value={amounts[line.orderItemId] ?? null}
                onValueChange={event => setAmounts(current => {
                  const next = { ...current };
                  if (event.value == null) delete next[line.orderItemId]; else next[line.orderItemId] = Number(event.value);
                  return next;
                })}
                mode="currency" currency="USD" locale="es-SV" min={0} max={line.balance}
                minFractionDigits={2} maxFractionDigits={2} inputStyle={{ width: '6.5rem' }}
                disabled={paying || Boolean(pending)} />
              <Button label="Saldo" text onClick={() => setAmounts(current => ({ ...current, [line.orderItemId]: line.balance }))}
                disabled={line.balance <= 0 || paying || Boolean(pending)} />
            </div>
            : <Tag value="No cobrable" severity="secondary" />} />
        </DataTable>
            </section>)}
          </div>
      {account.payments.length > 0 && <section className="account-history-card">
        <h4>Pagos recientes</h4>
        <DataTable value={account.payments} dataKey="id" size="small" responsiveLayout="scroll">
          <Column header="Fecha" body={(payment) => new Date(payment.createdAt).toLocaleString('es-SV')} />
          <Column header="Método" body={(payment: SessionPayment) => METHODS[payment.method]} />
          <Column header="Importe" body={(payment) => currency(payment.amount)} />
          <Column header="Pagador" field="payerLabel" />
          <Column header="Referencia" field="reference" />
          <Column header="Asignaciones" body={(payment: SessionPayment) => payment.allocations
            .map(allocation => `${allocation.orderItemId.slice(0, 8)} · ${currency(allocation.amount)}`).join(' | ')} />
        </DataTable>
      </section>}
        </div>
        <aside className="account-workspace__aside" aria-label="Registro y resumen del pago">
          {canPay && account.sessionStatus === 'open' ? <>
            <section className="account-payment-card">
              <div className="account-payment-card__heading">
                <h4>Registrar pago</h4>
                <Button label="Cobrar todo" outlined severity="secondary" onClick={setAllEligible}
                  disabled={account.balance <= 0 || paying || Boolean(pending)} />
              </div>
              <div className="account-payment-fields">
                <div>
                  <label htmlFor="payment-method">Método de pago</label>
                  <Dropdown inputId="payment-method" value={method}
                    options={Object.entries(METHODS).map(([value, label]) => ({ value: value as PaymentMethod, label }))}
                    optionLabel="label" optionValue="value" className="w-full" onChange={event => setMethod(event.value)} disabled={paying || Boolean(pending)} />
                </div>
                <div>
                  <label htmlFor="payer-label">Pagador (opcional)</label>
                  <InputText id="payer-label" value={payerLabel} maxLength={80} className="w-full"
                    onChange={event => setPayerLabel(event.target.value)} disabled={paying || Boolean(pending)} />
                </div>
                <div>
                  <label htmlFor="payment-reference">Referencia (opcional)</label>
                  <InputText id="payment-reference" value={reference} maxLength={120} className="w-full"
                    onChange={event => setReference(event.target.value)} disabled={paying || Boolean(pending)} />
                </div>
              </div>
              <div className="account-payment-summary" aria-live="polite">
                <div><span>Pago seleccionado</span><strong>{currency(amountTotal)}</strong></div>
                <div><span>Saldo después</span><strong>{currency(projectedBalance)}</strong></div>
                <Button label={pending ? 'Resolver pago pendiente' : 'Cobrar'}
                  icon={pending ? 'pi pi-refresh' : 'pi pi-check'}
                  disabled={pending ? paying : allocations.length === 0 || paying}
                  loading={paying} onClick={() => pending ? void submitPayment(true) : void confirmPayment()} />
              </div>
              {projectedBalance === 0 && amountTotal > 0 && <small className="account-payment-hint">
                {activeOrders.length === 0
                  ? 'Al completar el cobro, la sesión se cerrará y la mesa quedará disponible.'
                  : 'Quedarán pagadas las órdenes entregadas; revisa las órdenes no entregadas para cerrar la mesa.'}
              </small>}
            </section>
            {canCloseWithCancellations && <section className="account-close-card">
              <div>
                <strong>Cierre de cuenta</strong>
                <small>Saldo liquidado · {activeOrders.length} orden(es) por revisar</small>
              </div>
              <Button label="Revisar y cerrar" icon="pi pi-lock" severity="warning"
                disabled={paying || Boolean(pendingClose)} onClick={() => {
                  setPreparedDispositions({});
                  setCloseDialogVisible(true);
                }} />
              {pendingClose && <Button label="Reintentar cierre" icon="pi pi-refresh" severity="warning"
                loading={paying} onClick={() => void closeAndCancel(true)} />}
            </section>}
          </> : canPay
            ? <Message severity="info" text="Esta sesión ya no admite nuevos cobros." />
            : <Message severity="info" text="Tu rol puede consultar la cuenta, pero no registrar pagos." />}
        </aside>
      </div>
      <Dialog visible={closeDialogVisible} modal header="Confirmar cierre de cuenta"
        className="w-11 md:w-8 lg:w-6" contentStyle={{ maxHeight: '75vh', overflow: 'auto' }}
        onHide={() => !paying && setCloseDialogVisible(false)}
        footer={<div className="flex justify-content-end gap-2">
          <Button label="Volver" severity="secondary" outlined disabled={paying} onClick={() => setCloseDialogVisible(false)} />
          <Button label="Cancelar órdenes y cerrar mesa" icon="pi pi-lock" severity="warning" loading={paying}
            disabled={preparedOrders.some(order => !preparedDispositions[order.id])}
            onClick={() => void closeAndCancel()} />
        </div>}>
        <div className="account-close-review">
          <Message severity="warn" text={`Esta acción cancelará ${activeOrders.length} orden(es), cerrará la sesión y dejará la mesa disponible. El saldo servido debe estar en cero. Esta acción no se puede deshacer.`} />
          {activeOrders.map(order => <div key={order.id} className="account-order-card">
            <strong>Orden {order.id.slice(0, 8)} · {order.status === 'pending' ? 'Pendiente' : order.status === 'confirmed' ? 'Confirmada' : order.status === 'preparing' ? 'Preparando' : 'Lista'}</strong>
            <p className="mt-1 mb-2">{order.items.map(item => `${item.quantity} × ${item.productName}`).join(', ')}</p>
            {order.status === 'confirmed' && <small>Al cancelarla se devolverá a inventario el consumo registrado al confirmar.</small>}
            {(order.status === 'preparing' || order.status === 'ready') && <>
              <p className="mt-1 mb-2">Indica qué ocurrirá con lo preparado. En ambas opciones el stock no se repone.</p>
              <label htmlFor={`disposition-${order.id}`} className="block mb-2">Destino de la preparación</label>
              <Dropdown inputId={`disposition-${order.id}`}
                value={preparedDispositions[order.id] || null}
                options={[
                  { label: 'Selecciona una opción', value: null },
                  { label: 'Registrar como merma', value: 'waste' },
                  { label: 'Reutilizable / reasignar a otra mesa', value: 'reusable' },
                ]}
                optionLabel="label" optionValue="value" className="w-full"
                onChange={event => setPreparedDispositions(current => ({ ...current, [order.id]: event.value ?? '' }))}
                disabled={paying} />
            </>}
          </div>)}
        </div>
      </Dialog>
    </>}
  </div>;
}
