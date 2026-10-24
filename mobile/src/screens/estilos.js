import { StyleSheet } from 'react-native';

// Colores de la identidad institucional (los mismos de la web).
export const colores = {
    azul: '#1a5fa8',
    naranja: '#f5820d',
    fondo: '#f1f5f9',
    texto: '#0f172a',
    suave: '#64748b',
    ok: '#166534',
    error: '#991b1b',
};

export const estilos = StyleSheet.create({
    pantalla: { flexGrow: 1, backgroundColor: colores.fondo, justifyContent: 'center', padding: 24 },
    titulo: { fontSize: 26, fontWeight: '800', color: colores.azul, textAlign: 'center' },
    subtitulo: { fontSize: 14, color: colores.suave, textAlign: 'center', marginBottom: 24 },
    tarjeta: { backgroundColor: '#fff', borderRadius: 16, padding: 20, elevation: 2 },
    etiqueta: { fontSize: 12, fontWeight: '700', color: colores.suave, textTransform: 'uppercase', marginTop: 12, marginBottom: 6 },
    campo: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colores.texto, backgroundColor: '#f8fafc' },
    boton: { marginTop: 18, backgroundColor: colores.azul, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    botonSecundario: { marginTop: 12, borderWidth: 1, borderColor: colores.azul, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
    botonPeligro: { marginTop: 12, backgroundColor: colores.naranja, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    botonDeshabilitado: { opacity: 0.55 },
    botonTexto: { color: '#fff', fontWeight: '800', fontSize: 16 },
    botonTextoSecundario: { color: colores.azul, fontWeight: '800', fontSize: 16 },
    error: { marginTop: 12, color: colores.error, fontWeight: '700' },
    exito: { marginTop: 12, color: colores.ok, fontWeight: '700' },
    texto: { fontSize: 15, color: colores.texto },
    pie: { marginTop: 18, fontSize: 11, color: '#94a3b8', textAlign: 'center' },
});
