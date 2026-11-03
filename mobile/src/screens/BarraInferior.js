import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colores } from './estilos.js';

// Navegación simple entre las secciones de la app del padre/tutor.
const SECCIONES = [
    { id: 'hijos', texto: 'Mis hijos' },
    { id: 'cuotas', texto: 'Cuotas' },
    { id: 'pagar', texto: 'Pagar' },
    { id: 'cuenta', texto: 'Mi cuenta' },
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
                    <Text style={[estilosBarra.texto, activa === s.id && estilosBarra.textoActivo]}>{s.texto}</Text>
                    {activa === s.id && <View style={estilosBarra.linea} />}
                </Pressable>
            ))}
        </View>
    );
}

const estilosBarra = StyleSheet.create({
    barra: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
    opcion: { flex: 1, alignItems: 'center', paddingVertical: 14 },
    texto: { fontSize: 14, fontWeight: '700', color: colores.suave },
    textoActivo: { color: colores.azul },
    linea: { position: 'absolute', top: 0, height: 3, width: '60%', backgroundColor: colores.azul, borderRadius: 2 },
});
