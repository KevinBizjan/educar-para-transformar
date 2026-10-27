// Datos personales de un alumno en modo solo lectura. Recibe la primera sección de la ficha ("Datos del alumno",
// ver backend/src/services/fichas.service.js) y la muestra como lista de campos; si al legajo le falta algún dato, avisa.

const etiquetaStyle = { display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' };
const valorStyle = { fontSize: '0.92rem', color: '#1e293b', fontWeight: 600, overflowWrap: 'anywhere' };

const faltante = (valor) => valor === null || valor === undefined || valor === '' || valor === '-';

export default function DatosPersonales({ seccion }) {
    const fila = seccion && seccion.filas && seccion.filas[0];
    if (!fila) return null;
    const incompleto = seccion.columnas.some((c) => faltante(fila[c.clave]));

    return (
        <div style={{ marginBottom: '22px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px 20px' }}>
                {seccion.columnas.map((c) => (
                    <div key={c.clave}>
                        <span style={etiquetaStyle}>{c.titulo}</span>
                        <span style={valorStyle}>{faltante(fila[c.clave]) ? '-' : fila[c.clave]}</span>
                    </div>
                ))}
            </div>
            {incompleto && (
                <p style={{ fontSize: '0.8rem', color: '#92400e', background: '#fffbeb', padding: '10px 12px', borderRadius: '8px', marginTop: '14px' }}>
                    El legajo todavía no tiene todos los datos cargados. Si algo no es correcto, comunicate con la institución.
                </p>
            )}
        </div>
    );
}
