import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../globals.dart';
import '../util.dart';
import '../widgets/toast.dart';

enum AuthStatus { unknown, loggedOut, loggedIn, expired }

/// Resultado del primer paso de login: 'ok' (ya entro), 'code' (pide el codigo 2FA) o 'setup' (admin debe configurar 2FA).
class LoginOutcome {
  const LoginOutcome(this.step, [this.desafio = '']);
  final String step;
  final String desafio;
}

const List<String> kRolesApp = <String>['estudiante', 'admin'];

/// Estado global de la app: sesion, usuario, avisos y cola de sesiones sin conexion.
class AppState extends ChangeNotifier {
  AppState() {
    api = ApiClient(onTokens: _persistTokens, onSessionLost: _sessionLost);
  }

  late final ApiClient api;
  final FlutterSecureStorage _secure = const FlutterSecureStorage();
  SharedPreferences? _prefs;

  AuthStatus status = AuthStatus.unknown;
  Map<String, dynamic> user = <String, dynamic>{};

  /// Sube cada vez que cambian datos (sesion registrada, reto unido...) para que las pantallas recarguen.
  int version = 0;
  int unreadNotifs = 0;

  /// Nivel de experiencia que elige el estudiante al registrarse (solo se guarda en el telefono).
  String experience = '';

  List<Map<String, dynamic>> pending = <Map<String, dynamic>>[];
  bool _syncing = false;

  bool get isAdmin => asStr(user['rol']) == 'admin';
  int get userId => asInt(user['id']);
  String get firstName => asStr(user['nombre']);
  String get fullName => '${asStr(user['nombre'])} ${asStr(user['apellido'])}'.trim();
  String get initials => Fmt.initials(asStr(user['nombre']), asStr(user['apellido']));
  List<Map<String, dynamic>> get myPending => pending.where((p) => asInt(p['uid']) == userId).toList();

  // ---------------------------------------------------------------- arranque
  Future<void> bootstrap() async {
    final started = DateTime.now();
    _prefs = await SharedPreferences.getInstance();
    final pend = _prefs?.getString('pending');
    if (pend != null) {
      try {
        pending = asList(jsonDecode(pend));
      } catch (_) {
        pending = <Map<String, dynamic>>[];
      }
    }

    String? refresh;
    try {
      refresh = await _secure.read(key: 'refresh');
      api.accessToken = await _secure.read(key: 'access');
    } catch (_) {
      refresh = null;
    }
    api.refreshToken = refresh;

    var next = AuthStatus.loggedOut;
    if (refresh != null) {
      try {
        final me = asMap(await api.get('/api/auth/me'));
        if (kRolesApp.contains(asStr(me['rol']))) {
          user = me;
          await _cacheUser();
          next = AuthStatus.loggedIn;
        } else {
          await _clearSession();
        }
      } on ApiException catch (e) {
        if (e.isNetwork) {
          // Sin conexion al abrir la app: se entra con los datos guardados en el telefono.
          final cached = _prefs?.getString('user');
          if (cached != null) {
            user = asMap(jsonDecode(cached));
            next = AuthStatus.loggedIn;
          }
        } else {
          await _clearSession(); // el servidor rechazo la sesion guardada: se borra
        }
      }
    }
    _loadLocalForUser();

    final elapsed = DateTime.now().difference(started);
    const minimo = Duration(milliseconds: 1100); // que el splash se alcance a ver
    if (elapsed < minimo) await Future.delayed(minimo - elapsed);
    _setStatus(next);
    if (next == AuthStatus.loggedIn) syncPending();
  }

  void _loadLocalForUser() {
    experience = _prefs?.getString('exp_$userId') ?? '';
  }

  Future<void> setExperience(String nivel) async {
    experience = nivel;
    await _prefs?.setString('exp_$userId', nivel);
    notifyListeners();
  }

