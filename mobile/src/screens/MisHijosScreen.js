import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext.js';
import {
    cargarResumen, obtenerEnCache, periodoActual, mesAnterior, mesSiguiente, tituloPeriodo,
    formatearMonto, describirCurso, describirComedor, nombreServicio,
} from '../familia/resumen.js';
import { estilos, colores } from './estilos.js';

// "Mis hijos": los hijos del padre autenticado, sus servicios del mes, el consumo del comedor
// y el estado de cuenta. Una sola llamada a la API; lo último que se vio queda en caché para
// mostrarse al instante mientras se actualiza en segundo plano.
export default function MisHijosScreen() {
    const { usuario } = useAuth();
    const [periodo, setPeriodo] = useState(periodoActual());
    const [datos, setDatos] = useState(() => obtenerEnCache(periodoActual()));
    const [cargando, setCargando] = useState(false);
    const [refrescando, setRefrescando] = useState(false);
    const [error, setError] = useState('');
    const pedidoActual = useRef(0); // una respuesta vieja no debe pisar la del mes elegido después

    const cargar = useCallback(async (p, manual = false) => {
        const id = ++pedidoActual.current;
        const enCache = obtenerEnCache(p);
        setError('');
        setDatos(enCache);
        if (manual) setRefrescando(true);
        else if (!enCache) setCargando(true);
        try {
            const nuevos = await cargarResumen(p);
            if (id === pedidoActual.current) setDatos(nuevos);
        } catch (e) {
            if (id === pedidoActual.current) setError(e.message);
        } finally {
            if (id === pedidoActual.current) { setCargando(false); setRefrescando(false); }
        }
    }, []);

    useEffect(() => { cargar(periodo); }, [periodo, cargar]);

    const resumen = datos && datos.resumen;

    return (
        <ScrollView
            contentContainerStyle={local.contenido}
            refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(periodo, true)} tintColor={colores.azul} />}
        >
            <Text style={estilos.titulo}>Mis hijos</Text>
            <Text style={[estilos.subtitulo, { marginBottom: 12 }]}>Hola, {usuario.nombre}</Text>

            <View style={local.selector}>
                <Pressable onPress={() => setPeriodo(mesAnterior(periodo))} accessibilityLabel="Mes anterior" style={local.flecha}>
                    <Text style={local.flechaTexto}>‹</Text>
                </Pressable>
                <Text style={local.periodo}>{tituloPeriodo(periodo)}</Text>
                <Pressable onPress={() => setPeriodo(mesSiguiente(periodo))} accessibilityLabel="Mes siguiente" style={local.flecha}>
                    <Text style={local.flechaTexto}>›</Text>
                </Pressable>
            </View>

            {!!error && (
                <View style={local.aviso}>
                    <Text style={local.avisoTexto}>{error}</Text>
                    <Pressable onPress={() => cargar(periodo)}><Text style={local.reintentar}>Reintentar</Text></Pressable>
                </View>
            )}

            {cargando && <ActivityIndicator size="large" color={colores.azul} style={{ marginTop: 32 }} />}

            {resumen && (
                <View style={[estilos.tarjeta, { marginBottom: 14 }]}>
                    <Text style={estilos.etiqueta}>Resumen de cuenta</Text>
                    <Text style={local.dato}>
                        {resumen.cantidad_hijos} {resumen.cantidad_hijos === 1 ? 'hijo' : 'hijos'}
                    </Text>
                    <Text style={[local.dato, { color: resumen.saldo_total > 0 ? colores.error : colores.ok }]}>
                        {resumen.saldo_total > 0 ? `Saldo pendiente: ${formatearMonto(resumen.saldo_total)}` : 'Cuenta al día'}
                    </Text>
                    <Text style={local.dato}>Servicios del mes: {formatearMonto(resumen.total_servicios_mes)}</Text>
                </View>
            )}

            {datos && datos.hijos.length === 0 && (
                <View style={estilos.tarjeta}>
                    <Text style={estilos.texto}>
                        Todavía no tenés hijos vinculados a tu cuenta. Vinculalos desde el portal web o consultá en la institución.
                    </Text>
                </View>
            )}

            {datos && datos.hijos.map((hijo) => <TarjetaHijo key={hijo.id} hijo={hijo} />)}
        </ScrollView>
    );
}

function TarjetaHijo({ hijo }) {
    const comedor = describirComedor(hijo.comedor);
    const pendiente = hijo.estado_cuenta === 'Pendiente';
    return (
        <View style={[estilos.tarjeta, { marginBottom: 14 }]}>
            <Text style={local.nombre}>{hijo.nombre} {hijo.apellido}</Text>
            <Text style={local.curso}>{describirCurso(hijo)}</Text>

            <View style={[local.insignia, { backgroundColor: pendiente ? '#fee2e2' : '#dcfce7' }]}>
                <Text style={{ color: pendiente ? colores.error : colores.ok, fontWeight: '800', fontSize: 12 }}>
                    {pendiente ? `Saldo pendiente ${formatearMonto(hijo.saldo_pendiente)}` : 'Cuenta al día'}
                </Text>
            </View>

            <Text style={estilos.etiqueta}>Servicios del mes</Text>
            {hijo.servicios.length === 0 && <Text style={local.vacio}>Sin servicios inscriptos este mes.</Text>}
            {hijo.servicios.map((s) => (
                <View key={s.id} style={local.servicio}>
                    <Text style={[estilos.texto, { flex: 1 }]}>{nombreServicio(s)}</Text>
                    <Text style={local.precio}>{formatearMonto(s.precio_mensual)}</Text>
                </View>
            ))}
            {hijo.servicios.length > 0 && (
                <Text style={local.total}>Total del mes: {formatearMonto(hijo.total_servicios_mes)}</Text>
            )}
            {!!comedor && <Text style={local.comedor}>{comedor}</Text>}
        </View>
    );
}

const local = StyleSheet.create({
    contenido: { padding: 16, paddingBottom: 32 },
    selector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 12, marginBottom: 14, elevation: 1 },
    flecha: { paddingHorizontal: 22, paddingVertical: 10 },
    flechaTexto: { fontSize: 28, fontWeight: '800', color: colores.azul },
    periodo: { fontSize: 16, fontWeight: '800', color: colores.texto },
    aviso: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 12, marginBottom: 14 },
    avisoTexto: { color: colores.error, fontWeight: '700' },
    reintentar: { color: colores.azul, fontWeight: '800', marginTop: 6 },
    dato: { fontSize: 15, color: colores.texto, fontWeight: '700', marginTop: 4 },
    nombre: { fontSize: 19, fontWeight: '800', color: colores.texto },
    curso: { fontSize: 13, color: colores.suave, marginBottom: 10 },
    insignia: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 6 },
    vacio: { fontSize: 14, color: colores.suave },
    servicio: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
    precio: { fontSize: 14, fontWeight: '700', color: colores.texto },
    total: { fontSize: 14, fontWeight: '800', color: colores.azul, marginTop: 6, textAlign: 'right' },
    comedor: { fontSize: 13, color: colores.suave, marginTop: 10 },
});
