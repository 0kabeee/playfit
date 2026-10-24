import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playfit_app/api/api_client.dart';
import 'package:playfit_app/screens/premium.dart';

void main() {
  group('Fase 14 · Premium', () {
    test('el precio se muestra en pesos con separador de miles', () {
      expect(precioCop(9900), '\$9.900');
      expect(precioCop(990), '\$990');
      expect(precioCop(1250000), '\$1.250.000');
    });

    test('cada estado de pago tiene etiqueta y color', () {
      expect(estadoPagoLabel('aprobado'), 'Pagado');
      expect(estadoPagoLabel('pendiente'), 'Pendiente');
      expect(estadoPagoLabel('rechazado'), 'No aprobado');
      expect(estadoPagoTone('aprobado'), 'green');
      expect(estadoPagoTone('error'), 'pink');
      expect(estadoPagoTone('pendiente'), 'gold');
    });

    test('la fecha de vencimiento se muestra dia/mes/ano', () {
      expect(fechaPremium('2026-11-22T15:04:00.000Z'), '22/11/2026');
      expect(fechaPremium(''), '');
    });
  });

  group('Fase 14 · ApiClient', () {
    test('el admin envia el enlace de pago y llega el pago pendiente', () async {
      late http.Request visto;
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async {
          visto = req;
          return http.Response(
            jsonEncode({'id': 4, 'estado': 'pendiente', 'monto_cop': 9900, 'dias': 30}),
            201,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      api.accessToken = 'tok';
      final r = await api.post('/api/social/admin/support/12/payment-link') as Map<String, dynamic>;
      expect(visto.method, 'POST');
      expect(visto.url.path, '/api/social/admin/support/12/payment-link');
      expect(r['estado'], 'pendiente');
    });

    test('sin claves de Wompi el servidor responde un codigo claro', () async {
      final api = ApiClient(
        onTokens: (_, __) {},
        onSessionLost: () {},
        client: MockClient((req) async => http.Response(
              jsonEncode({'error': {'code': 'PAGOS_NO_CONFIGURADOS', 'message': 'Los pagos no estan configurados en el servidor.'}}),
              503,
              headers: {'content-type': 'application/json; charset=utf-8'},
            )),
      );
      api.accessToken = 'tok';
      await expectLater(
        api.post('/api/social/admin/support/12/payment-link'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'PAGOS_NO_CONFIGURADOS')),
      );
    });
  });
}
