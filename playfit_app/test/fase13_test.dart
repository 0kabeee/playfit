import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playfit_app/api/api_client.dart';
import 'package:playfit_app/config.dart';
import 'package:playfit_app/screens/chatbot.dart';
import 'package:playfit_app/services/push_service.dart';
import 'package:playfit_app/theme/lucide.dart';

const _json = {'content-type': 'application/json; charset=utf-8'};

ApiClient _api(List<http.Request> vistos, Map<String, http.Response Function(http.Request)> rutas) {
  final api = ApiClient(
    onTokens: (_, __) {},
    onSessionLost: () {},
    client: MockClient((req) async {
      vistos.add(req);
      final r = rutas['${req.method} ${req.url.path}'];
      return r == null ? http.Response('{"error":{"code":"RUTA_NO_ENCONTRADA","message":"no"}}', 404, headers: _json) : r(req);
    }),
  );
  api.accessToken = 'tok';
  return api;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized(); // toast() consulta el ScaffoldMessenger global

  group('Fase 13 · propuestas del agente', () {
    test('confirmar "registrar sesion" llama al endpoint normal con los datos propuestos y luego informa al asistente', () async {
      final vistos = <http.Request>[];
      final datos = {
        'fecha': '2026-10-23',
        'ejercicios': [
          {'ejercicio_id': 1, 'series': [{'repeticiones': 12, 'peso_kg': 40}]}
        ]
      };
      final api = _api(vistos, {
        'POST /api/social/sessions': (_) => http.Response(jsonEncode({'sesion_id': 77, 'xp_ganado': 25}), 201, headers: _json),
        'POST /api/content/ai/actions/5': (req) =>
            http.Response(jsonEncode({'id': 5, 'estado': 'confirmada', 'resultado_id': 77, 'tipo': 'registrar_sesion'}), 200, headers: _json),
      });
      final a = await confirmarAccionAgente(api, {'id': 5, 'tipo': 'registrar_sesion', 'datos': datos, 'estado': 'propuesta'});
      expect(a['estado'], 'confirmada');
      expect(vistos.map((r) => r.url.path), ['/api/social/sessions', '/api/content/ai/actions/5']);
      expect(jsonDecode(vistos[0].body), datos);
      expect(jsonDecode(vistos[1].body), {'estado': 'confirmada', 'resultado_id': 77});
    });

    test('confirmar "crear reto" usa el endpoint del squad', () async {
      final vistos = <http.Request>[];
      final api = _api(vistos, {
        'POST /api/social/squads/me/challenges': (_) => http.Response(jsonEncode({'id': 31, 'titulo': 'Semana'}), 201, headers: _json),
        'POST /api/content/ai/actions/8': (_) => http.Response(jsonEncode({'id': 8, 'estado': 'confirmada', 'resultado_id': 31}), 200, headers: _json),
      });
      await confirmarAccionAgente(api, {
        'id': 8,
        'tipo': 'crear_reto_squad',
        'datos': {'titulo': 'Semana', 'metrica': 'sesiones', 'meta': 3, 'dias': 7, 'tipo': 'squad'}
      });
      expect(jsonDecode(vistos[1].body)['resultado_id'], 31);
    });

    test('si el endpoint normal rechaza la accion, NO se marca como confirmada', () async {
      final vistos = <http.Request>[];
      final api = _api(vistos, {
        'POST /api/social/squads/me/challenges': (_) => http.Response(
            jsonEncode({'error': {'code': 'LIMITE_RETOS_SQUAD', 'message': 'Tu squad ya tiene 3 retos vigentes.'}}), 409,
            headers: _json),
      });
      await expectLater(
        confirmarAccionAgente(api, {'id': 9, 'tipo': 'crear_reto_squad', 'datos': {'titulo': 'X'}}),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'LIMITE_RETOS_SQUAD')),
      );
      expect(vistos.length, 1, reason: 'no debe llamar a /ai/actions si fallo la accion');
    });
  });

  group('Fase 13 · push y voz', () {
    test('sin los datos de Firebase la app no intenta registrar el celular', () async {
      expect(Config.pushConfigurado, isFalse);
      final vistos = <http.Request>[];
      final push = PushService(_api(vistos, {}), onForeground: (_, __) {});
      await push.registrar();
      await push.quitar();
      expect(vistos, isEmpty);
    });

    test('existen los iconos nuevos del asistente', () {
      for (final i in ['mic', 'square', 'volume-2', 'volume-x', 'sparkles']) {
        expect(kLucide.containsKey(i), isTrue, reason: i);
      }
    });
  });
}
