import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colores } from './estilos.js';

// Identidad de la institución: el mismo logo y los mismos colores que la web.
const logo = require('../../assets/logo.png');
const PROPORCION_LOGO = 227 / 262; // alto / ancho del archivo

export function Logo({ ancho = 120 }) {
    return <Image source={logo} style={{ width: ancho, height: Math.round(ancho * PROPORCION_LOGO) }} resizeMode="contain" accessibilityLabel="Logo de Educar para Transformar" />;
}

// El degradé de la web (azul a violeta), para el fondo del inicio de sesión y la barra superior
export const DEGRADE = [colores.azul, colores.violeta];

export function FondoDegradado({ children, style }) {
    return <LinearGradient colors={DEGRADE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ flex: 1 }, style]}>{children}</LinearGradient>;
}

// Barra superior de las secciones de la app: el logo sobre fondo blanco y el nombre de la institución, con una línea
// de colores (verde y naranja) como la de la web
export function Encabezado() {
    return (
        <View>
            <LinearGradient colors={DEGRADE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={local.barra}>
                <View style={local.logo}><Logo ancho={46} /></View>
                <View style={{ flex: 1 }}>
                    <Text style={local.nombre}>Educar para Transformar</Text>
                    <Text style={local.lema}>Centro educativo · Familias</Text>
                </View>
            </LinearGradient>
            <LinearGradient colors={[colores.verde, colores.naranja]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        </View>
    );
}

const local = StyleSheet.create({
    barra: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
    logo: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 4, paddingVertical: 2, marginRight: 12 },
    nombre: { color: '#fff', fontSize: 16, fontWeight: '800' },
    lema: { color: '#ede9fe', fontSize: 12, fontWeight: '600', marginTop: 1 },
});
