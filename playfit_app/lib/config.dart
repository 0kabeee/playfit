/// Configuracion de la app.
///
/// En el EMULADOR de Android, 10.0.2.2 apunta al "localhost" de tu PC (donde corre `npm run dev`).
/// Para un celular fisico, compila con tu IP:
///   flutter run --dart-define=API_BASE=http://192.168.1.50:3000
class Config {
  static const String apiBase =
      String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000');

  /// Notificaciones push (Firebase Cloud Messaging). Son los datos PUBLICOS de la app Android en tu proyecto de
  /// Firebase (Configuracion del proyecto > Tus apps). Sin ellos la app funciona igual, solo que sin push.
  ///   flutter run --dart-define=FCM_API_KEY=... --dart-define=FCM_APP_ID=... --dart-define=FCM_SENDER_ID=... --dart-define=FCM_PROJECT_ID=...
  static const String fcmApiKey = String.fromEnvironment('FCM_API_KEY');
  static const String fcmAppId = String.fromEnvironment('FCM_APP_ID');
  static const String fcmSenderId = String.fromEnvironment('FCM_SENDER_ID');
  static const String fcmProjectId = String.fromEnvironment('FCM_PROJECT_ID');

  static bool get pushConfigurado =>
      fcmApiKey.isNotEmpty && fcmAppId.isNotEmpty && fcmSenderId.isNotEmpty && fcmProjectId.isNotEmpty;
}
