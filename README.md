# Trama

Cuaderno digital para resolver pasatiempos de rejilla sobre una foto del tablero: Murdoku, Sudoku, Star Battle o cualquier rejilla personalizada. Es gratis y no tiene anuncios ni registro.

**Abrir la app:** https://piticho.github.io/trama/

## Qué hace

- Haces una foto al pasatiempo, o eliges una de la galería, y la app coloca encima una rejilla ajustable. También puedes empezar con una rejilla en blanco.
- Trae ajustes ya preparados para **Murdoku**, **Sudoku** y **Star Battle**, y un modo **Personalizado** para otros pasatiempos.
- Te deja anotar candidatos, tachar casillas, fijar los datos del enunciado, confirmar símbolos y dibujar paredes y regiones.
- Comprueba las reglas activas y avisa cuando el tablero está resuelto.
- La partida en curso se conserva al cerrar la app. Cada partida se puede guardar en un archivo, con la foto incluida, y recuperarla más tarde.
- La ayuda completa está dentro de la app, en el botón **Ayuda**.

Tus partidas y fotos se quedan en tu dispositivo: la app no tiene servidor ni recoge datos.

## Para desarrolladores

Está hecha con React y Vite, y se puede empaquetar para Android con Capacitor (ver [LEEME.md](LEEME.md)).

    npm install
    npm run dev          # desarrollo
    npm run build:web    # genera la versión web en docs/ (la que publica GitHub Pages)

---

Por Santiago Luria.
