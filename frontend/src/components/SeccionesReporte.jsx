// Dibuja las secciones de un reporte con el formato común del backend: [{ titulo, columnas: [{ clave, titulo }], filas, total }].
// Lo usan los reportes de la Dirección, la ficha del hijo (padre) y "Mis cursos y horarios" (docente).

const thStyle = { padding: '12px 14px', fontSize: '0.75rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', whiteSpace: 'nowrap' };
const tdStyle = { padding: '12px 14px', fontSize: '0.88rem', verticalAlign: 'top', borderTop: '1px solid #f1f5f9' };

const celda = (valor) => (valor === null || valor === undefined || valor === '' ? '-' : String(valor));

// vacio: texto cuando un reporte de una sola sección no trae filas.
export default function SeccionesReporte({ secciones, vacio = 'No hay resultados para estos filtros.' }) {
    return secciones.map((sec) => (
        <div key={sec.titulo} style={{ marginBottom: '22px' }}>
            {(secciones.length > 1 || sec.total > 0) && (
                <h4 style={{ fontSize: '0.85rem', color: 'var(--blue)', fontWeight: 800, marginBottom: '8px' }}>
                    {sec.titulo} <span style={{ color: '#94a3b8', fontWeight: 600 }}>· {sec.total} {sec.total === 1 ? 'fila' : 'filas'}</span>
                </h4>
            )}
            {sec.total === 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#64748b', padding: '14px', background: '#f8fafc', borderRadius: '8px' }}>
                    {secciones.length > 1 ? `${sec.titulo}: sin datos.` : vacio}
                </p>
            ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>{sec.columnas.map((c) => <th key={c.clave} style={thStyle}>{c.titulo}</th>)}</tr>
                        </thead>
                        <tbody>
                            {sec.filas.map((fila, i) => (
                                <tr key={i}>{sec.columnas.map((c) => <td key={c.clave} style={tdStyle}>{celda(fila[c.clave])}</td>)}</tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    ));
}
