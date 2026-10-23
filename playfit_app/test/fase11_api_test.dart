import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playfit_app/api/api_client.dart';

void main() {
  group('Fase 11 · ApiClient', () {
    test('patch usa el metodo PATCH y una respuesta 204 devuelve null', () async {
      late http.Request visto;
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async {
          visto = req;
          return http.Response('', 204);
        }),
      );
      api.accessToken = 'tok';
      final r = await api.patch('/api/auth/users/5', body: {'activo': false});
      expect(r, isNull);
      expect(visto.method, 'PATCH');
      expect(visto.url.path, '/api/auth/users/5');
      expect(jsonDecode(visto.body), {'activo': false});
      expect(visto.headers['Authorization'], 'Bearer tok');
    });

    test('el login que pide 2FA llega como JSON normal (sin tokens)', () async {
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async => http.Response(
              jsonEncode({'requiere_2fa': true, 'desafio': 'abc'}),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            )),
      );
      final data = await api.post('/api/auth/login', body: {'email': 'a@b.co', 'password': 'x'}, auth: false) as Map;
      expect(data['requiere_2fa'], true);
      expect(data.containsKey('accessToken'), false);
    });

    test('un codigo 2FA incorrecto es un ApiException con su codigo, sin cerrar la sesion', () async {
      var perdida = false;
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () => perdida = true,
        client: MockClient((req) async => http.Response(
              jsonEncode({'error': {'code': 'CODIGO_2FA_INVALIDO', 'message': 'Codigo incorrecto'}}),
              401,
              headers: {'content-type': 'application/json; charset=utf-8'},
            )),
      );
      await expectLater(
        api.post('/api/auth/login/2fa', body: {'desafio': 'x', 'codigo': '000000'}, auth: false),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'CODIGO_2FA_INVALIDO')),
      );
      expect(perdida, false);
    });
  });
}