  // ---------------------------------------------------------------- sesion
  Future<LoginOutcome> login(String email, String password) async {
    final data = asMap(await api.post('/api/auth/login', body: {'email': email.trim(), 'password': password}, auth: false));
    if (data['requiere_2fa'] == true) return LoginOutcome('code', asStr(data['desafio']));
    if (data['requiere_configurar_2fa'] == true) return LoginOutcome('setup', asStr(data['desafio']));
    await _enter(data);
    return const LoginOutcome('ok');
  }

  Future<void> _enter(Map<String, dynamic> data) async {
    await _beginSession(data);
    _loadLocalForUser();
    _setStatus(AuthStatus.loggedIn);
    syncPending();
  }

  /// Segundo paso del login: codigo de la app de autenticacion o codigo de respaldo.
  Future<void> verifyTwoFactor(String desafio, String codigo) async {
    final data = asMap(await api.post('/api/auth/login/2fa', body: {'desafio': desafio, 'codigo': codigo.trim()}, auth: false));
    await _enter(data);
  }

  /// Admin sin 2FA: pide el secreto para configurarlo (todavia no tiene sesion).
  Future<Map<String, dynamic>> startInitialTwoFactor(String desafio) async =>
      asMap(await api.post('/api/auth/login/2fa/setup', body: {'desafio': desafio}, auth: false));

  Map<String, dynamic>? _pendingLogin;

  /// Confirma el 2FA inicial. Devuelve los codigos de respaldo; la sesion se abre al llamar finishPendingLogin()
  /// (asi la persona alcanza a guardar los codigos antes de entrar).
  Future<List<String>> confirmInitialTwoFactor(String desafio, String codigo) async {
    final data = asMap(await api.post('/api/auth/login/2fa/confirm', body: {'desafio': desafio, 'codigo': codigo.trim()}, auth: false));
    _pendingLogin = data;
    final lista = data['codigos_respaldo'];
    return lista is List ? lista.map((e) => e.toString()).toList() : <String>[];
  }

  Future<void> finishPendingLogin() async {
    final d = _pendingLogin;
    _pendingLogin = null;
    if (d != null) await _enter(d);
  }

  Future<void> forgotPassword(String email) async {
    await api.post('/api/auth/password/forgot', body: {'email': email.trim()}, auth: false);
  }

  Future<void> resetPassword(String email, String codigo, String nueva) async {
    await api.post('/api/auth/password/reset', body: {'email': email.trim(), 'codigo': codigo.trim(), 'nueva': nueva}, auth: false);
  }

  Future<void> register({
    required String nombre,
    required String apellido,
    required String email,
    required String password,
    required double peso,
    required double altura,
    required String nivel,
    required String condiciones,
    required Map<String, bool> consentimientos,
    required String versionConsentimiento,
  }) async {
    final data = asMap(await api.post('/api/auth/register', auth: false, body: {
      'nombre': nombre,
      'apellido': apellido,
      'email': email.trim(),
      'password': password,
      'consentimientos': consentimientos,
      'version_consentimiento': versionConsentimiento,
    }));
    await _beginSession(data);
    await setExperience(nivel);

    String? aviso;
    try {
      await api.post('/api/clinical/students/me/measurements', body: {'peso_kg': peso, 'estatura_cm': altura});
      if (condiciones.trim().isNotEmpty && consentimientos['datos_salud'] == true) {
        await api.put('/api/clinical/students/me/history', body: {'condiciones': condiciones.trim()});
      }
    } catch (_) {
      aviso = 'Cuenta creada, pero no pude guardar tu historial. Complétalo en Perfil › Historial clínico.';
    }
    _setStatus(AuthStatus.loggedIn);
    if (aviso != null) toast(aviso);
  }

  Future<void> _beginSession(Map<String, dynamic> data) async {
    final u = asMap(data['usuario']);
    if (!kRolesApp.contains(asStr(u['rol']))) {
      try {
        await api.post('/api/auth/logout', body: {'refreshToken': data['refreshToken']}, auth: false);
      } catch (_) {}
      throw const ApiException(403, 'ROL_NO_SOPORTADO', 'Esta cuenta no puede usar la app.');
    }
    final access = asStr(data['accessToken']);
    final refresh = asStr(data['refreshToken']);
    api.accessToken = access;
    api.refreshToken = refresh;
    _persistTokens(access, refresh);
    user = u;
    await _cacheUser();
  }

