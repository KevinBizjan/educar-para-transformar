import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import SeccionesReporte from './SeccionesReporte';

// "Mis cursos y horarios" del docente: los cursos que tiene a cargo por nivel y el horario de cada uno.
// Sale de su propio legajo, así que solo funciona si la Dirección vinculó su cuenta (Usuarios → Vincular cuentas).
export default function MisCursosDocente() {
    const { apiFetch } = useAuth();
    const [estado, setEstado] = useState({ cargando: true, vinculado: false, ficha: null, error: '' });

    useEffect(() => {
        let activo = true;
        const cargar = async () => {
            try {
                const r = await apiFetch(`${API_URL}/api/academico/mis-cursos`);
                if (!r.ok) throw new Error('No se pudieron cargar tus cursos.');
                const datos = await r.json();
                if (activo) setEstado({ cargando: false, vinculado: !!datos.vinculado, ficha: datos.ficha || null, error: '' });
            } catch (e) {
                if (activo) setEstado({ cargando: false, vinculado: false, ficha: null, error: e.message || 'No se pudieron cargar tus cursos.' });
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch]);

    const { cargando, vinculado, ficha, error } = estado;
    const datos = ficha ? ficha.secciones[0].filas[0] : null;

    return (
        <div className="dashboard-card" style={{ gridColumn: '1 / -1', background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--blue)', fontWeight: 800, borderBottom: '2px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px' }}>
                🗓️ Mis cursos y horarios
            </h3>

            {cargando && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Cargando…</p>}
            {error && <p role="alert" style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 700 }}>{error}</p>}

            {!cargando && !error && !vinculado && (
                <p style={{ fontSize: '0.85rem', color: '#92400e', background: '#fffbeb', padding: '12px 14px', borderRadius: '8px' }}>
                    Tu cuenta todavía no está vinculada a tu legajo docente. Pedile a la Dirección que la vincule para ver acá tus cursos y horarios;
                    mientras tanto ves el listado completo de alumnos y materias.
                </p>
            )}

            {vinculado && ficha && (
                <>
                    <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '14px' }}>
                        Legajo {datos.legajo}{datos.especialidad && datos.especialidad !== '-' ? ` · ${datos.especialidad}` : ''}. Los alumnos y materias de este panel son los de estos cursos.
                    </p>
                    <SeccionesReporte secciones={ficha.secciones.slice(1)} />
                </>
            )}
        </div>
    );
}
