# Trama — proyecto para generar la app de Android

Este proyecto contiene el código de Trama listo para empaquetar como aplicación
de Android y subirla a Google Play.

## Lo que hay que instalar en el PC, una sola vez

1. **Node.js** (versión 20 o superior): https://nodejs.org — instalador normal, siguiente-siguiente.
2. **Android Studio**: https://developer.android.com/studio — durante la instalación
   acepta que descargue el SDK de Android. Son varios gigas.

## Preparar el proyecto, una sola vez

Abre una ventana de terminal dentro de esta carpeta y ejecuta:

    npm install

Tarda un par de minutos y descarga las dependencias.

## Cada vez que quieras generar la app

    npm run build
    npx cap sync android

Y después abre la carpeta `android` con Android Studio.

## Para probar en la tablet

Conecta la tablet por USB con la depuración USB activada y pulsa el botón de
ejecutar (el triángulo verde) en Android Studio.

## Para generar el archivo que se sube a Google Play

En Android Studio: menú **Build > Generate Signed App Bundle / APK**, elige
**Android App Bundle**, crea un almacén de claves nuevo la primera vez y
**guárdalo con su contraseña en lugar seguro**: sin él no podrás publicar
actualizaciones nunca más.

El archivo resultante (`app-release.aab`) es el que se sube a Play Console.

## Datos de la aplicación

- Identificador del paquete: `es.santiagoluria.trama` (no se puede cambiar
  después de publicar)
- Nombre visible: Trama
- Versión: 1.0.0

Para cambiar el nombre visible, edita `android/app/src/main/res/values/strings.xml`.
