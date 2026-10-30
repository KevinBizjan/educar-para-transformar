import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatearMonto } from '../familia/resumen.js';
import {
    FILTROS, cargarCuotas, obtenerEnCacheCuotas, agruparPorHijo, tituloCuota, etiquetaEstado, colorEstado,
    describirVencimiento, describirAbonado, describirPago, mensajeVacio, formatearMomento,
} from '../cuentas/cuotas.js';
import { estilos, colores } from './estilos.js';

// "Cuotas": las cuotas de los hijos con su importe y vencimiento, filtradas por pendientes, pagadas o historial de pagos.
// Lo último que se vio queda en caché para mostrarse al instante mientras se actualiza en segundo plano.
export default function CuotasScreen() {
    const [filtro, setFiltro] = useState('pendientes');
    const [datos, setDatos] = useState(() => obtenerEnCacheCuotas('pendientes'));
    const [cargando, setCargando] = useState(false);
    const [refrescando, setRefrescando] = useState(false);
    const [error, setError] = useState('');
    const pedidoActual = useRef(0); // una respuesta vieja no debe pisar la del filtro elegido después

    const cargar = useCallback(async (f, manual = false) => {
        const id = ++pedidoActual.current;
        const enCache = obtenerEnCacheCuotas(f);
        setError('');
        setDatos(enCache);
        if (manual) setRefrescando(true);
        else if (!enCache) setCargando(true);
        try {
            const nuevos = await cargarCuotas(f);
            if (id === pedidoActual.current) setDatos(nuevos);
        } catch (e) {
            if (id === pedidoActual.current) setError(e.message);
        } finally {
            if (id === pedidoActual.current) { setCargando(false); setRefrescando(false); }
        }
    }, []);

    useEffect(() => { cargar(filtro); }, [filtro, cargar]);

    const esHistorial = filtro === 'historial';
    const lista = datos ? (esHistorial ? datos.pagos : datos.cuotas) : null;

    return (
        <ScrollView
            contentContainerStyle={local.contenido}
            refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(filtro, true)} tintColor={colores.azul} />}
        >
            <Text style={estilos.titulo}>Cuotas</Text>
            <Text style={[estilos.subtitulo, { marginBottom: 12 }]}>Importes, vencimientos y pagos de tus hijos</Text>

            <View style={local.filtros}>
                {FILTROS.map((f) => (
                    <Pressable
                        key={f.id}
                        onPress={() => setFiltro(f.id)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: filtro === f.id }}
                        style={[local.filtro, filtro === f.id && local.filtroActivo]}
                    >
                        <Text style={[local.filtroTexto, filtro === f.id && local.filtroTextoActivo]}>{f.texto}</Text>
                    </Pressable>
                ))}
            </View>

            {!!error && (
                <View style={local.aviso}>
                    <Text style={local.avisoTexto}>{error}</Text>
                    <Pressable onPress={() => cargar(filtro)}><Text style={local.reintentar}>Reintentar</Text></Pressable>
                </View>
            )}

            {cargando && <ActivityIndicator size="large" color={colores.azul} style={{ marginTop: 32 }} />}

            {datos && !esHistorial && (
                <View style={[estilos.tarjeta, { marginBottom: 14 }]}>
                    <Text style={estilos.etiqueta}>Total pendiente</Text>
                    <Text style={[local.total, { color: datos.hay_deuda ? colores.error : colores.ok }]}>
                        {datos.hay_deuda ? formatearMonto(datos.total_pendiente) : 'Cuenta al día'}
                    </Text>
                </View>
            )}

            {datos && esHistorial && datos.pagos.length > 0 && (
                <View style={[estilos.tarjeta, { marginBottom: 14 }]}>
                    <Text style={estilos.etiqueta}>Total abonado</Text>
                    <Text style={[local.total, { color: colores.ok }]}>{formatearMonto(datos.total_pagado)}</Text>
                </View>
            )}

            {lista && lista.length === 0 && (
                <View style={estilos.tarjeta}>
                    <Text style={[estilos.texto, { textAlign: 'center' }]}>{mensajeVacio(filtro)}</Text>
                </View>
            )}

            {lista && !esHistorial && agruparPorHijo(lista).map((grupo) => (
                <View key={grupo.alumno_id} style={{ marginBottom: 6 }}>
                    <Text style={local.hijo}>{grupo.alumno}</Text>
                    {grupo.cuotas.map((c) => <TarjetaCuota key={c.cuota_id + '-' + c.alumno_id} cuota={c} />)}
                </View>
            ))}

            {lista && esHistorial && lista.map((p) => (
                <View key={p.id} style={[estilos.tarjeta, local.fila]}>
                    <View style={{ flex: 1 }}>
                        <Text style={local.cuota}>{p.alumno}</Text>
                        <Text style={local.detalle}>{describirPago(p)}</Text>
                        <Text style={local.detalle}>{formatearMomento(p.fecha_pago)}</Text>
                    </View>
                    <Text style={[local.monto, { color: colores.ok }]}>{formatearMonto(p.monto)}</Text>
                </View>
            ))}
        </ScrollView>
    );
}

function TarjetaCuota({ cuota }) {
    const color = colorEstado(cuota.estado);
    const abonado = describirAbonado(cuota, formatearMonto);
    return (
        <View style={[estilos.tarjeta, local.fila]}>
            <View style={{ flex: 1 }}>
                <Text style={local.cuota}>{tituloCuota(cuota)}</Text>
                <Text style={local.detalle}>{describirVencimiento(cuota)}</Text>
                {!!abonado && <Text style={local.detalle}>{abonado}</Text>}
                <View style={[local.insignia, { backgroundColor: color.fondo }]}>
                    <Text style={{ color: color.texto, fontWeight: '800', fontSize: 12 }}>{etiquetaEstado(cuota.estado)}</Text>
                </View>
            </View>
            <Text style={local.monto}>{formatearMonto(cuota.monto)}</Text>
        </View>
    );
}

const local = StyleSheet.create({
    contenido: { padding: 16, paddingBottom: 32 },
    filtros: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 4, marginBottom: 14, elevation: 1 },
    filtro: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9 },
    filtroActivo: { backgroundColor: colores.azul },
    filtroTexto: { fontSize: 14, fontWeight: '700', color: colores.suave },
    filtroTextoActivo: { color: '#fff' },
    aviso: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 12, marginBottom: 14 },
    avisoTexto: { color: colores.error, fontWeight: '700' },
    reintentar: { color: colores.azul, fontWeight: '800', marginTop: 6 },
    total: { fontSize: 26, fontWeight: '800' },
    hijo: { fontSize: 16, fontWeight: '800', color: colores.texto, marginTop: 6, marginBottom: 8 },
    fila: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    cuota: { fontSize: 16, fontWeight: '800', color: colores.texto },
    detalle: { fontSize: 13, color: colores.suave, marginTop: 2 },
    monto: { fontSize: 17, fontWeight: '800', color: colores.texto, marginLeft: 10 },
    insignia: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 },
});
