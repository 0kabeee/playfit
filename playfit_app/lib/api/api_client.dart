import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config.dart';
import '../util.dart';

/// Error de la API: el backend siempre responde { "error": { "code", "message" } }.
class ApiException implements Exception {
  final int status; // 0 = sin conexion
  final String code;
  final String message;
  const ApiException(this.status, this.code, this.message);

  bool get isNetwork => status == 0;

  /// El servidor respondio con un error propio (5xx): caido, sin base de datos, etc.
  bool get isServer => status >= 500;

  @override
  String toString() => message;
}

/// Cliente HTTP del gateway: agrega el token, lo renueva solo si vencio y traduce los errores.
class ApiClient {
  ApiClient({required this.onTokens, required this.onSessionLost, http.Client? client}) : _client = client ?? http.Client();

  /// Se llama cada vez que hay tokens nuevos (para guardarlos de forma segura).
  final void Function(String access, String refresh) onTokens;

  /// Se llama cuando el refresh token ya no sirve: hay que volver a iniciar sesion.
  final void Function() onSessionLost;

  String? accessToken;
  String? refreshToken;

  /// true cuando la ultima peticion fallo por falta de conexion
  final ValueNotifier<bool> offline = ValueNotifier<bool>(false);

  final http.Client _client;
  Future<bool>? _refreshing;

  Future<dynamic> get(String path, {Map<String, String>? query}) => _send('GET', path, query: query);

  Future<dynamic> post(String path, {Object? body, bool auth = true}) => _send('POST', path, body: body, auth: auth);

  Future<dynamic> put(String path, {Object? body}) => _send('PUT', path, body: body);

  Future<dynamic> patch(String path, {Object? body}) => _send('PATCH', path, body: body);

  Future<dynamic> delete(String path, {Object? body}) => _send('DELETE', path, body: body);

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    bool auth = true,
    bool canRetry = true,
  }) async {
    var uri = Uri.parse('${Config.apiBase}$path');
    if (query != null && query.isNotEmpty) uri = uri.replace(queryParameters: query);

    final req = http.Request(method, uri);
    req.headers['Content-Type'] = 'application/json';
    req.headers['Accept'] = 'application/json';
    if (auth && accessToken != null) req.headers['Authorization'] = 'Bearer $accessToken';
    if (body != null) req.body = jsonEncode(body);

    http.Response res;
    try {
      final streamed = await _client.send(req).timeout(const Duration(seconds: 15));
      res = await http.Response.fromStream(streamed);
    } on TimeoutException {
      offline.value = true;
      throw const ApiException(0, 'SIN_CONEXION', 'El servidor tardó demasiado en responder.');
    } on SocketException {
      offline.value = true;
      throw const ApiException(0, 'SIN_CONEXION', 'No hay conexión con el servidor. Revisa que esté encendido.');
    } on http.ClientException {
      offline.value = true;
      throw const ApiException(0, 'SIN_CONEXION', 'No hay conexión con el servidor. Revisa que esté encendido.');
    }
    offline.value = false;

    dynamic data;
    if (res.bodyBytes.isNotEmpty) {
      try {
        data = jsonDecode(utf8.decode(res.bodyBytes));
      } catch (_) {
        data = null;
      }
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;

    final err = asMap(data is Map ? data['error'] : null);
    final code = asStr(err['code'], 'ERROR');
    final message = asStr(err['message'], 'Ocurrió un error (${res.statusCode}).');

    final tokenProblem =
        res.statusCode == 401 && (code == 'TOKEN_EXPIRADO' || code == 'TOKEN_INVALIDO' || code == 'NO_AUTENTICADO');
    if (tokenProblem && auth && canRetry && refreshToken != null) {
      final ok = await _refresh();
      if (ok) return _send(method, path, query: query, body: body, auth: auth, canRetry: false);
      onSessionLost();
    }
    // Cuenta desactivada por un administrador: no tiene sentido renovar el token, se cierra la sesion.
    if (res.statusCode == 401 && code == 'CUENTA_INACTIVA' && auth) onSessionLost();
    throw ApiException(res.statusCode, code, message);
  }

  // Si varias peticiones fallan a la vez por token vencido, solo se hace UN refresh.
  Future<bool> _refresh() {
    return _refreshing ??= _doRefresh().whenComplete(() {
      _refreshing = null;
    });
  }

  Future<bool> _doRefresh() async {
    final rt = refreshToken;
    if (rt == null) return false;
    try {
      final data = asMap(await _send('POST', '/api/auth/refresh', body: {'refreshToken': rt}, auth: false, canRetry: false));
      final a = data['accessToken'];
      final r = data['refreshToken'];
      if (a is String && r is String) {
        accessToken = a;
        refreshToken = r;
        onTokens(a, r);
        return true;
      }
      return false;
    } on ApiException catch (e) {
      if (e.isNetwork) rethrow; // sin internet no se cierra la sesion
      return false;
    }
  }
}
