# Coffee Connect — documentación técnica de transición

Esta carpeta centraliza el diagnóstico del sistema actual y la guía para desplegar la siguiente versión con React y Supabase.

## Documentos

- [Diagnóstico y alcance](01-diagnostico-y-alcance.md): qué existe, requisitos y módulos.
- [Arquitectura de datos y API](02-arquitectura-datos-api.md): contrato React → Supabase REST, modelo, catálogos y seguridad.
- [Plan de migración](03-plan-migracion.md): etapas, orden, criterios de salida y pruebas.
- [Despliegue y operación](04-despliegue-y-operacion.md): configuración mínima y checklist de producción.
- [Contratos de implementación del frontend](../contracts/README.md): fuente canónica para contratos paso a paso; ver [contrato 01 de autenticación](../contracts/01-autenticacion-y-sesion.md) y [contrato 02 de transporte/catálogo](../contracts/02-transporte-y-catalogo.md).
- [Contrato 03 de gestión de personal](../contracts/03-usuarios-y-roles.md): alta directa con contraseña inicial del backend, edición, activación/inactivación y eliminación vía Edge Function.
- [Contrato 04 de inventario y recetas](../contracts/04-inventario-y-recetas.md): ajustes por RPC y recetas atómicas.
- [Esquema PostgreSQL](sql/001_supabase_schema.sql): base nueva, RLS, catálogos, tablas y RPC transaccionales.

## Decisión ejecutiva

Mantener React + TypeScript + Vite; el frontend existente ya está construido en esa base. Migrar la persistencia y autenticación de MySQL/Express/JWT a Supabase Auth + PostgreSQL/PostgREST. El contrato inicial permite consumir Supabase con `fetch` nativo y una capa propia de servicios/adaptadores, sin SDK de Supabase ni ORM, para no acoplar componentes al proveedor.

Los flujos con varias escrituras o invariantes —confirmación/cancelación de pedidos, movimientos de inventario y cobro parcial— deben ejecutarse como funciones PostgreSQL expuestas por `/rest/v1/rpc/...`; nunca como una secuencia de peticiones independientes desde React. Las funciones incluidas en el SQL cubren los flujos críticos de stock y cobro.

## Archivos Markdown existentes revisados

- `CAMBIOS_AUDITORIA_APLICADOS.md`: endurecimiento de la API MySQL, pruebas existentes y pendientes de producción.
- `CAMBIOS_COMENTARIOS_Y_PROMOCIONES.md`: notas por producto, promociones NxM/porcentaje y cálculo de precio en servidor.
- `CAMBIOS_INVENTARIO_RECETAS.md`: receta por porción, stock compartido, cancelación y movimientos asociados.
- `DEPLOYMENT_README_ES.md`: despliegue original del backend Express/MySQL y riesgos previos a producción.
- `TODO.md`: checklist histórico del kiosco; algunos puntos ya quedaron superados por los cambios descritos en otros documentos.
- `frontend/README.md`: README de plantilla React/Vite, no documentación funcional del negocio.

Los documentos originales describen MySQL y JWT propios; no deben tomarse como instrucciones de configuración de Supabase. El `TODO.md` es histórico. Este plan define el estado destino.

## Alcance que se conserva

Kiosco QR, menú y categorías, carrito con comentarios, promociones, POS, mesas, cola/estado de pedidos, cobros, reportes, usuarios/roles, inventario, recetas y disponibilidad. Cambian los identificadores (MySQL enteros → UUID), la autenticación y el contrato de acceso a datos.

## Antes de cortar al sistema anterior

1. Crear un proyecto Supabase separado para pruebas y aplicar el SQL.
2. Importar y reconciliar los datos; el script crea el esquema, no migra datos de MySQL.
3. Completar y probar el cálculo server-side de promociones (el esquema conserva el catálogo y los snapshots de descuento; la RPC base no aplica aún promociones).
4. Probar RLS con perfiles admin/cashier/waiter, además de anon en el kiosco.
5. No apagar MySQL/Express hasta conciliar inventario, pedidos abiertos, pagos y totales.
