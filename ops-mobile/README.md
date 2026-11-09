# OPTICLEAN Ops · Móvil

App **separada** solo para operación en piso: ingreso de productos (manual / QR) y guía de ubicación.

## Qué hace

- Buscar producto o escanear QR / código (SKU o id)
- Pedir a la API la mejor ubicación según:
  - familia de bodega
  - producto frágil (niveles bajos)
  - huecos vacíos y consolidación
- Confirmar recepción contra el backend de Opticlean

## Requisitos

1. Backend Opticlean en `http://localhost:3001`
2. Familias configuradas en web: `/familias`

## Arranque

```bash
cd opticlean-ops-mobile
npm install
npm run dev
```

Abre `http://localhost:5174` en el celular (misma red) o con DevTools device mode.

El proxy de Vite reenvía `/api` al backend.
