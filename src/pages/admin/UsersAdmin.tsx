import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { confirmDialog, ConfirmDialog } from 'primereact/confirmdialog';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { useAuth } from '../../auth/AuthContext';
import { staffUsers, StaffUsersError, type StaffRole, type StaffUser } from '../../services/staffUsers';

const roleOptions = [
  { label: 'Mesero', value: 'waiter' },
  { label: 'Cajero', value: 'cashier' },
];
const roleLabel: Record<StaffRole, string> = { waiter: 'Mesero', cashier: 'Cajero' };

export function UsersAdmin() {
  const { session } = useAuth();
  const toast = useRef<Toast>(null);
  const actionMenu = useRef<Menu>(null);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<StaffRole | null>(null);
  const [statusFilter, setStatusFilter] = useState<boolean | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ email: '', displayName: '', role: 'waiter' as StaffRole });
  const [credentials, setCredentials] = useState<(StaffUser & { temporaryPassword: string }) | null>(null);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', role: 'waiter' as StaffRole });
  const [menuUser, setMenuUser] = useState<StaffUser | null>(null);

  const load = useCallback(async (next?: string | null) => {
    if (!session?.accessToken) return;
    setLoading(true);
    try {
      const page = await staffUsers.list(session.accessToken, { limit: 100, cursor: next ?? undefined });
      setUsers(current => next ? [...current, ...page.data] : page.data);
      setCursor(page.nextCursor);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el personal.');
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken]);

  useEffect(() => { void load(); }, [load]);
  const protectedUser = (user: StaffUser) => user.id === session?.user.id || (user.role as string) === 'admin';

  async function create() {
    setError('');
    if (!session?.accessToken) return setError('Inicia sesión nuevamente para administrar el personal.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) || !form.displayName.trim()) {
      return setError('Ingresa un correo válido y el nombre del empleado.');
    }
    setSaving(true);
    try {
      const result = await staffUsers.create(session.accessToken, form);
      const { temporaryPassword, ...staffUser } = result;
      setUsers(current => [staffUser, ...current]);
      setForm({ email: '', displayName: '', role: 'waiter' });
      setCreateOpen(false);
      setCredentials({ ...staffUser, temporaryPassword });
      await load();
    } catch (cause) {
      const message = cause instanceof StaffUsersError && cause.code === 'EMAIL_ALREADY_REGISTERED'
        ? 'Este correo ya está registrado.'
        : cause instanceof StaffUsersError && cause.status === 403
          ? 'No tienes permisos para crear empleados.'
          : cause instanceof Error ? cause.message : 'No se pudo crear el empleado.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function edit() {
    if (!editing || !session?.accessToken || !editForm.displayName.trim()) return;
    setSaving(true);
    try {
      await staffUsers.update(session.accessToken, editing.id, editForm);
      setEditing(null);
      await load();
      toast.current?.show({ severity: 'success', summary: 'Empleado actualizado', life: 2500 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el usuario.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(user: StaffUser) {
    if (!session?.accessToken || protectedUser(user) || busyUserId) return;
    const nextActive = !user.active;
    confirmDialog({
      header: nextActive ? 'Activar empleado' : 'Inactivar empleado',
      message: nextActive ? `¿Deseas reactivar el acceso de ${user.displayName}?` : `¿Deseas inactivar el acceso de ${user.displayName}?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: nextActive ? 'Activar' : 'Inactivar',
      rejectLabel: 'Cancelar',
      acceptClassName: nextActive ? '' : 'p-button-danger',
      accept: async () => {
        setBusyUserId(user.id);
        try {
          await staffUsers.setActive(session.accessToken!, user.id, nextActive);
          await load();
          toast.current?.show({ severity: 'success', summary: nextActive ? 'Empleado activado' : 'Empleado inactivado', life: 2500 });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el estado.');
        } finally {
          setBusyUserId(null);
        }
      },
    });
  }

  async function remove(user: StaffUser) {
    if (!session?.accessToken || protectedUser(user)) return;
    confirmDialog({
      header: '¿Eliminar empleado?',
      message: `Se eliminará permanentemente el acceso de ${user.displayName}.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        setBusyUserId(user.id);
        try {
          await staffUsers.delete(session.accessToken!, user.id);
          await load();
          toast.current?.show({ severity: 'success', summary: 'Empleado eliminado', life: 2500 });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el usuario.');
        } finally {
          setBusyUserId(null);
        }
      },
    });
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(`Nombre: ${credentials.displayName}\nCorreo: ${credentials.email}\nRol: ${roleLabel[credentials.role] ?? 'Administrador'}\nContraseña inicial: ${credentials.temporaryPassword}`);
      toast.current?.show({ severity: 'success', summary: 'Credenciales copiadas', life: 2500 });
    } catch {
      setError('No se pudo copiar automáticamente. Selecciona y copia las credenciales manualmente.');
    }
  }

  const filteredUsers = users.filter(user =>
    (!search || `${user.displayName} ${user.email}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))
    && (!roleFilter || user.role === roleFilter)
    && (statusFilter === null || user.active === statusFilter),
  );
  const actions: MenuItem[] = [
    { label: 'Editar', icon: 'pi pi-pencil', disabled: !menuUser || protectedUser(menuUser), command: () => {
      if (!menuUser) return;
      setEditing(menuUser);
      setEditForm({ displayName: menuUser.displayName, role: menuUser.role });
    } },
    { label: menuUser?.active ? 'Inactivar' : 'Activar', icon: 'pi pi-power-off', disabled: !menuUser || protectedUser(menuUser), command: () => { if (menuUser) void toggle(menuUser); } },
    { separator: true },
    { label: 'Eliminar', icon: 'pi pi-trash', className: 'p-menuitem-danger', disabled: !menuUser || protectedUser(menuUser), command: () => { if (menuUser) void remove(menuUser); } },
  ];
  const statusOptions = [
    { label: 'Todos los estados', value: null },
    { label: 'Activos', value: true },
    { label: 'Inactivos', value: false },
  ];

  return <section className="users-admin" aria-labelledby="users-heading">
    <Toast ref={toast} />
    <ConfirmDialog />
    <Menu model={actions} popup ref={actionMenu} />
    <header className="users-admin__header">
      <div><h2 id="users-heading"><i className="pi pi-users" aria-hidden="true" /> Cuentas del equipo</h2><p>Administra las cuentas, roles y acceso del personal.</p></div>
      <Button label="Registrar empleado" icon="pi pi-user-plus" onClick={() => { setError(''); setCreateOpen(true); }} />
    </header>
    {error && !createOpen && !editing && !credentials && <div className="users-admin__error" role="alert"><i className="pi pi-exclamation-triangle" /> <span>{error}</span><Button label="Reintentar" text onClick={() => void load()} /></div>}
    <div className="users-admin__filters">
      <span className="p-input-icon-left users-admin__search"><i className="pi pi-search" /><InputText value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre o correo" aria-label="Buscar personal" /></span>
      <Dropdown value={roleFilter} options={[{ label: 'Todos los roles', value: null }, ...roleOptions]} onChange={event => setRoleFilter(event.value)} aria-label="Filtrar por rol" />
      <Dropdown value={statusFilter} options={statusOptions} onChange={event => setStatusFilter(event.value)} aria-label="Filtrar por estado" />
    </div>
    <div className="users-admin__table">
      <DataTable value={filteredUsers} dataKey="id" size="small" stripedRows loading={loading && users.length === 0}
        emptyMessage={search || roleFilter || statusFilter !== null ? 'No hay usuarios que coincidan con los filtros.' : 'No hay usuarios registrados.'}
        responsiveLayout="scroll">
        <Column field="displayName" header="Empleado" body={(user: StaffUser) => <div className="users-admin__identity"><strong>{user.displayName}</strong><span>{user.email}</span></div>} />
        <Column field="role" header="Rol" body={(user: StaffUser) => (user.role as string) === 'admin' ? 'Administrador' : roleLabel[user.role]} />
        <Column field="active" header="Estado" body={(user: StaffUser) => <Tag value={user.active ? 'Activo' : 'Inactivo'} severity={user.active ? 'success' : 'secondary'} />} />
        <Column header="Acciones" body={(user: StaffUser) => <Button type="button" icon="pi pi-ellipsis-v" text rounded aria-label={`Acciones para ${user.displayName}`} disabled={busyUserId === user.id} onClick={event => {
          setMenuUser(user);
          actionMenu.current?.toggle(event);
        }} />} bodyClassName="users-admin__actions" />
      </DataTable>
    </div>
    <footer className="users-admin__table-footer"><span>{filteredUsers.length} de {users.length} usuarios cargados</span>
      {cursor && <Button label={loading ? 'Cargando…' : 'Cargar más personal'} icon={loading ? 'pi pi-spin pi-spinner' : 'pi pi-chevron-down'} outlined disabled={loading} onClick={() => void load(cursor)} />}
    </footer>

    <Dialog header="Registrar empleado" visible={createOpen} onHide={() => setCreateOpen(false)} className="users-admin__dialog" modal
      footer={<><Button label="Cancelar" severity="secondary" outlined onClick={() => setCreateOpen(false)} /><Button label={saving ? 'Creando…' : 'Crear empleado'} icon={saving ? 'pi pi-spin pi-spinner' : 'pi pi-check'} disabled={saving} onClick={() => void create()} /></>}>
      {error && <Message className="mb-3 w-full" severity="error" text={error} />}
      <p className="users-admin__dialog-hint">Se generará una contraseña temporal que se mostrará una sola vez.</p>
      <div className="users-admin__form">
        <label htmlFor="staff-email">Correo electrónico</label><InputText id="staff-email" type="email" autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
        <label htmlFor="staff-name">Nombre</label><InputText id="staff-name" value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} />
        <label htmlFor="staff-role">Rol</label><Dropdown inputId="staff-role" value={form.role} options={roleOptions} onChange={event => setForm({ ...form, role: event.value })} />
      </div>
    </Dialog>
    <Dialog header="Editar empleado" visible={Boolean(editing)} onHide={() => setEditing(null)} className="users-admin__dialog" modal
      footer={<><Button label="Cancelar" severity="secondary" outlined onClick={() => setEditing(null)} /><Button label={saving ? 'Guardando…' : 'Guardar cambios'} icon="pi pi-check" disabled={saving} onClick={() => void edit()} /></>}>
      {error && <Message className="mb-3 w-full" severity="error" text={error} />}
      <div className="users-admin__form">
        <label htmlFor="edit-staff-name">Nombre</label><InputText id="edit-staff-name" value={editForm.displayName} onChange={event => setEditForm({ ...editForm, displayName: event.target.value })} />
        <label htmlFor="edit-staff-role">Rol</label><Dropdown inputId="edit-staff-role" value={editForm.role} options={roleOptions} onChange={event => setEditForm({ ...editForm, role: event.value })} />
      </div>
    </Dialog>
    <Dialog header="Empleado registrado" visible={Boolean(credentials)} onHide={() => setCredentials(null)} className="users-admin__dialog" modal
      footer={<><Button label="Copiar credenciales" icon="pi pi-copy" outlined onClick={() => void copyCredentials()} /><Button label="Finalizar" onClick={() => setCredentials(null)} /></>}>
      {error && <Message className="mb-3 w-full" severity="error" text={error} />}
      {credentials && <><dl className="users-admin__credentials"><dt>Nombre</dt><dd>{credentials.displayName}</dd><dt>Correo</dt><dd>{credentials.email}</dd><dt>Rol</dt><dd>{roleLabel[credentials.role] ?? 'Administrador'}</dd><dt>Contraseña inicial</dt><dd><code>{credentials.temporaryPassword}</code></dd></dl><Message severity="warn" text="Comparte esta contraseña de forma segura; no volverá a mostrarse." /></>}
    </Dialog>
  </section>;
}
