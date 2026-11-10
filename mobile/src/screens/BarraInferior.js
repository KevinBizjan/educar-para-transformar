import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colores } from './estilos.js';

// Navegación simple entre las secciones de la app del padre/tutor.
const SECCIONES = [
    { id: 'hijos', texto: 'Mis hijos', icono: '👨‍👧' },
    { id: 'servicios', texto: 'Servicios', icono: '⚽' },
    { id: 'cuotas', texto: 'Cuotas', icono: '🧾' },
    { id: 'pagar', texto: 'Pagar', icono: '💳' },
    { id: 'cuenta', texto: 'Mi cuenta', icono: '👤' },
];

export default function BarraInferior({ activa, alElegir }) {
    return (
        <View style={estilosBarra.barra}>
            {SECCIONES.map((s) => (
                <Pressable
                    key={s.id}
                    style={estilosBarra.opcion}
                    onPress={() => alElegir(s.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: activa === s.id }}
                >
                    <Text style={[estilosBarra.icono, activa !== s.id && estilosBarra.iconoApagado]}>{s.icono}</Text>
                    <Text style={[estilosBarra.texto, activa === s.id && estilosBarra.textoActivo]}>{s.texto}</Text>
                    {activa === s.id && <View style={estilosBarra.linea} />}
                </Pressable>
            ))}
        </View>
    );
}

const estilosBarra = StyleSheet.create({
    barra: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
    opcion: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2 },
    icono: { fontSize: 20 },
    iconoApagado: { opacity: 0.55 },
    texto: { fontSize: 12, fontWeight: '700', color: colores.suave },
    textoActivo: { color: colores.violeta },
    linea: { position: 'absolute', top: 0, height: 3, width: '60%', backgroundColor: colores.violeta, borderRadius: 2 },
});