  Future<void> logout() async {
    final rt = api.refreshToken;
    if (rt != null) {
      try {
        await api.post('/api/auth/logout', body: {'refreshToken': rt}, auth: false);
      } catch (_) {}
    }
    await _clearSession();
    _setStatus(AuthStatus.loggedOut);
  }

  /// Elimina la cuenta en el servidor (pide la contrasena) y cierra la sesion.
  Future<void> deleteAccount(String password) async {
    await api.delete('/api/auth/me', body: {'password': password});
    final uid = userId;
    pending.removeWhere((p) => asInt(p['uid']) == uid);
    await _savePending();
    await _prefs?.remove('exp_$uid');
    await _clearSession();
    _setStatus(AuthStatus.loggedOut);
  }

  void _persistTokens(String access, String refresh) {
    _secure.write(key: 'access', value: access);
    _secure.write(key: 'refresh', value: refresh);
  }

  Future<void> _cacheUser() async {
    await _prefs?.setString('user', jsonEncode(user));
  }

  Future<void> _clearSession() async {
    api.accessToken = null;
    api.refreshToken = null;
    try {
      await _secure.delete(key: 'access');
      await _secure.delete(key: 'refresh');
    } catch (_) {}
    await _prefs?.remove('user');
    user = <String, dynamic>{};
    unreadNotifs = 0;
    experience = '';
  }

  void _sessionLost() {
    if (status != AuthStatus.loggedIn) return;
    _clearSession();
    _setStatus(AuthStatus.expired);
  }

  void _setStatus(AuthStatus s) {
    status = s;
    navigatorKey.currentState?.popUntil((route) => route.isFirst); // cierra login / registro / 2FA apilados
    if (s != AuthStatus.loggedIn) shellTab.value = 0;
    version++;
    notifyListeners();
  }

  /// Desde la pantalla "sesion expirada" hacia el login.
  void leaveExpired() => _setStatus(AuthStatus.loggedOut);

  void bump() {
    version++;
    notifyListeners();
  }

  // ---------------------------------------------------------------- notificaciones
  Future<void> refreshUnread() async {
    try {
      final data = asMap(await api.get('/api/social/notifications'));
      final n = asInt(data['no_leidas']);
      if (n != unreadNotifs) {
        unreadNotifs = n;
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> markNotificationsRead() async {
    try {
      await api.post('/api/social/notifications/read');
      unreadNotifs = 0;
      notifyListeners();
    } catch (_) {}
  }

  // ---------------------------------------------------------------- sesiones sin conexion
  Future<void> queueSession(Map<String, dynamic> payload) async {
    pending.add(<String, dynamic>{...payload, 'uid': userId, 'queuedAt': DateTime.now().toIso8601String()});
    await _savePending();
    notifyListeners();
  }

  Future<void> _savePending() async {
    await _prefs?.setString('pending', jsonEncode(pending));
  }

  /// Envia las sesiones guardadas sin conexion. Devuelve cuantas se sincronizaron.
  Future<int> syncPending() async {
    if (_syncing || status != AuthStatus.loggedIn) return 0;
    _syncing = true;
    var done = 0;
    try {
      for (final p in List<Map<String, dynamic>>.from(myPending)) {
        try {
          final body = Map<String, dynamic>.from(p)
            ..remove('uid')
            ..remove('queuedAt');
          await api.post('/api/social/sessions', body: body);
          pending.remove(p);
          done++;
        } on ApiException catch (e) {
          if (e.isNetwork) break;
          pending.remove(p); // el servidor la rechazo (p. ej. fecha muy antigua): no se reintenta eternamente
        }
      }
    } finally {
      _syncing = false;
    }
    await _savePending();
    if (done > 0) {
      toast('Sincronización completa: $done sesión(es) enviada(s).', type: ToastType.success);
      bump();
    } else {
      notifyListeners();
    }
    return done;
  }
}

final AppState app = AppState();
