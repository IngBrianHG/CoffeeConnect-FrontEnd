import { addLocale } from 'primereact/api';

export const APP_LOCALE = 'es-SV';
export const APP_CURRENCY = 'USD';
export const CALENDAR_DATE_FORMAT = 'dd/mm/yy';

addLocale(APP_LOCALE, {
  startsWith: 'Empieza con',
  contains: 'Contiene',
  notContains: 'No contiene',
  endsWith: 'Termina con',
  equals: 'Es igual a',
  notEquals: 'No es igual a',
  noFilter: 'Sin filtro',
  lt: 'Menor que',
  lte: 'Menor o igual que',
  gt: 'Mayor que',
  gte: 'Mayor o igual que',
  dateIs: 'La fecha es',
  dateIsNot: 'La fecha no es',
  dateBefore: 'Fecha anterior a',
  dateAfter: 'Fecha posterior a',
  clear: 'Limpiar',
  apply: 'Aplicar',
  matchAll: 'Coincidir con todos',
  matchAny: 'Coincidir con cualquiera',
  addRule: 'Agregar regla',
  removeRule: 'Quitar regla',
  accept: 'Sí',
  reject: 'No',
  choose: 'Seleccionar',
  upload: 'Subir',
  cancel: 'Cancelar',
  dayNames: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  dayNamesShort: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  dayNamesMin: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
  monthNames: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  monthNamesShort: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  today: 'Hoy',
  weekHeader: 'Sem',
  firstDayOfWeek: 1,
  dateFormat: CALENDAR_DATE_FORMAT,
});

export const formatCurrency = (value: number) => new Intl.NumberFormat(APP_LOCALE, {
  style: 'currency',
  currency: APP_CURRENCY,
}).format(value);
