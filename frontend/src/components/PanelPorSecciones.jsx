import { Children, isValidElement, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Panel de inicio con accesos. En lugar de apilar todas las tarjetas en una página larga, muestra el resumen y un acceso
// por sección; al elegir uno se abre solo esa sección, con un botón para volver.
//
// Uso:
//   <PanelPorSecciones resumen={<div>…indicadores…</div>}>
//       <Seccion id="hijos" icono="🔗" titulo="Mis hijos" estado="2 vinculados" aviso="1 nuevo">…tarjeta…</Seccion>
//       <Seccion id="menu" icono="🍎" titulo="Menú" estado="Semanal" accion={() => abrirMenu()} />
//   </PanelPorSecciones>
//
// - La sección abierta vive en la dirección (#hijos): el botón Atrás del navegador vuelve al panel, y recargar o
//   compartir el enlace conserva la sección.
// - Solo se dibuja el contenido de la sección abierta. El estado del panel (datos, formularios) lo guarda el
//   componente que lo usa, así que no se pierde al cambiar de sección.
// - Un acceso con `accion` no abre una sección: ejecuta la acción (por ejemplo, un cuadro emergente).

export function Seccion({ children }) {
    return <>{children}</>;
}

// El identificador de la sección sale de la dirección; un hash mal escrito (%E0) no debe romper el panel.
const idDelHash = (hash) => {
    try {
        return decodeURIComponent(hash.replace(/^#/, ''));
    } catch {
        return '';
    }
};

export default function PanelPorSecciones({ resumen, ayuda = 'Elegí una sección.', children }) {
    const { hash, state } = useLocation();
    const navigate = useNavigate();
    const volverRef = useRef(null);
    const ultimaAbierta = useRef(null);

    const secciones = Children.toArray(children).filter(isValidElement);
    const pedida = idDelHash(hash);
    const abierta = secciones.find((s) => s.props.id === pedida && !s.props.accion) || null;
    const idAbierta = abierta ? abierta.props.id : null;

    // Al abrir una sección, arriba de todo y con el foco en "Volver"; al volver, el foco regresa a su acceso.
    useEffect(() => {
        if (idAbierta) {
            ultimaAbierta.current = idAbierta;
            window.scrollTo(0, 0);
            if (volverRef.current) volverRef.current.focus();
        } else if (ultimaAbierta.current) {
            const acceso = document.getElementById(`acceso-${ultimaAbierta.current}`);
            if (acceso) acceso.focus();
            ultimaAbierta.current = null;
        }
    }, [idAbierta]);

    const abrir = (seccion) => {
        if (seccion.props.accion) seccion.props.accion();
        else navigate({ hash: `#${seccion.props.id}` }, { state: { panel: true } });
    };

    // Si se llegó desde el panel, "Volver" retrocede en el historial; si se entró directo a la sección, va al panel.
    const volver = () => {
        if (state && state.panel) navigate(-1);
        else navigate({ hash: '' }, { replace: true });
    };

    if (abierta) {
        return (
            <>
                <nav aria-label="Ubicación" className="acceso-nav">
                    <button ref={volverRef} type="button" className="acceso-volver" onClick={volver}>← Volver al panel</button>
                    <span className="acceso-ubicacion" aria-current="page">{abierta.props.icono} {abierta.props.titulo}</span>
                </nav>
                <div style={{ display: 'grid', gap: '24px' }}>{abierta.props.children}</div>
            </>
        );
    }

    return (
        <>
            {resumen}
            <p className="acceso-ayuda">{ayuda}</p>
            <div className="accesos">
                {secciones.map((s) => (
                    <button
                        key={s.props.id}
                        id={`acceso-${s.props.id}`}
                        type="button"
                        className="acceso"
                        aria-haspopup={s.props.accion ? 'dialog' : undefined}
                        onClick={() => abrir(s)}
                    >
                        <span className="acceso-icono" aria-hidden="true">{s.props.icono}</span>
                        <span className="acceso-titulo">{s.props.titulo}</span>
                        {s.props.estado && <span className="acceso-estado">{s.props.estado}</span>}
                        {s.props.aviso && <span className="acceso-aviso">{s.props.aviso}</span>}
                    </button>
                ))}
            </div>
        </>
    );
}
