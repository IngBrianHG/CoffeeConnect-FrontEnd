import { useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Checkbox } from 'primereact/checkbox';
import { Column } from 'primereact/column';
import { confirmDialog, ConfirmDialog } from 'primereact/confirmdialog';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { Menu } from 'primereact/menu';
import { Message } from 'primereact/message';
import { MultiSelect } from 'primereact/multiselect';
import { Paginator, type PaginatorPageChangeEvent } from 'primereact/paginator';
import { Password } from 'primereact/password';
import { Skeleton } from 'primereact/skeleton';
import { TabPanel, TabView } from 'primereact/tabview';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { useNavigate } from 'react-router-dom';
import { APP_LOCALE, CALENDAR_DATE_FORMAT } from '../../config/primeReact';

const options = [
  { label: 'Activo', value: 'active' },
  { label: 'Inactivo', value: 'inactive' },
  { label: 'Pendiente', value: 'pending' },
];
const demoRows = [
  { id: 'CC-001', name: 'Café de la casa', status: 'Disponible' },
  { id: 'CC-002', name: 'Pan de elote', status: 'Bajo mínimo' },
  { id: 'CC-003', name: 'Chocolate caliente', status: 'Disponible' },
];

export function UiShowcase() {
  const navigate = useNavigate();
  const toast = useRef<Toast>(null);
  const menu = useRef<Menu>(null);
  const [text, setText] = useState('Coffee Connect');
  const [password, setPassword] = useState('');
  const [amount, setAmount] = useState<number | null>(12.5);
  const [dropdown, setDropdown] = useState<string | null>(null);
  const [multiselect, setMultiselect] = useState<string[]>([]);
  const [date, setDate] = useState<Date | null>(null);
  const [checked, setChecked] = useState(true);
  const [active, setActive] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [first, setFirst] = useState(0);
  const rows = [{ label: 'Abrir opción', icon: 'pi pi-external-link', command: () => toast.current?.show({ severity: 'info', summary: 'Menú', detail: 'Acción seleccionada' }) }];

  const showToast = () => toast.current?.show({
    severity: 'success',
    summary: 'Guardado',
    detail: 'Ejemplo de notificación',
    life: 3000,
  });

  return <main className="ui-showcase">
    <Toast ref={toast} />
    <ConfirmDialog />
    <header className="ui-showcase__header">
      <div>
        <span className="login-card__eyebrow">Solo desarrollo · PrimeReact 10</span>
        <h1>Galería de componentes</h1>
        <p>Referencia para revisar estilos, estados, dimensiones y comportamiento responsive.</p>
      </div>
      <Button label="Volver al inicio" icon="pi pi-arrow-left" outlined onClick={() => navigate('/admin/login')} />
    </header>

    <TabView>
      <TabPanel header="Campos y estados">
        <section className="ui-showcase__section">
          <h2>Controles en flujo fluido</h2>
          <div className="ui-showcase__grid p-fluid">
            <label className="ui-showcase__field">InputText
              <InputText value={text} onChange={event => setText(event.target.value)} placeholder="Escribe un texto" />
            </label>
            <label className="ui-showcase__field">Password
              <Password className="w-full" inputClassName="w-full" value={password} onChange={event => setPassword(event.target.value)} toggleMask feedback={false} placeholder="Contraseña" />
            </label>
            <label className="ui-showcase__field">InputNumber · USD
              <InputNumber value={amount} onValueChange={event => setAmount(event.value ?? null)} locale={APP_LOCALE} mode="currency" currency="USD" />
            </label>
            <label className="ui-showcase__field">Dropdown
              <Dropdown value={dropdown} options={options} onChange={event => setDropdown(event.value)} placeholder="Selecciona un estado" />
            </label>
            <label className="ui-showcase__field">MultiSelect
              <MultiSelect value={multiselect} options={options} onChange={event => setMultiselect(event.value)} placeholder="Selecciona varios" display="chip" />
            </label>
            <label className="ui-showcase__field">Calendar · es-SV
              <Calendar value={date} onChange={event => setDate(event.value as Date | null)} dateFormat={CALENDAR_DATE_FORMAT} locale={APP_LOCALE} showIcon placeholder="dd/mm/aaaa" />
            </label>
          </div>
        </section>

        <section className="ui-showcase__section">
          <h2>Estados</h2>
          <div className="ui-showcase__grid p-fluid">
            <label className="ui-showcase__field">Deshabilitado
              <InputText disabled value="No editable" readOnly />
            </label>
            <label className="ui-showcase__field">Validación
              <InputText className="p-invalid" value="" onChange={() => undefined} placeholder="Campo con error" aria-invalid="true" aria-describedby="showcase-error" />
              <small id="showcase-error" className="p-error">Este campo es obligatorio.</small>
            </label>
            <div className="ui-showcase__field">Procesamiento
              <Button label={busy ? 'Procesando…' : 'Guardar ejemplo'} loading={busy} onClick={() => {
                setBusy(true);
                window.setTimeout(() => setBusy(false), 900);
              }} />
            </div>
          </div>
          <div className="ui-showcase__inline">
            <label htmlFor="showcase-checkbox">Checkbox</label>
            <Checkbox inputId="showcase-checkbox" checked={checked} onChange={event => setChecked(Boolean(event.checked))} />
            <Checkbox checked={false} disabled aria-label="Checkbox deshabilitado" />
            <label htmlFor="showcase-switch">InputSwitch</label>
            <InputSwitch inputId="showcase-switch" checked={active} onChange={event => setActive(event.value)} />
            <InputSwitch checked={false} disabled aria-label="Switch deshabilitado" />
          </div>
          <Message severity="error" text="Mensaje de validación" />
        </section>
      </TabPanel>

      <TabPanel header="Acciones y datos">
        <section className="ui-showcase__section">
          <h2>Button, Tag, Menu y Toast</h2>
          <div className="ui-showcase__inline">
            <Button label="Primario" icon="pi pi-check" onClick={showToast} />
            <Button label="Secundario" severity="secondary" outlined />
            <Button label="Deshabilitado" disabled />
            <Button label="Procesando" icon="pi pi-spin pi-spinner" disabled />
            <Tag value="Disponible" severity="success" />
            <Tag value="Atención" severity="warning" />
            <Menu model={rows} popup ref={menu} />
            <Button label="Acciones" icon="pi pi-chevron-down" outlined onClick={event => menu.current?.toggle(event)} />
            <Button label="Mostrar Toast" icon="pi pi-bell" text onClick={showToast} />
          </div>
        </section>
        <section className="ui-showcase__section">
          <h2>DataTable</h2>
          <DataTable value={demoRows} dataKey="id" size="small" stripedRows responsiveLayout="scroll">
            <Column field="id" header="Código" />
            <Column field="name" header="Producto" />
            <Column header="Estado" body={(row: typeof demoRows[number]) => <Tag value={row.status} severity={row.status === 'Disponible' ? 'success' : 'warning'} />} />
          </DataTable>
          <Paginator first={first} rows={5} totalRecords={24} onPageChange={(event: PaginatorPageChangeEvent) => setFirst(event.first)} />
        </section>
        <section className="ui-showcase__section">
          <h2>Skeleton</h2>
          <div className="ui-showcase__skeleton"><Skeleton width="5rem" height="2rem" /><Skeleton width="100%" height="2rem" /><Skeleton width="65%" height="2rem" /></div>
        </section>
      </TabPanel>

      <TabPanel header="Overlays">
        <section className="ui-showcase__section">
          <h2>Dialog y ConfirmDialog</h2>
          <div className="ui-showcase__inline">
            <Button label="Abrir Dialog" icon="pi pi-window-maximize" onClick={() => setDialog(true)} />
            <Button label="Confirmar acción" icon="pi pi-exclamation-triangle" severity="danger" outlined onClick={() => confirmDialog({
              header: 'Confirmación de ejemplo',
              message: 'Esta acción solo muestra el componente de confirmación.',
              acceptLabel: 'Aceptar',
              rejectLabel: 'Cancelar',
              accept: showToast,
            })} />
          </div>
          <Dialog header="Dialog de referencia" visible={dialog} modal className="ui-showcase__dialog" onHide={() => setDialog(false)}
            footer={<Button label="Cerrar" onClick={() => setDialog(false)} />}>
            <p>Diálogo PrimeReact con foco, Escape y scroll administrados por el componente.</p>
          </Dialog>
        </section>
      </TabPanel>
    </TabView>
  </main>;
}
