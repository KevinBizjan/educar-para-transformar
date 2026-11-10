// Pruebas de la configuración: la dirección del portal web sale de la misma que la API. Sin red.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Cada prueba importa el módulo con un parámetro distinto en la dirección para que Node lo evalúe de nuevo con la variable de entorno que le toca
const cargar = async (apiUrl) => {
    const anterior = process.env.EXPO_PUBLIC_API_URL;
    if (apiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = apiUrl;
    try {
        return await import(`../src/config.js?caso=${Math.random()}`);
    } finally {
        if (anterior === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = anterior;
    }
};

describe('Configuración de la app', () => {
    it('por defecto usa el servicio de Render, y el portal web es su pantalla de ingreso', async () => {
        const c = await cargar(undefined);
        assert.match(c.API_URL, /^https:\/\/.+\.onrender\.com$/);
        assert.equal(c.PORTAL_WEB_URL, `${c.API_URL}/login`);
    });

    it('con otra dirección (desarrollo local) el portal web sigue a la API y sin barras de más', async () => {
        const c = await cargar('http://192.168.0.10:3000///');
        assert.equal(c.API_URL, 'http://192.168.0.10:3000');
        assert.equal(c.PORTAL_WEB_URL, 'http://192.168.0.10:3000/login');
    });
});
