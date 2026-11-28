# OPTICLEAN AI · Operaciones

Monorepo con **backend hexagonal** (Node.js + Express + TypeScript) y **frontend por features** (React + Vite + TypeScript).

Basado en la demo `opticlean-control`: inventario, bodega visual, recepciones, pedidos, logística, clientes, trazabilidad y reportes.

## Requisitos

- Node.js 18+

## Arranque rápido

```sh
# Terminal 1 — API (puerto 3001)
cd backend
npm install
npm run dev

# Terminal 2 — UI (puerto 5173)
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173`. El proxy de Vite reenvía `/api` al backend.

## Estructura

```
backend/src/
  domain/           # Entidades, reglas de negocio, servicios de dominio
  application/      # Casos de uso y puertos (hexagonal)
  infrastructure/   # Adaptadores: HTTP, persistencia JSON

frontend/src/
  app/              # Router y layout
  features/         # Un módulo por pantalla funcional
  shared/           # API, UI, hooks
```

## Usuarios y permisos

Contraseña demo: `OPTICLEAN_DEMO_PASSWORD` (por defecto `OptiClean2026!`). Ver `backend/.env.example`.

| Rol | Usuario demo | Puede |
|-----|--------------|-------|
| `admin` | admin@innovamf.com | Todo: configuración, bodegas, familias, flota, restablecer demo |
| `ops` | bodega@innovamf.com | Recepciones, traslados, productos, órdenes de compra, preparar y cancelar pedidos |
| `dispatch` | despacho@innovamf.com | Pedidos (crear/cancelar), clientes, preparar, despachar, autoasignación, entregas |
| `driver` | conductor@innovamf.com | Entregas e incidencias solo de pedidos cargados en su camión |

Todos los roles autenticados pueden consultar el estado. Los permisos se validan en el backend (`requireRole` en `server.ts`); el frontend solo oculta lo que el rol no puede usar.

## Datos

Por defecto el estado se persiste en archivos JSON (`backend/data/state.json`, uno por empresa). Usa **Configuración → Restablecer demo** para volver al seed inicial.

Con `DATABASE_URL` el estado de cada empresa vive en **PostgreSQL** (una fila JSONB por empresa, escritura con bloqueo de fila y copia diaria en `app_state_backup`):

```sh
cd backend
DATABASE_URL=postgres://user:pass@host:5432/opticlean npm run migrate:pg -- --dry-run   # ver qué se copiaría
DATABASE_URL=… npm run migrate:pg                                                       # copia los JSON existentes
```

Usuarios (`users.json`) y empresas/menú (`admin.db`) siguen en archivos de la carpeta `data/` de la raíz (se cambia con `OPTICLEAN_AUTH_DATA_DIR`, independiente de `OPTICLEAN_DATA_DIR`).

## Empaque y carga

En **Empaque** cada pedido preparado se reparte en bultos. El escáner (pistola USB/Bluetooth en la web; también la cámara en la app móvil, si el navegador la soporta) cuenta una unidad por lectura y reconoce el **código de barras** de la ficha del producto, el SKU o el código interno. Al cerrar el empaque se descargan las etiquetas (100×150 mm) y la lista de empaque en PDF, y la carga confirmada del camión es la que Logística despacha.

En **Reglas de negocio** se configuran las cajas, la tolerancia de peso, el llenado mínimo y si el despacho exige empaque.

## Facturación: RUC

El RUC se valida con su dígito verificador en producción (`NODE_ENV=production`) o con `OPTICLEAN_STRICT_RUC=1`. En desarrollo basta con 13 dígitos para no bloquear los datos demo.

## Pruebas de negocio

```sh
cd backend
npm test            # dominio + API HTTP (permisos por rol, multiempresa, endpoints)
TEST_DATABASE_URL=postgres://… npm run test:pg   # repositorio PostgreSQL (base desechable)
```
