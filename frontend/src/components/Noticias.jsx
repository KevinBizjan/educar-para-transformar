import { useState, useEffect, useRef } from 'react';

// Noticias con su contenido completo. El resumen se muestra en la tarjeta
// y el contenido (varios párrafos) se abre en un modal al tocar "Leer más".
const NOTICIAS = [
  {
    id: 1,
    titulo: 'Inicio de Inscripciones 2027',
    dia: '15', mes: 'FEB',
    img: 'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=600&q=80',
    alt: 'Inscripciones 2027',
    resumen: 'Comenzaron las preinscripciones para el ciclo lectivo 2027. Las vacantes son limitadas en cada nivel. ¡No dejes pasar esta oportunidad!',
    contenido: [
      'Con gran entusiasmo damos inicio al período de preinscripciones para el ciclo lectivo 2027. Las familias interesadas ya pueden completar el formulario de preinscripción online desde nuestra página principal.',
      'Las vacantes son limitadas en cada nivel (Inicial, Primario y Secundario) y se asignan por orden de llegada. Una vez recibida la preinscripción, el equipo de administración se contactará con la familia para coordinar la entrevista y la documentación requerida.',
      'Recordá que la preinscripción no garantiza la vacante hasta completar la matrícula. Ante cualquier duda, podés comunicarte con la secretaría en el horario de 8 a 16 hs.',
    ],
  },
  {
    id: 2,
    titulo: 'Nueva Pileta Inaugurada',
    dia: '11', mes: 'FEB',
    img: 'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=600&q=80',
    alt: 'Nueva pileta',
    resumen: 'Inauguramos las nuevas instalaciones de natación con tecnología de primer nivel. Clases disponibles para todos los niveles educativos.',
    contenido: [
      'Inauguramos oficialmente nuestra nueva pileta climatizada, una obra largamente esperada por toda la comunidad educativa. Las instalaciones cuentan con sistemas de climatización y filtrado de última generación que garantizan la seguridad e higiene durante todo el año.',
      'La natación se incorpora como actividad dentro del programa de Educación Física para todos los niveles, y también estará disponible como actividad extracurricular para quienes deseen profundizar.',
      'Las inscripciones a las clases de natación se realizarán a través del portal del alumno una vez comenzado el ciclo lectivo.',
    ],
  },
  {
    id: 3,
    titulo: 'Torneo de Ajedrez 2026',
    dia: '5', mes: 'FEB',
    img: 'https://images.unsplash.com/photo-1529699211952-734e80c4d42b?w=600&q=80',
    alt: 'Torneo de Ajedrez',
    resumen: 'Gran participación estudiantil en el torneo interinstitucional de ajedrez. Nuestros alumnos se destacaron en todas las categorías.',
    contenido: [
      'Se llevó a cabo el torneo interinstitucional de ajedrez 2026 con una participación récord de estudiantes de todos los niveles. El evento, organizado en nuestro salón de usos múltiples, reunió a delegaciones de varias instituciones de la región.',
      'Nuestros alumnos tuvieron un desempeño sobresaliente, obteniendo podios en las categorías Inicial, Sub-13 y Sub-17. Felicitamos a todos los participantes por su dedicación y deportividad.',
      'El taller de ajedrez continúa abierto a inscripciones como actividad cultural extracurricular durante todo el año.',
    ],
  },
];

const Noticias = () => {
  const [noticiaActiva, setNoticiaActiva] = useState(null);
  // La animación de entrada la controla este componente con su propio observer,
  // para no depender del observer global de LandingPage (que no ve nodos nuevos).
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fade = (extra = '') => `fade-in ${visible ? 'visible' : ''} ${extra}`.trim();

  return (
    <section className="section noticias" id="noticias" ref={sectionRef}>
      <div className="container">
        <h2 className={`section-title ${fade()}`}>Últimas Noticias y Actividades</h2>
        <p className={`section-sub ${fade()}`}>Enterate de todo lo que pasa en nuestra institución.</p>

        <div className="noticias-grid">
          {NOTICIAS.map((n, i) => (
            <div key={n.id} className={`noticia-card ${fade()}`} style={i > 0 ? { transitionDelay: `${i * 0.1}s` } : undefined}>
              <div className="noticia-card-img">
                <img src={n.img} alt={n.alt} />
                <div className="noticia-date">{n.dia}<span>{n.mes}</span></div>
              </div>
              <div className="noticia-card-body">
                <h3>{n.titulo}</h3>
                <p>{n.resumen}</p>
                <button
                  type="button"
                  className="noticia-link"
                  onClick={() => setNoticiaActiva(n)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                >
                  Leer más →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal con la noticia completa */}
      {noticiaActiva && (
        <div style={modalOverlay} onClick={() => setNoticiaActiva(null)}>
          <div style={modalContent} onClick={(e) => e.stopPropagation()}>
            <img
              src={noticiaActiva.img}
              alt={noticiaActiva.alt}
              style={{ width: '100%', height: '220px', objectFit: 'cover', borderRadius: '12px', marginBottom: '20px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
              <h2 style={{ color: 'var(--blue)', fontFamily: 'Nunito, sans-serif', margin: 0 }}>{noticiaActiva.titulo}</h2>
              <button onClick={() => setNoticiaActiva(null)} style={closeBtn}>✕</button>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700, marginTop: '6px' }}>
              {noticiaActiva.dia} de {noticiaActiva.mes} · 2026
            </p>
            <div style={{ marginTop: '16px' }}>
              {noticiaActiva.contenido.map((parrafo, idx) => (
                <p key={idx} style={{ marginBottom: '14px', lineHeight: 1.6, color: 'var(--text)' }}>{parrafo}</p>
              ))}
            </div>
            <button onClick={() => setNoticiaActiva(null)} className="btn btn-violet" style={{ marginTop: '8px' }}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

const modalOverlay = {
  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
  background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center', alignItems: 'center',
  zIndex: 1000, padding: '24px',
};
const modalContent = {
  background: 'white', padding: '28px', borderRadius: '16px', width: '100%', maxWidth: '600px',
  maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
};
const closeBtn = { background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b', lineHeight: 1 };

export default Noticias;
