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

## Datos

El estado se persiste en `backend/data/state.json`. Usa **Configuración → Restablecer demo** para volver al seed inicial.

## Pruebas de negocio

```sh
cd backend
npm test
```
