import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import {
  cafeTablesErrorMessage, createCafeTablesService, type CafeTable, type TableSession,
} from '../../services/cafeTables';
import { ApiError, httpClient } from '../../services/http/client';
import { SessionAccountPage } from '../../features/orders/components/SessionAccountPage';
import '../../features/orders/components/account.css';

type Draft = { table?: CafeTable; name: string; active: boolean } | null;
type PendingOpen = { tableId: string; key: string };
const PENDING_OPEN_STORAGE_KEY = 'coffee-connect-table-open-intent';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readPendingOpen(): PendingOpen | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_OPEN_STORAGE_KEY) ?? 'null') as Partial<PendingOpen> | null;
    return value && typeof value.tableId === 'string' && UUID.test(value.tableId)
      && typeof value.key === 'string' && UUID.test(value.key)
      ? { tableId: value.tableId, key: value.key }
      : null;
  } catch {
    return null;
  }
}

function invalidRelation(): never {
  throw new ApiError(200, 'El servicio devolvió datos no válidos para la relación entre mesas y sesiones.', 'INVALID_RESPONSE');
}

export function TablesSessionsPage() {
  const { session, refreshSession, signOut } = useAuth();
  const navigate = useNavigate();
  const token = useRef(session?.accessToken);
  token.current = session?.accessToken;
  const service = useMemo(() => createCafeTablesService(
    httpClient,
    () => token.current,
    async () => {
      const refreshed = await refreshSession().catch(() => null);
      token.current = refreshed?.accessToken;
      return refreshed?.accessToken ?? null;
    },
  ), [refreshSession]);
  const role = session?.profile.role;
  const isAdmin = role === 'admin';
  const [tables, setTables] = useState<CafeTable[]>([]);
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Draft>(null);
  const [saving, setSaving] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(readPendingOpen);
  const [formError, setFormError] = useState('');
  const [accountSession, setAccountSession] = useState<TableSession | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextTables, nextSessions] = await Promise.all([
        service.listTables(),
        service.listOpenSessions(),
      ]);
      const tableById = new Map(nextTables.map(table => [table.id, table]));
      const openedTableIds = new Set<string>();
      for (const item of nextSessions) {
        if (!tableById.has(item.tableId) || tableById.get(item.tableId)?.status !== 'occupied' || openedTableIds.has(item.tableId)) {
          invalidRelation();
        }
        openedTableIds.add(item.tableId);
      }
      if (nextTables.some(table => table.status === 'occupied' && !openedTableIds.has(table.id))) invalidRelation();
      setTables(nextTables);
      setSessions(nextSessions);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(cafeTablesErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [navigate, service, signOut]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    try {
      if (pendingOpen) sessionStorage.setItem(PENDING_OPEN_STORAGE_KEY, JSON.stringify(pendingOpen));
      else sessionStorage.removeItem(PENDING_OPEN_STORAGE_KEY);
    } catch {
      // La clave sigue en memoria mientras la vista permanezca montada.
    }
  }, [pendingOpen]);

  const sessionsByTable = useMemo(() => new Map(sessions.map(item => [item.tableId, item])), [sessions]);

  function openEditor(table?: CafeTable) {
    setDraft({ table, name: table?.name ?? '', active: table?.active ?? true });
    setFormError('');
  }

  async function saveTable() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setFormError('El nombre de la mesa es obligatorio.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (draft.table) {
        if (!draft.active && sessionsByTable.has(draft.table.id)) {
          setFormError('Cierra primero la sesión abierta antes de desactivar esta mesa.');
          return;
        }
        await service.updateTable(draft.table.id, { name, active: draft.active });
      } else {
        await service.createTable(name);
      }
      setDraft(null);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setFormError(cafeTablesErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function openSession(table: CafeTable, retry = false) {
    if (busyId) return;
    if (!retry && pendingOpen) {
      setError('Hay una apertura cuyo resultado no se confirmó. Reintenta esa misma mesa antes de iniciar otra.');
      return;
    }
    const pending = retry && pendingOpen?.tableId === table.id
      ? pendingOpen
      : { tableId: table.id, key: crypto.randomUUID() };
    setBusyId(table.id);
    setError('');
    setNotice('');
    try {
      try {
        sessionStorage.setItem(PENDING_OPEN_STORAGE_KEY, JSON.stringify(pending));
      } catch {
        // La misma clave permanece en memoria para reintentar mientras la vista siga abierta.
      }
      await service.openSession(table.id, pending.key);
      try { sessionStorage.removeItem(PENDING_OPEN_STORAGE_KEY); } catch { /* La respuesta ya confirmó la operación. */ }
      setPendingOpen(null);
      setNotice(`Sesión abierta para ${table.name}.`);
      await load();
    } catch (cause) {
      const ambiguous = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500);
      setPendingOpen(ambiguous ? pending : null);
      if (!ambiguous) {
        try { sessionStorage.removeItem(PENDING_OPEN_STORAGE_KEY); } catch { /* No bloquear la recuperación de la vista. */ }
      }
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(ambiguous
        ? `No se confirmó el resultado al abrir ${table.name}. Reintenta con la misma clave; no inicies otra apertura.`
        : cafeTablesErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function closeSession(item: TableSession, tableName: string) {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    setNotice('');
    try {
      await service.closeSession(item.id);
      setNotice(`Sesión cerrada para ${tableName}.`);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(cafeTablesErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function changeAvailability(table: CafeTable, status: 'available' | 'unavailable') {
    if (busyId) return;
    setBusyId(table.id);
    setError('');
    setNotice('');
    try {
      await service.setTableStatus(table.id, status);
      setNotice(`${table.name}: ${status === 'available' ? 'disponible' : 'no disponible'}.`);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
        navigate('/admin/login', { replace: true });
      }
      setError(cafeTablesErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  const statusLabels = {
    available: 'Disponible',
    assigned: 'Asignada',
    occupied: 'Ocupada',
    unavailable: 'No disponible',
  } satisfies Record<CafeTable['status'], string>;

  return <section className="flex flex-column gap-3" aria-labelledby="tables-heading">
    <div className="flex align-items-center justify-content-between flex-wrap gap-2">
      <div>
        <h2 id="tables-heading" className="mt-0 mb-1">Mesas y sesiones</h2>
        <p className="mt-0 mb-0">Administra la disponibilidad y las visitas abiertas. El cierre requiere que no haya órdenes pendientes.</p>
      </div>
      <div className="flex gap-2">
        <Button label="Actualizar" icon="pi pi-refresh" severity="secondary" outlined onClick={() => void load()} disabled={loading} />
        {isAdmin && <Button label="Nueva mesa" icon="pi pi-plus" onClick={() => openEditor()} />}
      </div>
    </div>
    {error && <Message severity="error" text={error} />}
    {notice && <Message severity="success" text={notice} />}
    {pendingOpen && <Message severity="warn" text="Hay una apertura con resultado ambiguo. Reintenta con la misma mesa y la misma clave antes de iniciar otra." />}
    <DataTable value={tables} dataKey="id" size="small" stripedRows responsiveLayout="scroll" loading={loading} emptyMessage="No hay mesas registradas.">
      <Column field="name" header="Mesa" />
      <Column header="Estado operativo" body={(table: CafeTable) =>
        <Tag value={statusLabels[table.status]} severity={
          table.status === 'available' ? 'success' : table.status === 'occupied' ? 'warning' : 'secondary'
        } />
      } />
      <Column header="QR" body={(table: CafeTable) => <Tag value={table.active ? 'Activo' : 'Inactivo'} severity={table.active ? 'success' : 'secondary'} />} />
      <Column header="Sesión abierta" body={(table: CafeTable) => {
        const item = sessionsByTable.get(table.id);
        return item ? new Date(item.openedAt).toLocaleString('es-SV') : '—';
      }} />
      <Column header="Acciones" body={(table: CafeTable) => {
        const item = sessionsByTable.get(table.id);
        const busy = busyId === table.id || busyId === item?.id;
        return <span className="flex align-items-center gap-2 flex-wrap">
          {isAdmin && <Button icon="pi pi-pencil" text aria-label={`Editar ${table.name}`} onClick={() => openEditor(table)} disabled={busy} />}
          {item
            ? <>
              <Button label="Ver cuenta" icon="pi pi-wallet" severity="secondary" outlined disabled={busy}
                onClick={() => setAccountSession(item)} />
              <Button label="Cerrar sesión" icon="pi pi-lock" severity="secondary" outlined disabled={busy} loading={busy}
                onClick={() => void closeSession(item, table.name)} />
            </>
            : <Button label={pendingOpen?.tableId === table.id ? 'Reintentar apertura' : 'Abrir sesión'} icon="pi pi-lock-open"
                disabled={busy || Boolean(pendingOpen) || !table.active || table.status === 'unavailable'}
                loading={busy} onClick={() => void openSession(table, pendingOpen?.tableId === table.id)} />}
          {isAdmin && !item && table.status !== 'occupied' && (
            <Button
              label={table.status === 'unavailable' ? 'Habilitar' : 'No disponible'}
              text severity="secondary" disabled={busy}
              onClick={() => void changeAvailability(table, table.status === 'unavailable' ? 'available' : 'unavailable')}
            />
          )}
        </span>;
      }} />
    </DataTable>
    <Dialog
      visible={draft !== null}
      header={draft?.table ? `Editar ${draft.table.name}` : 'Nueva mesa'}
      modal
      className="w-11 md:w-7 lg:w-5"
      contentStyle={{ maxHeight: '75vh', overflow: 'auto' }}
      onHide={() => !saving && setDraft(null)}
      footer={<div className="flex justify-content-end gap-2">
        <Button label="Cancelar" severity="secondary" outlined disabled={saving} onClick={() => setDraft(null)} />
        <Button label="Guardar" icon="pi pi-check" loading={saving} onClick={() => void saveTable()} />
      </div>}
    >
      {draft && <div className="p-fluid flex flex-column gap-3">
        {formError && <Message severity="error" text={formError} />}
        <div className="field">
          <label htmlFor="table-name">Nombre *</label>
          <InputText id="table-name" value={draft.name} maxLength={100} invalid={Boolean(formError)}
            aria-describedby={formError ? 'table-form-error' : undefined}
            onChange={event => setDraft(current => current ? { ...current, name: event.target.value } : current)} />
        </div>
        {draft.table && <div className="flex align-items-center gap-2">
          <InputSwitch inputId="table-active" checked={draft.active}
            disabled={sessionsByTable.has(draft.table.id)}
            onChange={event => {
              if (!event.value && sessionsByTable.has(draft.table!.id)) {
                setFormError('Cierra primero la sesión abierta antes de desactivar esta mesa.');
                return;
              }
              setDraft(current => current ? { ...current, active: event.value } : current);
            }} />
          <label htmlFor="table-active">QR activo</label>
          {!draft.active && sessionsByTable.has(draft.table.id) && <small> Cierra la sesión antes de desactivar.</small>}
        </div>}
        {formError && <small id="table-form-error" role="alert">{formError}</small>}
      </div>}
    </Dialog>
    <Dialog
      visible={accountSession !== null}
      header={accountSession ? `Cuenta · ${accountSession.id.slice(0, 8)}` : 'Cuenta'}
      modal
      className="account-payment-dialog"
      contentStyle={{ maxHeight: '82vh', overflow: 'auto' }}
      onHide={() => setAccountSession(null)}
    >
      {accountSession && <SessionAccountPage sessionId={accountSession.id} onSessionClosed={load} />}
    </Dialog>
  </section>;
}
