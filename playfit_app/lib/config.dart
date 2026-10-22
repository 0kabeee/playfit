/// Configuracion de la app.
///
/// En el EMULADOR de Android, 10.0.2.2 apunta al "localhost" de tu PC (donde corre `npm run dev`).
/// Para un celular fisico, compila con tu IP:
///   flutter run --dart-define=API_BASE=http://192.168.1.50:3000
class Config {
  static const String apiBase =
      String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000');
}
