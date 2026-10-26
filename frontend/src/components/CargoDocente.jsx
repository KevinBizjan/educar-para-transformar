import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import SeccionesReporte from './SeccionesReporte';

// Materias y cursos que tiene a cargo un docente, por nivel, y el horario de cada curso. Sale de los Horarios cargados
// en Gestión Académica (es lo que asigna una materia de un curso a un profesor) y es la misma ficha del reporte "Por docente".
const overlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 };
const contentStyle = { background: 'white', padding: '28px', borderRadius: '16px', width: '92%', maxWidth: '860px', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' };

export default function CargoDocente({ docente, onClose }) {
    const { apiFetch } = useAuth();
    const [respuesta, setRespuesta] = useState(null); // { ficha, error }

    useEffect(() => {
        let activo = true;
        const cargar = async () => {
            try {
                const r = await apiFetch(`${API_URL}/api/reportes/docente/${docente.id}`);
                const cuerpo = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(cuerpo.message || 'No se pudo cargar la información del docente.');
                if (activo) setRespuesta({ ficha: cuerpo, error: '' });
            } catch (e) {
                if (activo) setRespuesta({ ficha: null, error: e.message || 'No se pudo cargar la información del docente.' });
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch, docente.id]);

    return (
        <div style={overlayStyle} onClick={onClose}>
            <div role="dialog" aria-label={`Materias y cursos a cargo de ${docente.apellido}, ${docente.nombre}`} style={contentStyle} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
                    <div>
                        <h2 style={{ fontSize: '1.15rem', color: 'var(--blue)', fontWeight: 800, margin: 0 }}>Materias y cursos a cargo</h2>
                        <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0' }}>{docente.legajo} · {docente.apellido}, {docente.nombre}</p>
                    </div>
                    <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>✕</button>
                </div>
                {!respuesta && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Cargando…</p>}
                {respuesta && respuesta.error && <p role="alert" style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 700 }}>{respuesta.error}</p>}
                {respuesta && respuesta.ficha && (
                    <>
                        <SeccionesReporte secciones={respuesta.ficha.secciones.slice(1)} />
                        <p style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            Para asignarle una materia de un curso, cargá un horario en Gestión Académica → Horarios.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
