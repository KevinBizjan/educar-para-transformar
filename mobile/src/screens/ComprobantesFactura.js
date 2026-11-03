import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { formatearMomento } from '../cuentas/cuotas.js';
import {
    TIPOS_PERMITIDOS, subirComprobante, listarComprobantes, urlComprobante, borrarComprobante, describirTamano, admiteComprobantes,
} from '../cuentas/comprobantes.js';
import { colores } from './estilos.js';

// Comprobantes de transferencia de una factura: se lista lo ya subido y se puede adjuntar otro (foto o PDF).
// Al subir el primero, la factura pasa a "En revisión": `alCambiar` avisa para que se actualice la lista.
export default function ComprobantesFactura({ factura, alCambiar }) {
    const [abierto, setAbierto] = useState(false);
    const [comprobantes, setComprobantes] = useState(null);
    const [maximo, setMaximo] = useState(10);
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState('');
    const admite = admiteComprobantes(factura.estado);

    const cargar = useCallback(async () => {
        try {
            const datos = await listarComprobantes(factura.id);
            setComprobantes(datos.comprobantes);
            setMaximo(datos.maximo);
        } catch (e) {
            setError(e.message);
        }
    }, [factura.id]);

    const alternar = () => {
        const nuevo = !abierto;
        setAbierto(nuevo);
        if (nuevo) { setError(''); cargar(); }
    };

    const adjuntar = async () => {
        setError('');
        try {
            const elegido = await DocumentPicker.getDocumentAsync({ type: TIPOS_PERMITIDOS, copyToCacheDirectory: true, multiple: false });
            if (elegido.canceled || !elegido.assets || elegido.assets.length === 0) return;
            setOcupado(true);
            await subirComprobante(factura.id, elegido.assets[0]);
            await cargar();
            alCambiar();
        } catch (e) {
            setError(e.message);
        } finally {
            setOcupado(false);
        }
    };

    const ver = async (c) => {
        try {
            const { url } = await urlComprobante(c.id);
            await Linking.openURL(url);
        } catch (e) {
            setError(e.message);
        }
    };

    const quitar = (c) => {
        Alert.alert('Quitar comprobante', `¿Querés quitar «${c.nombre_archivo}»?`, [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Quitar', style: 'destructive', onPress: async () => {
                    try { await borrarComprobante(c.id); await cargar(); alCambiar(); } catch (e) { setError(e.message); }
                },
            },
        ]);
    };

    return (
        <View style={local.caja}>
            <Pressable onPress={alternar} accessibilityRole="button" accessibilityState={{ expanded: abierto }}>
                <Text style={local.enlace}>{abierto ? 'Ocultar comprobantes' : (admite ? 'Adjuntar o ver comprobantes' : 'Ver comprobantes')}</Text>
            </Pressable>

            {abierto && (
                <View style={{ marginTop: 8 }}>
                    {comprobantes === null && !error && <ActivityIndicator color={colores.azul} />}
                    {comprobantes && comprobantes.length === 0 && (
                        <Text style={local.detalle}>{admite ? 'Todavía no adjuntaste ningún comprobante.' : 'Esta factura no tiene comprobantes.'}</Text>
                    )}
                    {comprobantes && comprobantes.map((c) => (
                        <View key={c.id} style={local.fila}>
                            <View style={{ flex: 1 }}>
                                <Text style={local.nombre} numberOfLines={1}>{c.nombre_archivo}</Text>
                                <Text style={local.detalle}>{describirTamano(c.tamano_bytes)} · {formatearMomento(c.subido_en)}</Text>
                            </View>
                            <Pressable onPress={() => ver(c)} style={local.accion}><Text style={local.enlace}>Ver</Text></Pressable>
                            {admite && <Pressable onPress={() => quitar(c)} style={local.accion}><Text style={local.quitar}>Quitar</Text></Pressable>}
                        </View>
                    ))}

                    {admite && comprobantes && comprobantes.length < maximo && (
                        <Pressable
                            style={[local.boton, ocupado && { opacity: 0.55 }]}
                            disabled={ocupado}
                            onPress={adjuntar}
                            accessibilityRole="button"
                        >
                            {ocupado ? <ActivityIndicator color={colores.azul} /> : <Text style={local.botonTexto}>Adjuntar comprobante (foto o PDF)</Text>}
                        </Pressable>
                    )}
                    {admite && comprobantes && comprobantes.length >= maximo && <Text style={local.detalle}>Llegaste al máximo de {maximo} comprobantes.</Text>}
                    {!!error && <Text style={local.error}>{error}</Text>}
                </View>
            )}
        </View>
    );
}

const local = StyleSheet.create({
    caja: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 },
    enlace: { color: colores.azul, fontWeight: '800', fontSize: 14 },
    quitar: { color: colores.error, fontWeight: '800', fontSize: 14 },
    detalle: { fontSize: 13, color: colores.suave, marginTop: 2 },
    fila: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
    nombre: { fontSize: 14, fontWeight: '700', color: colores.texto },
    accion: { paddingHorizontal: 10, paddingVertical: 6 },
    boton: { marginTop: 8, borderWidth: 1, borderColor: colores.azul, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    botonTexto: { color: colores.azul, fontWeight: '800', fontSize: 14 },
    error: { marginTop: 8, color: colores.error, fontWeight: '700' },
});
