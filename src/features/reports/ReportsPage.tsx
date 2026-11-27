import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dropdown } from 'primereact/dropdown';
import { Message } from 'primereact/message';
import { Tag } from 'primereact/tag';
import { TabPanel, TabView } from 'primereact/tabview';
import { useAuth } from '../../auth/AuthContext';
import { APP_LOCALE, CALENDAR_DATE_FORMAT, formatCurrency } from '../../config/primeReact';
import { cafeTablesErrorMessage, createCafeTablesService, type CafeTable } from '../../services/cafeTables';
import { ApiError, httpClient } from '../../services/http/client';
import { createReportService, type SalesReport } from './reportService';
import './reports.css';

const today = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
};
const dateValue = (value: Date | null) => value
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : '';
const orderStatusLabels = {
  pending: 'Pendiente', confirmed: 'Confirmada', preparing: 'Preparando',
  ready: 'Lista', served: 'Entregada', cancelled: 'Cancelada',
};

type ReportMetricProps = {
  label: string;
  value: string | number;
  detail: string;
  icon: string;
  tone: 'brand' | 'success' | 'warning' | 'info';
};

function ReportMetric({ label, value, detail, icon, tone }: ReportMetricProps) {
  return <article className={`reports-page__metric reports-page__metric--${tone}`}>
    <div className="reports-page__metric-heading">
      <span>{label}</span>
      <i className={`pi ${icon}`} aria-hidden="true" />
    </div>
    <strong className="reports-page__metric-value">{value}</strong>
    <small>{detail}</small>
  </article>;
}

