import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playfit_app/api/api_client.dart';
import 'package:playfit_app/util.dart';

void main() {
  group('Fase 12 · utilidades de retos y duelos', () {
    test('la metrica peso maximo tiene unidad, etiqueta, icono y color propios', () {
      expect(metricUnit('peso_maximo'), 'kg');
      expect(metricLabel('peso_maximo'), 'Peso máximo');
      expect(metricIcon('peso_maximo'), 'target');
      expect(metricTone('peso_maximo'), 'green');
      expect(metricUnit('dias_activos'), 'días activos');
    });

    test('la XP que se muestra al crear un reto coincide con la regla del servidor', () {
      expect(xpRetoSquad(1), 60);
      expect(xpRetoSquad(7), 120);
      expect(xpRetoSquad(30), 300); // tope
    });

    test('etiqueta de retos creados dentro del squad', () {
      expect(tipoRetoLabel('squad'), 'Reto de squad');
      expect(tipoRetoLabel('squad', deSquad: true), contains('entre todos'));
      expect(tipoRetoLabel('individual', deSquad: true), contains('cada uno'));
    });
  });

  group('Fase 12 · ApiClient', () {
    test('DELETE de un reto devuelve null con 204', () async {
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
      expect(await api.delete('/api/social/challenges/9'), isNull);
      expect(visto.method, 'DELETE');
      expect(visto.url.path, '/api/social/challenges/9');
    });

    test('el error de limite de retos del squad llega con su codigo', () async {
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async => http.Response(
              jsonEncode({'error': {'code': 'LIMITE_RETOS_SQUAD', 'message': 'Tu squad ya tiene 3 retos vigentes.'}}),
              409,
              headers: {'content-type': 'application/json; charset=utf-8'},
            )),
      );
      api.accessToken = 'tok';
      await expectLater(
        api.post('/api/social/squads/me/challenges', body: {'titulo': 'x'}),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'LIMITE_RETOS_SQUAD').having((e) => e.status, 'status', 409)),
      );
    });
  });
}
