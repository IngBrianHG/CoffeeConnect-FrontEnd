import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { SessionAccountPage } from '../orders/components/SessionAccountPage';
import '../orders/components/account.css';
import { accountErrorMessage, createAccountService } from '../orders/accountService';
import { formatCurrency } from '../../config/primeReact';
import { cafeTablesErrorMessage, createCafeTablesService, type CafeTable, type TableSession } from '../../services/cafeTables';
import { ApiError, httpClient } from '../../services/http/client';
import './caja.css';

export function CajaPage({ initialSessionId }: { initialSessionId?: string }) {
  const { session, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const token = useRef(session?.accessToken);
  token.current = session?.accessToken;
  const service = useMemo(() => createCafeTablesService(httpClient, () => token.current, async () => {
    const refreshed = await refreshSession().catch(() => null);
    token.current = refreshed?.accessToken;
    return refreshed?.accessToken ?? null;
  }), [refreshSession]);
  const accountService = useMemo(() => createAccountService(httpClient, () => token.current, async () => {
    const refreshed = await refreshSession().catch(() => null);
    token.current = refreshed?.accessToken;
    return refreshed?.accessToken ?? null;
  }), [refreshSession]);
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [tables, setTables] = useState<CafeTable[]>([]);
  const [invoicedTotals, setInvoicedTotals] = useState<Map<string, number> | null>(null);
  const [selected, setSelected] = useState<TableSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [reload, setReload] = useState(0);
  const requestedSessionId = useRef(initialSessionId);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setSummaryLoading(false);
    setError('');
    setSummaryError('');
    setInvoicedTotals(null);
    try {
      const [nextSessions, nextTables] = await Promise.all([
        service.listOpenSessions(signal), service.listTables(signal),
      ]);
      if (signal?.aborted) return;
      const tableIds = new Set(nextTables.map(table => table.id));
      if (nextSessions.some(item => !tableIds.has(item.tableId))) {
        throw new ApiError(200, 'La lista de sesiones contiene una mesa no válida.', 'INVALID_RESPONSE');
      }
      setSessions(nextSessions);
      setTables(nextTables);
      setLoading(false);
      setSummaryLoading(true);
      try {
        const totals = await accountService.getServedTotalsBySession(nextSessions.map(item => item.id), signal);
        if (signal?.aborted) return;
        setInvoicedTotals(totals);
      } catch (cause) {
        if (signal?.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          await signOut();
          navigate('/admin/login', { replace: true });
        }
        setSummaryError(accountErrorMessage(cause));
      } finally {
        if (!signal?.aborted) setSummaryLoading(false);
      }
    } catch (cause) {
      if (signal?.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(cafeTablesErrorMessage(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [accountService, navigate, service, signOut]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reload]);

  useEffect(() => {
    if (initialSessionId) requestedSessionId.current = initialSessionId;
  }, [initialSessionId]);

  useEffect(() => {
    if (!requestedSessionId.current || loading) return;
    const requested = sessions.find(item => item.id === requestedSessionId.current);
    requestedSessionId.current = undefined;
    if (requested) {
      setSelected(requested);
      return;
    }
    setError('La sesión seleccionada ya no está abierta. Actualiza la lista antes de consultar la cuenta.');
  }, [initialSessionId, loading, sessions]);

  const tableNames = useMemo(() => new Map(tables.map(table => [table.id, table.name])), [tables]);
  const tableName = (row: TableSession) => tableNames.get(row.tableId) ?? 'Mesa';

  return <section className="admin-module caja-page" aria-label="Caja">
    <header className="caja-page__header">
      <p>Consulta las cuentas de sesiones abiertas y registra cobros. La cuenta y los pagos se validan en el servidor.</p>
      <Button label="Actualizar" icon="pi pi-refresh" severity="secondary" outlined loading={loading || summaryLoading}
        disabled={loading || summaryLoading} onClick={() => setReload(value => value + 1)} />
    </header>
    {error && <Message severity="error" text={error} />}
    {summaryError && <Message severity="warn" text={`No se pudo calcular el total facturado. ${summaryError}`} />}
    <div className="caja-summary-grid">
      <article className="caja-summary-card caja-summary-card--sessions">
        <span className="caja-summary-card__icon" aria-hidden="true"><i className="pi pi-users" /></span>
        <div className="caja-summary-card__content">
          <span>Sesiones abiertas</span>
          <strong>{loading ? '…' : sessions.length}</strong>
          <small>Mesas con una cuenta activa</small>
        </div>
      </article>
      <article className="caja-summary-card caja-summary-card--invoiced">
        <span className="caja-summary-card__icon" aria-hidden="true"><i className="pi pi-wallet" /></span>
        <div className="caja-summary-card__content">
          <span>Total facturado</span>
          <strong>{loading || summaryLoading ? 'Calculando…' : summaryError || !invoicedTotals ? 'No disponible' : formatCurrency([...invoicedTotals.values()].reduce((sum, total) => sum + total, 0))}</strong>
          <small>Órdenes servidas en sesiones abiertas</small>
        </div>
      </article>
    </div>
    <div className="caja-page__table-card">
      <DataTable value={sessions} dataKey="id" size="small" stripedRows responsiveLayout="scroll"
        paginator rows={10} rowsPerPageOptions={[10, 25, 50]}
        currentPageReportTemplate="Mostrando {first} a {last} de {totalRecords} sesiones"
        loading={loading} emptyMessage={error ? 'No se pudieron cargar las sesiones.' : 'No hay cuentas abiertas para cobrar.'}
        className="caja-page__table">
        <Column header="Mesa" body={(row: TableSession) =>
          <div className="caja-table__table-cell">
            <i className="pi pi-map-marker" aria-hidden="true" />
            <div><strong>{tableName(row)}</strong><small>Sesión #{row.id.slice(0, 8)}</small></div>
          </div>
        } />
        <Column header="Estado" body={() => <Tag value="Abierta" severity="success" />} />
        <Column field="openedAt" header="Fecha de apertura" sortable
          body={(row: TableSession) => new Date(row.openedAt).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' })} />
        <Column header="Total facturado" body={(row: TableSession) => {
          const total = invoicedTotals?.get(row.id);
          return <strong className="caja-table__amount">
            {loading || summaryLoading ? 'Calculando…' : summaryError || total === undefined ? '—' : formatCurrency(total)}
          </strong>;
        }} />
        <Column header="Acción" body={(row: TableSession) =>
          <Button label="Abrir cuenta" icon="pi pi-wallet" onClick={() => setSelected(row)} />
        } />
      </DataTable>
    </div>
    <Dialog visible={selected !== null} header="Cobro de cuenta"
      modal className="account-payment-dialog" contentStyle={{ overflow: 'hidden' }}
      onHide={() => setSelected(null)}>
      {selected && <SessionAccountPage sessionId={selected.id} onSessionClosed={() => {
        setSelected(null);
        setReload(value => value + 1);
      }} />}
    </Dialog>
  </section>;
}
