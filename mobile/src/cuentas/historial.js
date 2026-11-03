// Lógica del historial de deudas y pagos (HU9): rangos de fechas, carga y enlaces a los PDF. Sin dependencias de React
// ni de Expo, para poder probarla con Node.
import { apiFetch } from '../api/client.js';
import { API_URL } from '../config.js';

export const RANGOS = [
    { id: 'mes', texto: 'Este mes' },
    { id: 'tres', texto: '3 meses' },
    { id: 'anio', texto: 'Este año' },
    { id: 'todo', texto: 'Todo' },
];

const dos = (n) => String(n).padStart(2, '0');
const fecha = (anio, mes, dia) => `${anio}-${dos(mes)}-${dos(dia)}`;

// Rango de fechas (AAAA-MM-DD) de cada opción rápida, tomando "hoy" del teléfono. Sin selector de fechas: cuatro
// opciones cubren lo que una familia consulta y no hay que escribir fechas.
export const rangoRapido = (id, hoy = new Date()) => {
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;
    const finHoy = fecha(anio, mes, hoy.getDate());
    if (id === 'mes') return { desde: fecha(anio, mes, 1), hasta: finHoy };
    if (id === 'tres') {
        const atras = mes - 2; // el mes actual y los dos anteriores
        return atras >= 1 ? { desde: fecha(anio, atras, 1), hasta: finHoy } : { desde: fecha(anio - 1, atras + 12, 1), hasta: finHoy };
    }
    if (id === 'anio') return { desde: fecha(anio, 1, 1), hasta: finHoy };
    return { desde: null, hasta: null }; // 'todo'
};

// "01/03/2026 al 15/05/2026", "Desde el 01/03/2026" o "Todo el historial"
export const describirRango = ({ desde, hasta }) => {
    const dia = (f) => f.split('-').reverse().join('/');
    if (desde && hasta) return `${dia(desde)} al ${dia(hasta)}`;
    if (desde) return `Desde el ${dia(desde)}`;
    if (hasta) return `Hasta el ${dia(hasta)}`;
    return 'Todo el historial';
};

// Arma "?a=1&b=2" con lo que tenga valor
const consulta = (parametros) => {
    const partes = Object.entries(parametros).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    return partes.length ? `?${partes.join('&')}` : '';
};

export const cargarHistorial = ({ desde, hasta }) => apiFetch(`/api/cuentas/historial${consulta({ desde, hasta })}`);

// El PDF no se puede abrir con el token de sesión desde el visor del teléfono: el servidor da un enlace temporal firmado.
// Devuelve la dirección completa lista para abrir.
export async function enlacePdf({ tipo, id, desde, hasta }) {
    const datos = await apiFetch(`/api/cuentas/pdf-enlace${consulta({ tipo, id, desde, hasta })}`);
    return `${API_URL}${datos.ruta}`;
}

// Filas del resumen de totales, listas para mostrar (el color lo decide la pantalla según `alerta`)
export const filasResumen = (resumen) => [
    { texto: 'Facturado', monto: resumen.total_facturado },
    { texto: 'Pagado', monto: resumen.total_pagado, bueno: true },
    { texto: 'Pendiente', monto: resumen.total_pendiente, alerta: resumen.total_pendiente > 0 },
    { texto: 'Rechazado', monto: resumen.total_rechazado },
].filter((f) => f.texto !== 'Rechazado' || f.monto > 0);

// Qué se muestra cuando no hay nada en el rango
export const mensajeHistorialVacio = ({ desde, hasta }) => (
    desde || hasta ? 'No hay facturas ni pagos en este período. Probá con un rango más amplio.' : 'Todavía no generaste ninguna factura.'
);
