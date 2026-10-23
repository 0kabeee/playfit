import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../config.dart';

/// Notificaciones push con Firebase Cloud Messaging.
///
/// - Al iniciar sesion pide permiso (Android 13+), obtiene el token del celular y lo registra en el backend.
/// - Al cerrar sesion lo quita del backend y lo borra de Firebase (otra cuenta en el mismo celular no recibe tus avisos).
/// - Con la app abierta, Android no muestra la notificacion: se avisa con [onForeground] (un toast + refrescar la campana).
/// - Si no hay datos de Firebase (`--dart-define=FCM_...`) o algo falla, la app sigue igual sin push.
///
/// Nota: firebase_messaging 17 marca getToken/onTokenRefresh/deleteToken como obsoletos en favor de register()/
/// onRegistered, que entregan un Firebase Installation ID para otro mecanismo de envio. El backend usa la API
/// HTTP v1 de FCM con "registration tokens" (los que da getToken), que siguen funcionando: por eso se mantienen.
class PushService {
  PushService(this._api, {required this.onForeground});

  final ApiClient _api;
  final void Function(String titulo, String cuerpo) onForeground;

  bool _iniciado = false;
  String? _token;
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _mensajes;

  Future<bool> _iniciar() async {
    if (_iniciado) return true;
    if (!Config.pushConfigurado || kIsWeb || defaultTargetPlatform != TargetPlatform.android) return false;
    try {
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: Config.fcmApiKey,
          appId: Config.fcmAppId,
          messagingSenderId: Config.fcmSenderId,
          projectId: Config.fcmProjectId,
        ),
      );
      _mensajes = FirebaseMessaging.onMessage.listen((m) {
        final n = m.notification;
        if (n != null) onForeground(n.title ?? 'PlayFit', n.body ?? '');
      });
      _iniciado = true;
    } catch (e) {
      debugPrint('[push] Firebase no inicio: $e');
    }
    return _iniciado;
  }

  /// Se llama con la sesion ya iniciada.
  Future<void> registrar() async {
    if (!await _iniciar()) return;
    try {
      final fm = FirebaseMessaging.instance;
      final permiso = await fm.requestPermission();
      if (permiso.authorizationStatus == AuthorizationStatus.denied) return;
      // ignore: deprecated_member_use
      final token = await fm.getToken();
      if (token == null) return;
      await _enviar(token);
      // ignore: deprecated_member_use
      _refresh ??= fm.onTokenRefresh.listen(_enviar);
    } catch (e) {
      debugPrint('[push] no pude registrar el celular: $e');
    }
  }

  Future<void> _enviar(String token) async {
    _token = token;
    try {
      await _api.post('/api/social/devices', body: {'token': token});
    } catch (e) {
      debugPrint('[push] el servidor no acepto el token: $e');
    }
  }

  /// Se llama ANTES de borrar los tokens de la sesion (necesita estar autenticado).
  Future<void> quitar() async {
    final token = _token;
    await _refresh?.cancel();
    _refresh = null;
    _token = null;
    if (!_iniciado || token == null) return;
    try {
      await _api.delete('/api/social/devices', body: {'token': token});
    } catch (_) {}
    try {
      // ignore: deprecated_member_use
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }

  Future<void> dispose() async {
    await _refresh?.cancel();
    await _mensajes?.cancel();
  }
}
