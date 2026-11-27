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
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [payerLabel, setPayerLabel] = useState('');
  const [reference, setReference] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<PendingPayment | null>(() => readPending(sessionId));
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(() => readPendingClose(sessionId));
  const [confirmVisible, setConfirmVisible] = useState(false);
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
    setConfirmVisible(false);
    setPaying(true);
    setError('');
    setNotice('');
    try {
      validatePaymentAllocations(intent.allocations, account.lines, intent.method);
      const result = await service.recordPayment(
        sessionId, intent.method, intent.allocations, intent.key, intent.payerLabel, intent.reference,
      );
      setPending(null);
      setAmounts({});
      setNotice(result.idempotentReplay
        ? `Se confirmó el pago anterior por ${currency(result.amount)}.`
        : `Pago registrado por ${currency(result.amount)}.${result.sessionClosed ? ' La sesión se cerró y la mesa quedó disponible.' : ''}`);
      await load();
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
  const canCloseWithCancellations = Boolean(account && account.sessionStatus === 'open'
    && account.balance === 0 && activeOrders.length > 0);

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
    <div className="flex align-items-center justify-content-between flex-wrap gap-2">
      <div>
        <h3 id="account-heading" className="mt-0 mb-1">{account?.tableName ?? 'Cuenta de sesión'}</h3>
        {account && <p className="mt-0 mb-0">Sesión {account.tableSessionId.slice(0, 8)} · Apertura {new Date(account.openedAt).toLocaleString('es-SV')}</p>}
      </div>
      <Button label="Actualizar cuenta" icon="pi pi-refresh" outlined severity="secondary" loading={loading}
        onClick={() => void load()} disabled={paying} />
    </div>
    {error && <Message severity="error" text={error} />}
    {notice && <Message severity="success" text={notice} />}
    {pending && <Message severity="warn" text="Hay un pago con resultado ambiguo. Reintenta solo con esta clave e importes." />}
    {pendingClose && <Message severity="warn" text="Hay un cierre con resultado ambiguo. Reintenta con la misma selección antes de iniciar otro." />}
    {account && <>
      <div className="account-metrics">
        <div className="account-metric"><strong>Total servido</strong><div>{currency(account.totalServed)}</div></div>
        <div className="account-metric"><strong>Total pagado</strong><div>{currency(account.totalPaid)}</div></div>
        <div className="account-metric account-metric--balance"><strong>Saldo por cobrar</strong><div>{currency(account.balance)}</div></div>
        <div className="account-metric"><strong>Estado</strong><div><Tag
          value={account.sessionStatus === 'open' ? 'Sesión abierta' : account.sessionStatus === 'closed' ? 'Sesión cerrada' : 'Sesión cancelada'}
          severity={account.sessionStatus === 'open' ? 'warning' : 'success'} /></div></div>
      </div>
      {activeOrders.length > 0 && <Message severity="warn" text={account.balance > 0
        ? 'Hay órdenes no entregadas y saldo pendiente de órdenes entregadas. Cobra todo lo servido antes de cerrar.'
        : 'El saldo servido está pagado, pero quedan órdenes no entregadas. Para cerrar la mesa debes cancelarlas explícitamente.'} />}
      {account.orders.map(order => <section className="account-order-card" key={order.id}>
        <header className="flex align-items-center justify-content-between flex-wrap gap-2">
          <strong>Orden {order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleString('es-SV')}</strong>
          <Tag value={order.status === 'served' ? 'Entregada' : order.status === 'cancelled' ? 'Cancelada' : 'No cobrable'}
            severity={order.status === 'served' ? 'success' : order.status === 'cancelled' ? 'secondary' : 'warning'} />
        </header>
        {order.notes && <p className="mt-2 mb-2"><strong>Notas:</strong> {order.notes}</p>}
        <DataTable value={account.lines.filter(line => line.orderId === order.id)} dataKey="orderItemId"
          size="small" responsiveLayout="scroll" emptyMessage="Esta orden no tiene líneas.">
          <Column field="productName" header="Producto" />
          <Column field="quantity" header="Cant." />
          <Column header="Subtotal" body={(line: AccountLine) => currency(line.lineTotal)} />
          <Column header="Pagado" body={(line: AccountLine) => currency(line.paidAmount)} />
          <Column header="Saldo" body={(line: AccountLine) => currency(line.balance)} />
          <Column header="Cobro" body={(line: AccountLine) => line.orderStatus === 'served'
            ? <div className="flex align-items-center gap-2 flex-wrap">
              <InputNumber inputId={`amount-${line.orderItemId}`} value={amounts[line.orderItemId] ?? null}
                onValueChange={event => setAmounts(current => {
                  const next = { ...current };
                  if (event.value == null) delete next[line.orderItemId]; else next[line.orderItemId] = Number(event.value);
                  return next;
                })}
                mode="currency" currency="USD" locale="es-SV" min={0} max={line.balance}
                minFractionDigits={2} maxFractionDigits={2} inputStyle={{ width: '8rem' }} />
              <Button label="Saldo" text onClick={() => setAmounts(current => ({ ...current, [line.orderItemId]: line.balance }))} disabled={line.balance <= 0} />
            </div>
            : <Tag value="No cobrable" severity="secondary" />} />
        </DataTable>
      </section>)}
      {account.payments.length > 0 && <section className="account-history-card">
        <h4 className="mb-2">Pagos recientes</h4>
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
      {canCloseWithCancellations && <section className="account-close-card">
        <strong>Cierre de cuenta</strong>
        <p className="m-0">El saldo de lo entregado está pagado. Si continúas, se cancelarán las órdenes no entregadas y se cerrará/liberará esta sesión.</p>
        <div className="flex flex-wrap gap-2">
          <Button label="Revisar cancelación y cerrar mesa" icon="pi pi-lock" severity="warning"
            disabled={paying || Boolean(pendingClose)} onClick={() => {
              setPreparedDispositions({});
              setCloseDialogVisible(true);
            }} />
          {pendingClose && <Button label="Reintentar cierre pendiente" icon="pi pi-refresh" severity="warning"
            loading={paying} onClick={() => void closeAndCancel(true)} />}
        </div>
      </section>}
      {canPay && account.sessionStatus === 'open' && <section className="account-payment-card">
        <h4 className="mt-0 mb-0">Registrar pago</h4>
        <div className="flex flex-wrap gap-2">
          <Button label="Cobrar todo lo elegible" outlined severity="secondary" onClick={setAllEligible}
            disabled={account.balance <= 0 || paying} />
          {pending && <Button label="Reintentar intención" severity="warning" loading={paying}
            onClick={() => void submitPayment(true)} />}
        </div>
        <div className="grid">
          <div className="col-12 md:col-4">
            <label htmlFor="payment-method" className="block mb-2">Método</label>
            <Dropdown inputId="payment-method" value={method}
              options={Object.entries(METHODS).map(([value, label]) => ({ value: value as PaymentMethod, label }))}
              optionLabel="label" optionValue="value" className="w-full" onChange={event => setMethod(event.value)} disabled={paying} />
          </div>
          <div className="col-12 md:col-4">
            <label htmlFor="payer-label" className="block mb-2">Pagador (opcional)</label>
            <InputText id="payer-label" value={payerLabel} maxLength={80} className="w-full"
              onChange={event => setPayerLabel(event.target.value)} disabled={paying} />
          </div>
          <div className="col-12 md:col-4">
            <label htmlFor="payment-reference" className="block mb-2">Referencia (opcional)</label>
            <InputText id="payment-reference" value={reference} maxLength={120} className="w-full"
              onChange={event => setReference(event.target.value)} disabled={paying} />
          </div>
        </div>
        <div className="account-payment-summary">
          <div><span>Pago seleccionado</span><strong>{currency(amountTotal)}</strong></div>
          <div><span>Saldo después del pago</span><strong>{currency(projectedBalance)}</strong></div>
          <Button label="Continuar" icon="pi pi-arrow-right" iconPos="right" disabled={allocations.length === 0 || paying}
            loading={paying} onClick={() => setConfirmVisible(true)} />
        </div>
        {confirmVisible && <div className="border-top-1 pt-3">
          <p className="mt-0">Se cobrarán {allocations.length} línea(s) por {currency(amountTotal)} mediante {METHODS[method]}.</p>
          {projectedBalance === 0 && activeOrders.length === 0 &&
            <Message severity="warn" text="Este pago completará la cuenta y cerrará la sesión; la mesa quedará disponible para una nueva sesión." />}
          {projectedBalance === 0 && activeOrders.length > 0 &&
            <Message severity="info" text="El saldo servido quedará pagado. La sesión seguirá abierta hasta revisar y confirmar la cancelación de las órdenes no entregadas." />}
          <div className="flex gap-2">
            <Button label="Cancelar" severity="secondary" outlined onClick={() => setConfirmVisible(false)} disabled={paying} />
            <Button label="Registrar pago" loading={paying} onClick={() => void submitPayment(false)} />
          </div>
        </div>}
      </section>}
      {!canPay && account.sessionStatus === 'open' &&
        <Message severity="info" text="Tu rol puede consultar la cuenta, pero no puede registrar pagos." />}
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
