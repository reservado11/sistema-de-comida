# Sistema de Ventas para Local de Comida

Sistema de punto de venta (POS) para un local de comidas. Incluye acceso por usuario y permisos para administradora y empleados.

Funciones:
- Toma de pedidos (mostrador, mesa o domicilio) y cálculo automático de totales
- Notas por producto (ej. "sin cebolla") y notas generales del pedido, visibles en pedidos abiertos, ventas y factura
- Domicilios con nombre, teléfono, dirección y valor del domicilio (se suma al total y se reporta aparte)
- Pagos combinados: un pedido se puede pagar con varios métodos a la vez (ej. parte en efectivo y parte por Nequi)
- Gestión de mesas (libre / ocupada)
- Inventario de ingredientes con descuento automático al vender
- Reportes por día o por rango (por defecto, el día de hoy), con ventas por método de pago y por tipo de pedido
- Cierre diario con cuadre de caja e historial de cierres

No necesita internet ni servicios pagos: corre en tu propia computadora.

---

## 1. Requisitos

Instalar **Node.js** (una sola vez): https://nodejs.org (descarga la versión "LTS" y sigue el instalador, es como instalar cualquier programa).

Para comprobar que quedó instalado, abre una terminal (o "Símbolo del sistema" en Windows) y escribe:

```
node -v
```

Si te muestra un número de versión (ej: v20.11.0), quedó listo.

## 2. Instalación (una sola vez)

1. Descomprime esta carpeta `pos-comida` donde quieras (por ejemplo, en el Escritorio).
2. Abre una terminal DENTRO de esa carpeta:
   - Windows: entra a la carpeta, escribe `cmd` en la barra de direcciones y presiona Enter.
   - Mac: clic derecho en la carpeta > "Nueva Terminal en la carpeta" (o usa `cd` para entrar).
3. Escribe este comando y espera a que termine (descarga las piezas necesarias, solo pasa una vez):

```
npm install
```

## 3. Primer inicio de sesión

1. Ejecuta `npm start` y abre `http://localhost:3000`.
2. La primera vez aparecerá el formulario para crear la cuenta administradora. Define un usuario y una contraseña de mínimo 8 caracteres.
3. Después de crearla, el sistema mostrará el programa. La cuenta inicial solo se puede crear una vez; las demás se crean desde la sección **Usuarios**.
4. Desde **Usuarios**, la administradora puede crear cuentas de empleados o administradores y activar/desactivar cuentas.

Las contraseñas se guardan como hashes derivados con `scrypt` y la sesión utiliza una cookie `HttpOnly`. Los empleados pueden operar pedidos, mientras que la administración de productos, ingredientes, reportes y cuentas está reservada a la administradora.

**Importante:** el sistema sigue guardando los datos en `data/db.json`, como se solicitó. Está pensado para un solo local y uso controlado; JSON no es ideal para múltiples escrituras simultáneas o despliegue público. Haz copias de seguridad de ese archivo y no expongas el servidor directamente a internet.

## 4. Usar el sistema cada día

Dentro de la carpeta, escribe:

```
npm start
```

Vas a ver un mensaje como:
```
Sistema de ventas corriendo en: http://localhost:3000
```

Abre tu navegador (Chrome, Edge, etc.) y entra a:

```
http://localhost:3000
```

¡Listo! Ya puedes usar el sistema. Para apagarlo, cierra la terminal o presiona `Ctrl + C`.

### Usarlo desde una tablet o celular (mismo local)

1. Asegúrate de que la tablet/celular esté conectado al MISMO WiFi que la computadora donde corre el sistema.
2. En la computadora, busca su IP local (Windows: `ipconfig`, busca "Dirección IPv4"; Mac: `ifconfig | grep inet`).
3. En la tablet, abre el navegador y entra a algo como: `http://192.168.1.5:3000` (usando la IP que encontraste).

## 5. ¿Dónde se guardan mis datos?

Todo se guarda automáticamente en el archivo:
```
data/db.json
```
Recomendación: haz copia de seguridad de ese archivo de vez en cuando (cópialo a una USB o a Google Drive), así nunca pierdes tu información de ventas.

## 6. Cómo funciona cada sección

- **Nuevo Pedido**: elige el tipo (mostrador, mesa, domicilio), toca los productos para agregarlos al carrito, ajusta cantidades y crea el pedido.
- **Mesas**: ve el estado de cada mesa (libre/ocupada) y agrega mesas nuevas.
- **Pedidos Abiertos**: aquí ves todos los pedidos en curso con sus notas y datos de entrega; puedes cobrarlos (esto descuenta el inventario automáticamente si configuraste recetas) o cancelarlos. Un pedido ya pagado no se puede cancelar.
- **Cobro**: en la ventana de pago puedes usar un solo método o pulsar "Combinar con otro método" para repartir el total. El botón de confirmar se habilita cuando lo recibido cubre el total; el cambio se calcula solo sobre el efectivo.
- **Ventas**: lista de ventas con su método de pago; desde ahí se puede ver e imprimir la factura de nuevo.
- **Cierre diario**: muestra las ventas pendientes de cierre por método de pago y tipo de pedido. Escribe la base inicial de caja y el efectivo contado: el sistema calcula el efectivo esperado y la diferencia (sobrante o faltante). Al cerrar, esas ventas quedan archivadas y no se cuentan en el siguiente cierre. Si hay pedidos abiertos sin pagar, el sistema avisa antes de cerrar. Cualquier usuario puede hacer el cierre; el **historial de cierres** lo ve solo la administradora.
- **Menú**: agrega, edita o elimina los productos que vendes, con su precio y costo.
- **Inventario**: registra tus ingredientes con su stock actual y mínimo. El sistema te avisa cuando algo está por acabarse.
- **Reportes**: abre por defecto con el día de hoy; usa los botones Hoy, Ayer, Últimos 7 días o Este mes, o elige las fechas. Muestra ventas totales, ticket promedio, domicilios cobrados, ventas por método de pago, por tipo y por día, productos más vendidos y alertas de inventario.

## 7. Zona horaria

Los reportes y cierres agrupan las ventas por día usando la zona horaria del negocio (por defecto `America/Bogota`), no la hora UTC. Así una venta de las 8:00 p. m. cuenta en el día correcto. Si tu local está en otra zona, inícialo así:

```
POS_TIMEZONE=America/Mexico_City npm start        (Mac/Linux)
set POS_TIMEZONE=America/Mexico_City && npm start  (Windows, cmd)
```

## 8. Vincular ingredientes a productos (opcional, avanzado)

Por ahora, para que el inventario se descuente automáticamente al vender, necesitas editar el archivo `data/db.json` y agregar la "receta" de cada producto (qué ingredientes usa y en qué cantidad). Si quieres, puedo ayudarte a agregar una pantalla para hacer esto desde el navegador, sin tocar archivos — solo dímelo.

## 9. ¿Y si quiero algo más avanzado en el futuro?

Este sistema está pensado para 1 local con pocos usuarios simultáneos. Si tu negocio crece (varias sedes, muchos cajeros a la vez, necesitas facturación electrónica, etc.), se puede migrar a una base de datos más robusta sin perder tus datos actuales. Avísame cuando llegues ahí.
