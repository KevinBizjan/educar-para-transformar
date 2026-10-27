// Pre-commit: solo se revisan los archivos que entran en el commit.
export default {
    // Frontend: ESLint con la configuración del proyecto (los errores bloquean; los avisos no, igual que en la CI).
    'frontend/**/*.{js,jsx}': (archivos) => `npm --prefix frontend exec -- eslint ${archivos.map((a) => `"${a}"`).join(' ')}`,
    // Backend: chequeo de sintaxis de cada archivo (node --check no ejecuta el código).
    'backend/**/*.js': (archivos) => archivos.map((a) => `node --check "${a}"`),
};
