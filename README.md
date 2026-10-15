# MINA V3 · voz IA

Proyecto dedicado a leer el chat de Discord en un canal de voz. Usa la voz de referencia local con Chatterbox Multilingual en español y CUDA.

## Uso

En este PC está disponible la aplicación **Control de MINA V3**, con acceso directo en el escritorio. Sus botones permiten encender, apagar y reiniciar el bot. El panel muestra la conexión a Discord y el estado de la voz; al cerrar la ventana el bot continúa funcionando. Al apagarlo se cierra también el motor Python y se libera la GPU.

El instalador y la edición portátil se generan en `control-center/release`. El programa controla este proyecto local: conserva esta carpeta y el entorno Python con CUDA.

Con Node.js instalado, abre una terminal en esta carpeta:

```text
npm start
```

Entra a un canal de voz y ejecuta `/leer iniciar` en el chat que quieras escuchar. Lee solo los mensajes nuevos, sin decir quién los escribió. `/leer detener` desconecta y vacía la cola. `/leer saltar` interrumpe el mensaje actual. `/leer limpiar` borra pendientes. `/leer estado` informa sobre motor y cola.

Message Content Intent debe estar habilitado en Discord Developer Portal → Bot. El bot necesita Ver canal, Conectar y Hablar; Enviar mensajes para los avisos. La voz está preparada antes de confirmar que se activó el lector.

## Optimización

- Modelo persistente en GPU y referencia de voz calculada una sola vez.
- Siguiente mensaje preparado durante la reproducción actual; inferencia serializada entre servidores.
- Caché para frases repetidas durante la sesión.
- Cola limitada y descarte de mensajes demasiado antiguos para evitar leer conversaciones muy atrasadas.
- Tiempo máximo de carga y generación; reinicio del proceso de voz si la inferencia se atasca.
- Reconexión de Discord y limpieza de procesos/archivos temporales al cerrar.

Las primeras frases necesitan cargar el modelo. El rendimiento posterior depende de la longitud del texto y de la carga de tu GPU. No sustituye una evaluación auditiva humana de la voz.

## Configuración local

`.env` contiene las credenciales y rutas privadas. `assets/voice/user_reference.wav` es una copia propia de la voz. Se utiliza el Python con CUDA ya instalado en `C:\mina-voice-venv`; el entorno se comparte para evitar duplicar varios GB, pero el código y configuración de MINA V3 están en esta carpeta. No elimines ese entorno mientras uses V3. No requiere Colab ni túneles.

`VOICE_DEVICE=cuda` exige GPU y muestra un error si no está disponible. Puedes elegir `cpu` explícitamente. `READER_QUEUE_LIMIT`, `READER_MAX_AGE_MS` y `READER_MAX_TEXT` permiten ajustar la cola; consulta `.env.example`.

## Desarrollo y comprobaciones

```text
npm install
npm run check
npm run build
npm test
npm run voice:test
npm run deploy
```

`deploy` registra únicamente `/leer` y conserva los demás comandos del bot. Comparte credenciales con MINA original y MINA V2: ejecuta una sola variante por vez. El registro de comandos no inicia el bot.

La prueba de voz genera un WAV real, comprueba su tamaño, verifica reutilización de caché y elimina sus temporales. Credenciales, voz de referencia y temporales están excluidos de Git.
