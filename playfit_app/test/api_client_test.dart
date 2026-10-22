import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playfit_app/api/api_client.dart';

http.Response _json(int status, Object body) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

Map<String, dynamic> _error(String code, String message) => {
      'error': {'code': code, 'message': message}
    };

void main() {
  group('ApiClient', () {
    test('respuesta 200: devuelve el JSON y marca online', () async {
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async => _json(200, {'ok': true})),
      );
      final data = await api.get('/api/social/dashboard');
      expect(data, {'ok': true});
      expect(api.offline.value, false);
    });

    test('sin conexion: ApiException status 0 y offline = true', () async {
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async => throw const SocketException('sin red')),
      );
      await expectLater(
        api.get('/api/social/dashboard'),
        throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)),
      );
      expect(api.offline.value, true);
    });

    test('error del backend: se leen codigo y mensaje', () async {
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async => _json(429, _error('CUENTA_BLOQUEADA_TEMPORAL', 'Demasiados intentos fallidos'))),
      );
      await expectLater(
        api.post('/api/auth/login', body: {'email': 'a@b.co', 'password': 'x'}, auth: false),
        throwsA(isA<ApiException>()
            .having((e) => e.status, 'status', 429)
            .having((e) => e.code, 'code', 'CUENTA_BLOQUEADA_TEMPORAL')
            .having((e) => e.message, 'message', 'Demasiados intentos fallidos')),
      );
    });

    test('5xx se marca como error de servidor (isServer) y no como falta de conexion', () async {
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async =>
            _json(503, _error('BASE_DE_DATOS_NO_DISPONIBLE', 'El servidor no puede acceder a la base de datos'))),
      );
      await expectLater(
        api.get('/api/social/dashboard'),
        throwsA(isA<ApiException>()
            .having((e) => e.isServer, 'isServer', true)
            .having((e) => e.isNetwork, 'isNetwork', false)),
      );
    });

    test('token vencido: renueva UNA vez, guarda los tokens nuevos y repite la peticion', () async {
      final llamadas = <String>[];
      String? accessGuardado;
      String? refreshGuardado;
      final api = ApiClient(
        onTokens: (a, r) {
          accessGuardado = a;
          refreshGuardado = r;
        },
        onSessionLost: () => fail('no debia perder la sesion'),
        client: MockClient((req) async {
          llamadas.add('${req.method} ${req.url.path} ${req.headers['Authorization'] ?? '-'}');
          if (req.url.path == '/api/auth/refresh') {
            return _json(200, {'accessToken': 'nuevo-a', 'refreshToken': 'nuevo-r'});
          }
          if (req.headers['Authorization'] == 'Bearer viejo-a') {
            return _json(401, _error('TOKEN_EXPIRADO', 'Sesion expirada'));
          }
          return _json(200, {'datos': 1});
        }),
      )
        ..accessToken = 'viejo-a'
        ..refreshToken = 'viejo-r';

      final data = await api.get('/api/social/dashboard');
      expect(data, {'datos': 1});
      expect(accessGuardado, 'nuevo-a');
      expect(refreshGuardado, 'nuevo-r');
      expect(llamadas, [
        'GET /api/social/dashboard Bearer viejo-a',
        'POST /api/auth/refresh -',
        'GET /api/social/dashboard Bearer nuevo-a',
      ]);
    });

    test('varias peticiones con token vencido a la vez: un solo refresh', () async {
      var refrescos = 0;
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () => fail('no debia perder la sesion'),
        client: MockClient((req) async {
          if (req.url.path == '/api/auth/refresh') {
            refrescos++;
            await Future<void>.delayed(const Duration(milliseconds: 20));
            return _json(200, {'accessToken': 'nuevo-a', 'refreshToken': 'nuevo-r'});
          }
          if (req.headers['Authorization'] == 'Bearer viejo-a') {
            return _json(401, _error('TOKEN_EXPIRADO', 'Sesion expirada'));
          }
          return _json(200, {'ok': true});
        }),
      )
        ..accessToken = 'viejo-a'
        ..refreshToken = 'viejo-r';

      await Future.wait([api.get('/api/a'), api.get('/api/b'), api.get('/api/c')]);
      expect(refrescos, 1);
    });

    test('si el refresh falla (token reutilizado) se avisa que la sesion se perdio', () async {
      var sesionPerdida = false;
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () => sesionPerdida = true,
        client: MockClient((req) async {
          if (req.url.path == '/api/auth/refresh') {
            return _json(401, _error('TOKEN_REUTILIZADO', 'Sesion invalidada por seguridad'));
          }
          return _json(401, _error('TOKEN_EXPIRADO', 'Sesion expirada'));
        }),
      )
        ..accessToken = 'viejo-a'
        ..refreshToken = 'viejo-r';

      await expectLater(api.get('/api/social/dashboard'), throwsA(isA<ApiException>()));
      expect(sesionPerdida, true);
    });

    test('cuenta desactivada (CUENTA_INACTIVA): cierra la sesion sin intentar renovar el token', () async {
      var refrescos = 0;
      var sesionPerdida = false;
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () => sesionPerdida = true,
        client: MockClient((req) async {
          if (req.url.path == '/api/auth/refresh') refrescos++;
          return _json(401, _error('CUENTA_INACTIVA', 'Cuenta desactivada'));
        }),
      )
        ..accessToken = 'a'
        ..refreshToken = 'r';

      await expectLater(
        api.get('/api/social/dashboard'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'CUENTA_INACTIVA')),
      );
      expect(refrescos, 0);
      expect(sesionPerdida, true);
    });

    test('sin internet durante el refresh NO se pierde la sesion', () async {
      var sesionPerdida = false;
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () => sesionPerdida = true,
        client: MockClient((req) async {
          if (req.url.path == '/api/auth/refresh') throw const SocketException('sin red');
          return _json(401, _error('TOKEN_EXPIRADO', 'Sesion expirada'));
        }),
      )
        ..accessToken = 'viejo-a'
        ..refreshToken = 'viejo-r';

      await expectLater(
        api.get('/api/social/dashboard'),
        throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)),
      );
      expect(sesionPerdida, false);
    });
  });
}
