import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import Swal from 'sweetalert2';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import {
  cafeTablesErrorMessage, createCafeTablesService, type CafeTable, type TableSession,
} from '../../services/cafeTables';
import { ApiError, httpClient } from '../../services/http/client';

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
  const [detailTable, setDetailTable] = useState<CafeTable | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  const qrRequestId = useRef(0);

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
  const canAccessCash = role === 'admin' || role === 'cashier';

  function getTableUrl(tableId: string) {
    return new URL(`/user/${tableId}`, window.location.origin).toString();
  }

  function openTable(table: CafeTable) {
    const newTab = window.open(getTableUrl(table.id), '_blank');
    if (!newTab) {
      setError('El navegador bloqueó la nueva pestaña. Permite ventanas emergentes e inténtalo de nuevo.');
      return;
    }
    newTab.opener = null;
  }

  function showDetails(table: CafeTable) {
    setDetailTable(table);
    setDraft(isAdmin ? { table, name: table.name, active: table.active } : null);
    setFormError('');
    void generateQr(table);
  }

  async function generateQr(table: CafeTable) {
    const requestId = ++qrRequestId.current;
    setQrDataUrl('');
    setQrError('');
    setQrLoading(true);
    try {
      const { default: QRCode } = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(getTableUrl(table.id), {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'H',
      });
      if (qrRequestId.current === requestId) setQrDataUrl(dataUrl);
    } catch {
      if (qrRequestId.current === requestId) setQrError('No se pudo generar el código QR. Intenta de nuevo.');
    } finally {
      if (qrRequestId.current === requestId) setQrLoading(false);
    }
  }

  function detailsHaveUnsavedChanges() {
    return detailTable !== null && draft !== null && draft.table?.id === detailTable.id
      && (draft.name.trim() !== detailTable.name || draft.active !== detailTable.active);
  }

  function closeDetails() {
    if (saving || detailsHaveUnsavedChanges()) return;
    qrRequestId.current++;
    setDetailTable(null);
    setDraft(null);
    setQrDataUrl('');
    setQrError('');
    setQrLoading(false);
  }

  function downloadQr() {
    if (!qrDataUrl || !detailTable) return;
    const safeName = detailTable.name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || detailTable.id;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `qr-${safeName}.png`;
    link.click();
  }

  function openEditor() {
    setDraft({ name: '', active: true });
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
        const updatedTable = { ...draft.table, name, active: draft.active };
        setDetailTable(updatedTable);
        setDraft({ table: updatedTable, name, active: draft.active });
        setTables(current => current.map(table => table.id === updatedTable.id ? updatedTable : table));
        setNotice(`Mesa ${name} actualizada.`);
        await load();
      } else {
        await service.createTable(name);
        setDraft(null);
        setNotice(`Mesa ${name} creada.`);
        await load();
      }
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
      if (cause instanceof ApiError && cause.code === 'TABLE_ALREADY_OPEN') {
        setError('');
        await Swal.fire({
          icon: 'info',
          title: 'La mesa ya tiene una sesión abierta',
          text: 'Actualizamos la lista de mesas y sesiones para mostrar su estado actual.',
          confirmButtonText: 'Entendido',
          confirmButtonColor: '#6F4E37',
        });
        await load();
        return;
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
  const detailSession = detailTable ? sessionsByTable.get(detailTable.id) : undefined;
  const detailHasChanges = detailsHaveUnsavedChanges();

  return <section className="admin-module tables-admin" aria-label="Mesas y sesiones">
    <div className="flex align-items-center justify-content-between flex-wrap gap-2">
      <div>
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
    <div className="admin-table-card">
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
          <Button label="Abrir mesa" icon="pi pi-external-link" severity="secondary" outlined
            onClick={() => openTable(table)} />
          <Button label="Detalles" icon="pi pi-info-circle" severity="secondary" outlined
            onClick={() => void showDetails(table)} />
          {item
            ? <>
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
    </div>
    <Dialog
      visible={draft !== null && !draft.table}
      header="Nueva mesa"
      modal
      className="w-11 md:w-7 lg:w-5"
      contentStyle={{ maxHeight: '75vh', overflow: 'auto' }}
      onHide={() => !saving && setDraft(null)}
      footer={<div className="flex justify-content-end gap-2">
        <Button label="Cancelar" severity="secondary" outlined disabled={saving} onClick={() => setDraft(null)} />
        <Button label="Guardar" icon="pi pi-check" loading={saving} onClick={() => void saveTable()} />
      </div>}
    >
      {draft && !draft.table && <div className="p-fluid flex flex-column gap-3">
        {formError && <Message severity="error" text={formError} />}
        <div className="field">
          <label htmlFor="new-table-name">Nombre *</label>
          <InputText id="new-table-name" value={draft.name} maxLength={100} invalid={Boolean(formError)}
            aria-describedby={formError ? 'table-form-error' : undefined}
            onChange={event => setDraft(current => current ? { ...current, name: event.target.value } : current)} />
        </div>
        {formError && <small id="table-form-error" role="alert">{formError}</small>}
      </div>}
    </Dialog>
    <Dialog
      visible={detailTable !== null}
      header={detailTable ? `Detalles de ${detailTable.name}` : 'Detalles de mesa'}
      modal
      className="w-11 md:w-8 lg:w-6"
      contentStyle={{ maxHeight: '78vh', overflow: 'auto' }}
      onHide={() => !saving && closeDetails()}
      footer={<div className="flex justify-content-end gap-2 flex-wrap">
        {isAdmin && detailHasChanges && detailTable && (
          <Button label="Descartar cambios" severity="secondary" outlined disabled={saving} onClick={() => {
            setDraft({ table: detailTable, name: detailTable.name, active: detailTable.active });
            setFormError('');
          }} />
        )}
        <Button label="Cerrar" severity="secondary" outlined disabled={saving || detailHasChanges} onClick={closeDetails} />
        {canAccessCash && detailTable && sessionsByTable.has(detailTable.id) && (
          <Button label="Ver cuenta en Caja" icon="pi pi-wallet" onClick={() => {
            const openedSession = sessionsByTable.get(detailTable.id);
            if (!openedSession) return;
            closeDetails();
            navigate('/admin/dashboard', { state: { cashSessionId: openedSession.id } });
          }} disabled={saving || detailHasChanges} />
        )}
        <Button label="Descargar QR" icon="pi pi-download" onClick={downloadQr}
          disabled={!qrDataUrl || qrLoading} loading={qrLoading} />
        {isAdmin && detailTable && draft?.table?.id === detailTable.id && (
          <Button label="Guardar cambios" icon="pi pi-check" onClick={() => void saveTable()}
            disabled={!detailHasChanges || saving} loading={saving} />
        )}
      </div>}
    >
      {detailTable && <div className="grid">
        <div className="col-12 md:col-6">
          <h3 className="mt-0 mb-2">Información de la mesa</h3>
          <dl className="grid m-0">
            <dt className="col-5 font-semibold">Estado</dt>
            <dd className="col-7 m-0">
              <Tag value={statusLabels[detailTable.status]} severity={
                detailTable.status === 'available' ? 'success' : detailTable.status === 'occupied' ? 'warning' : 'secondary'
              } />
            </dd>
            {!isAdmin && <>
              <dt className="col-5 font-semibold">Código QR</dt>
              <dd className="col-7 m-0">{detailTable.active ? 'Activo' : 'Inactivo'}</dd>
            </>}
            <dt className="col-5 font-semibold">Sesión</dt>
            <dd className="col-7 m-0">
              {detailSession?.id.slice(0, 8) ?? 'Sin sesión abierta'}
            </dd>
            <dt className="col-5 font-semibold">Abierta</dt>
            <dd className="col-7 m-0">
              {detailSession ? new Date(detailSession.openedAt).toLocaleString('es-SV') : '—'}
            </dd>
          </dl>
          {isAdmin && draft?.table?.id === detailTable.id && (
            <div className="p-fluid flex flex-column gap-3 mt-4">
              <div className="field">
                <label htmlFor="detail-table-name">Nombre de la mesa *</label>
                <InputText id="detail-table-name" value={draft.name} maxLength={100}
                  invalid={Boolean(formError)} aria-describedby={formError ? 'table-details-error' : undefined}
                  disabled={saving}
                  onChange={event => {
                    setFormError('');
                    setDraft(current => current?.table ? { ...current, name: event.target.value } : current);
                  }} />
              </div>
              <div className="flex align-items-center gap-2">
                <InputSwitch inputId="detail-table-active" checked={draft.active}
                  disabled={saving || Boolean(detailSession)}
                  onChange={event => {
                    if (!event.value && detailSession) {
                      setFormError('Cierra primero la sesión abierta antes de desactivar esta mesa.');
                      return;
                    }
                    setFormError('');
                    setDraft(current => current?.table ? { ...current, active: event.value } : current);
                  }} />
                <label htmlFor="detail-table-active">QR activo</label>
              </div>
              {detailSession && <small>Cierra la sesión abierta antes de desactivar el QR.</small>}
              {formError && <small id="table-details-error" role="alert">{formError}</small>}
              {detailHasChanges && <small>Guarda los cambios o descártalos antes de cerrar o ir a Caja.</small>}
            </div>
          )}
          {!detailTable.active && <Message severity="warn" text="Esta mesa está inactiva y su QR no permite iniciar pedidos." />}
          {canAccessCash && !sessionsByTable.has(detailTable.id) && (
            <Message severity="info" text="Abre una sesión para consultar una cuenta en Caja." />
          )}
        </div>
        <div className="col-12 md:col-6 flex flex-column align-items-center gap-3 text-center">
          <h3 className="mt-0 mb-0">Código QR</h3>
          <p className="m-0">Escanea este código para abrir la mesa desde un celular.</p>
          {qrLoading && <Message severity="info" text="Generando código QR…" />}
          {qrError && <Message severity="error" text={qrError} />}
          {qrDataUrl && <img src={qrDataUrl} alt={`Código QR para abrir ${detailTable.name}`}
            width={256} height={256} style={{ maxWidth: '100%', height: 'auto' }} />}
          <a href={getTableUrl(detailTable.id)} target="_blank" rel="noopener noreferrer"
            style={{ overflowWrap: 'anywhere' }}>
            {getTableUrl(detailTable.id)}
          </a>
          {qrError && <Button label="Reintentar" icon="pi pi-refresh" text onClick={() => void generateQr(detailTable)} />}
        </div>
      </div>}
    </Dialog>
  </section>;
}