export function ReportsPage() {
  const { session, refreshSession, signOut } = useAuth();
  const token = useRef(session?.accessToken);
  token.current = session?.accessToken;
  const reportRequestId = useRef(0);
  const reportController = useRef<AbortController | null>(null);
  const reportService = useMemo(() => createReportService(httpClient, () => token.current, async () => {
    const refreshed = await refreshSession().catch(() => null);
    token.current = refreshed?.accessToken;
    return refreshed?.accessToken ?? null;
  }), [refreshSession]);
  const tablesService = useMemo(() => createCafeTablesService(httpClient, () => token.current, async () => {
    const refreshed = await refreshSession().catch(() => null);
    token.current = refreshed?.accessToken;
    return refreshed?.accessToken ?? null;
  }), [refreshSession]);
  const [dateRange, setDateRange] = useState<Date[] | null>(() => {
    const current = parseDate(today());
    return current ? [current, new Date(current)] : null;
  });
  const [tableId, setTableId] = useState<string | null>(null);
  const [tables, setTables] = useState<CafeTable[]>([]);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tablesError, setTablesError] = useState('');
  const from = dateRange?.[0] ? dateValue(dateRange[0]) : '';
  const to = dateRange?.[1] ? dateValue(dateRange[1]) : '';

  const loadTables = useCallback(async () => {
    try {
      setTables(await tablesService.listTables());
      setTablesError('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) await signOut();
      setTablesError(cafeTablesErrorMessage(cause));
    }
  }, [signOut, tablesService]);

  const generate = useCallback(async () => {
    reportController.current?.abort();
    const requestId = ++reportRequestId.current;
    if (!from || !to) {
      setLoading(false);
      setReport(null);
      setError('');
      return;
    }
    const controller = new AbortController();
    reportController.current = controller;
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const result = await reportService.getSalesReport({
        from, to, timezone: 'America/El_Salvador', tableId, signal: controller.signal,
      });
      if (requestId !== reportRequestId.current) return;
      setReport(result);
    } catch (cause) {
      if (requestId !== reportRequestId.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        await signOut();
      }
      setError(cause instanceof ApiError && ['FORBIDDEN', '42501'].includes(cause.code ?? '')
        ? 'No tienes permiso para consultar reportes.'
        : cause instanceof ApiError && cause.code === 'INVALID_REPORT_FILTER'
          ? 'El período no es válido. Selecciona un rango de hasta 366 días.'
          : 'No se pudo generar el reporte. Intenta actualizar o verifica la conexión.');
    } finally {
      if (requestId === reportRequestId.current) {
        setLoading(false);
        reportController.current = null;
      }
    }
  }, [from, reportService, signOut, tableId, to]);

  useEffect(() => {
    void loadTables();
    void generate();
    return () => {
      reportRequestId.current += 1;
      reportController.current?.abort();
    };
  }, [generate, loadTables]);

  const methodLabels = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };
  const tableOptions = [{ label: 'Todas las mesas', value: null }, ...tables.map(table => ({ label: table.name, value: table.id }))];
  const activeDaysCount = report
    ? new Set([
      ...report.sales_by_day.map(item => item.date),
      ...report.collections_by_day.map(item => item.date),
    ]).size
    : 0;

  return <section className="admin-module reports-page" aria-label="Reportes">
    <header className="reports-page__header">
      <div>
        <p className="mt-0 mb-0">Órdenes y ventas por fecha de pedido · America/El_Salvador</p>
      </div>
      <Button icon="pi pi-refresh" aria-label="Actualizar reporte" tooltip="Actualizar reporte"
        severity="secondary" outlined loading={loading} disabled={loading || !from || !to}
        onClick={() => { void loadTables(); void generate(); }} />
    </header>
    {error && <Message severity="error" text={error} />}
    {tablesError && <Message severity="warn" text={`No se pudieron cargar las mesas. ${tablesError}`} />}
    <div className="reports-page__filter-panel">
      <div className="reports-page__filter">
        <label htmlFor="report-date-range">Período</label>
        <Calendar inputId="report-date-range" value={dateRange} selectionMode="range"
          onChange={event => setDateRange(event.value as Date[] | null)}
          dateFormat={CALENDAR_DATE_FORMAT} locale={APP_LOCALE} showIcon className="w-full" />
      </div>
      <div className="reports-page__filter">
        <label htmlFor="report-table">Mesa</label>
        <Dropdown inputId="report-table" value={tableId} options={tableOptions} optionLabel="label" optionValue="value"
          onChange={event => setTableId(event.value)} className="w-full" />
      </div>
    </div>
    {loading && !report && <div role="status" className="p-3">Cargando el reporte completo…</div>}
    {report && <TabView className="admin-section-tabs">
      <TabPanel header={<><i className="pi pi-receipt" aria-hidden="true" /> Órdenes</>}>
        <section className="reports-page__tab-content" aria-labelledby="report-orders-heading">
          <div className="reports-page__section-heading">
            <div>
              <span className="reports-page__eyebrow">OPERACIÓN</span>
              <h3 id="report-orders-heading">Órdenes y cobros</h3>
              <p>Seguimiento de lo entregado, lo cobrado y el saldo pendiente.</p>
            </div>
            <Tag value={`${report.orders.length} órdenes`} severity="info" />
          </div>
          <div className="reports-page__metric-grid">
            <ReportMetric label="Órdenes del período" value={report.orders_summary.order_count}
              detail="Incluye órdenes en todos sus estados" icon="pi pi-receipt" tone="brand" />
            <ReportMetric label="Cobrado" value={formatCurrency(report.orders_summary.charged_total)}
              detail="Aplicado a órdenes entregadas" icon="pi pi-check-circle" tone="success" />
            <ReportMetric label="Pendiente de cobro" value={formatCurrency(report.orders_summary.pending_total)}
              detail="Saldo de órdenes entregadas" icon="pi pi-clock" tone="warning" />
          </div>
          <div className="reports-page__data-card">
            <div className="reports-page__data-heading">
              <div>
                <h4>Detalle de órdenes</h4>
                <p>Consulta estado, mesa e importes; usa la paginación para recorrer los resultados.</p>
              </div>
            </div>
            <DataTable value={report.orders} dataKey="order_id" size="small" stripedRows responsiveLayout="scroll"
              scrollable scrollHeight="480px" paginator rows={10} rowsPerPageOptions={[10, 20, 50]}
              paginatorPosition="bottom" className="reports-page__orders-table"
              emptyMessage="No hay órdenes para este período.">
              <Column field="table_name" header="Mesa" />
              <Column field="created_at" header="Hora" body={(row: SalesReport['orders'][number]) =>
                new Date(row.created_at).toLocaleString('es-SV', {
                  timeZone: 'America/El_Salvador', dateStyle: 'short', timeStyle: 'short',
                })} />
              <Column field="status" header="Estado" body={(row: SalesReport['orders'][number]) =>
                <Tag value={orderStatusLabels[row.status]}
                  severity={row.status === 'served' ? 'success' : row.status === 'cancelled' ? 'danger' : row.status === 'pending' ? 'warning' : 'info'} />} />
              <Column field="payment_status" header="Cobro" body={(row: SalesReport['orders'][number]) =>
                row.status === 'cancelled' ? 'Cancelada' : row.status !== 'served' ? 'No cobrable aún'
                  : row.payment_status === 'paid' ? 'Pagada'
                    : row.payment_status === 'partial' ? 'Pago parcial' : 'Sin pago'} />
              <Column field="total" header="Total" body={(row: SalesReport['orders'][number]) => formatCurrency(row.total)} />
              <Column field="charged_total" header="Cobrado" body={(row: SalesReport['orders'][number]) => formatCurrency(row.charged_total)} />
              <Column field="pending_total" header="Pendiente" body={(row: SalesReport['orders'][number]) => formatCurrency(row.pending_total)} />
            </DataTable>
          </div>
        </section>
      </TabPanel>
      <TabPanel header={<><i className="pi pi-chart-bar" aria-hidden="true" /> Ventas por producto</>}>
        <section className="reports-page__tab-content" aria-labelledby="report-products-heading">
          <div className="reports-page__section-heading">
            <div>
              <span className="reports-page__eyebrow">RENDIMIENTO</span>
              <h3 id="report-products-heading">Ventas por producto</h3>
              <p>Productos ordenados por venta neta en el período seleccionado.</p>
            </div>
            <Tag value={`${report.products.length} productos`} severity="info" />
          </div>
          <div className="reports-page__metric-grid">
            <ReportMetric label="Venta neta" value={formatCurrency(report.sales.total)}
              detail="Órdenes entregadas" icon="pi pi-chart-line" tone="brand" />
            <ReportMetric label="Unidades vendidas"
              value={report.products.reduce((total, product) => total + product.quantity, 0)}
              detail="Suma de cantidades por producto" icon="pi pi-box" tone="success" />
            <ReportMetric label="Productos distintos" value={report.products.length}
              detail="Con ventas en este período" icon="pi pi-tags" tone="info" />
          </div>
          <div className="reports-page__data-card">
            <div className="reports-page__data-heading">
              <div>
                <h4>Desglose de productos</h4>
                <p>Compara unidades, descuentos y venta neta por producto.</p>
              </div>
            </div>
            <DataTable value={report.products} dataKey="product_name" size="small" stripedRows responsiveLayout="scroll"
              emptyMessage="Sin productos vendidos en este período.">
              <Column field="product_name" header="Producto" />
              <Column field="quantity" header="Unidades" />
              <Column header="Venta bruta" body={(row: SalesReport['products'][number]) => formatCurrency(row.gross_total)} />
              <Column header="Descuentos" body={(row: SalesReport['products'][number]) => formatCurrency(row.discount_total)} />
              <Column header="Venta neta" body={(row: SalesReport['products'][number]) =>
                <strong className="reports-page__table-emphasis">{formatCurrency(row.sales_total)}</strong>} />
            </DataTable>
          </div>
        </section>
      </TabPanel>
      <TabPanel header={<><i className="pi pi-chart-line" aria-hidden="true" /> Resumen</>}>
        <section className="reports-page__tab-content" aria-labelledby="report-summary-heading">
          <div className="reports-page__section-heading">
            <div>
              <span className="reports-page__eyebrow">CONSOLIDADO</span>
              <h3 id="report-summary-heading">Resumen del período</h3>
              <p>Ventas y cobros se agrupan por sus respectivas fechas de registro.</p>
            </div>
          </div>
          <div className="reports-page__metric-grid reports-page__metric-grid--four">
            <ReportMetric label="Venta neta" value={formatCurrency(report.sales.total)}
              detail={`Bruto ${formatCurrency(report.sales.gross_total)}`}
              icon="pi pi-chart-line" tone="brand" />
            <ReportMetric label="Descuentos" value={formatCurrency(report.sales.discount_total)}
              detail="Aplicados en las ventas" icon="pi pi-tag" tone="warning" />
            <ReportMetric label="Cobros recibidos" value={formatCurrency(report.collections.total)}
              detail={`${report.collections.payment_count} pagos en el período`}
              icon="pi pi-wallet" tone="success" />
            <ReportMetric label="Días con actividad"
              value={activeDaysCount}
              detail={`${report.sales_by_day.length} días de venta · ${report.collections_by_day.length} días de cobro`}
              icon="pi pi-calendar" tone="info" />
          </div>
          <div className="reports-page__summary-panels">
            <section className="reports-page__summary-panel" aria-labelledby="report-tables-heading">
              <div className="reports-page__data-heading">
                <div>
                  <h4 id="report-tables-heading">Ventas por mesa</h4>
                  <p>Órdenes entregadas y venta neta.</p>
                </div>
              </div>
              <DataTable value={report.sales_by_table} dataKey="table_id" size="small" stripedRows responsiveLayout="scroll"
                emptyMessage="No hay ventas entregadas en este período.">
                <Column field="table_name" header="Mesa" />
                <Column field="orders" header="Órdenes" />
                <Column header="Descuentos" body={(row: SalesReport['sales_by_table'][number]) => formatCurrency(row.discount_total)} />
                <Column header="Venta" body={(row: SalesReport['sales_by_table'][number]) =>
                  <strong className="reports-page__table-emphasis">{formatCurrency(row.sales_total)}</strong>} />
              </DataTable>
            </section>
            <section className="reports-page__summary-panel" aria-labelledby="report-days-heading">
              <div className="reports-page__data-heading">
                <div>
                  <h4 id="report-days-heading">Actividad por día</h4>
                  <p>Ventas por fecha de entrega; cobros por fecha de pago.</p>
                </div>
              </div>
              <DataTable value={report.sales_by_day} dataKey="date" size="small" stripedRows responsiveLayout="scroll"
                emptyMessage="Sin ventas en el rango.">
                <Column field="date" header="Día" />
                <Column field="orders" header="Órdenes" />
                <Column header="Descuentos" body={(row: SalesReport['sales_by_day'][number]) => formatCurrency(row.discount_total)} />
                <Column header="Ventas" body={(row: SalesReport['sales_by_day'][number]) =>
                  <strong className="reports-page__table-emphasis">{formatCurrency(row.sales_total)}</strong>} />
                <Column header="Cobros" body={(row: SalesReport['sales_by_day'][number] | undefined) =>
                  formatCurrency(report.collections_by_day.find(item => item.date === row?.date)?.collected_total ?? 0)} />
              </DataTable>
            </section>
            <section className="reports-page__summary-panel reports-page__summary-panel--wide"
              aria-labelledby="report-methods-heading">
              <div className="reports-page__data-heading">
                <div>
                  <h4 id="report-methods-heading">Cobros por método de pago</h4>
                  <p>Importes registrados durante el período seleccionado.</p>
                </div>
              </div>
              <DataTable value={report.collections_by_method} dataKey="method" size="small" stripedRows responsiveLayout="scroll"
                emptyMessage="Sin cobros en el período.">
                <Column field="method" header="Método" body={(row: SalesReport['collections_by_method'][number]) => methodLabels[row.method]} />
                <Column field="payments" header="Pagos" />
                <Column header="Importe" body={(row: SalesReport['collections_by_method'][number]) =>
                  <strong className="reports-page__table-emphasis">{formatCurrency(row.collected_total)}</strong>} />
              </DataTable>
            </section>
          </div>
        </section>
      </TabPanel>
    </TabView>}
  </section>;
}
