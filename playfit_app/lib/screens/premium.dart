import 'package:url_launcher/url_launcher.dart';

import '../common.dart';
import 'soporte.dart';

// ====================================================================== PLAYFIT PREMIUM (Fase 14)
// Lo que se paga es la personalizacion del asistente de IA: memoria, voz y mas mensajes al dia.
// El pago se hace en el checkout de Wompi (sandbox = pago de prueba); PlayFit nunca ve los datos de pago.

String precioCop(int pesos) {
  final s = pesos.toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return '\$${b.toString()}';
}

String estadoPagoLabel(String estado) {
  switch (estado) {
    case 'aprobado':
      return 'Pagado';
    case 'rechazado':
      return 'No aprobado';
    case 'anulado':
      return 'Anulado';
    case 'error':
      return 'Con problema';
    default:
      return 'Pendiente';
  }
}

String estadoPagoTone(String estado) {
  switch (estado) {
    case 'aprobado':
      return 'green';
    case 'rechazado':
    case 'anulado':
    case 'error':
      return 'pink';
    default:
      return 'gold';
  }
}

/// Fecha 'YYYY-MM-DD...' -> '22/11/2026'.
String fechaPremium(String iso) {
  if (iso.length < 10) return '';
  final p = iso.substring(0, 10).split('-');
  return p.length == 3 ? '${p[2]}/${p[1]}/${p[0]}' : '';
}

Future<void> abrirCheckout(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null || uri.scheme != 'https') {
    toast('El enlace de pago no es válido', type: ToastType.error);
    return;
  }
  final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!ok) toast('No pude abrir el navegador', type: ToastType.error);
}

/// Hoja que se muestra cuando alguien sin Premium toca una función Premium (voz, memoria).
Future<void> pedirPremium(BuildContext context, String que) async {
  await showPfSheet<void>(
    context,
    (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const IconDisc('sparkles', tone: 'purple', size: 36),
          const SizedBox(width: 10),
          Expanded(child: Text('$que es Premium', style: Tx.display(size: 19))),
        ]),
        const SizedBox(height: 10),
        Text('Con PlayFit Premium el asistente se adapta a ti: recuerda tu objetivo y tu horario, te deja hablarle y te responde en voz alta.',
            style: Tx.body(size: 13, color: C.inkSoft, height: 1.45)),
        const SizedBox(height: 16),
        PfButton('Ver PlayFit Premium', kind: BtnKind.gold, icon: 'sparkles', onPressed: () {
          Navigator.pop(ctx);
          Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const PremiumScreen()));
        }),
      ],
    ),
  );
}

/// Tarjeta de un enlace de pago dentro del chat de Soporte.
class PagoCard extends StatelessWidget {
  final Map<String, dynamic> pago;
  final bool admin;
  const PagoCard(this.pago, {super.key, this.admin = false});

  @override
  Widget build(BuildContext context) {
    final estado = asStr(pago['estado']);
    final url = asStr(pago['checkout_url']);
    final sandbox = asStr(pago['ambiente']) != 'production';
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: C.surface, border: Border.all(color: C.lineStrong), borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const IconDisc('sparkles', tone: 'purple', size: 30),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('PlayFit Premium · ${asInt(pago['dias'])} días', style: Tx.body(size: 13, w: FontWeight.w700)),
                Text('${precioCop(asInt(pago['monto_cop']))} COP${sandbox ? ' · pago de prueba' : ''}', style: Tx.body(size: 11.5, color: C.inkSoft)),
              ]),
            ),
            PfBadge(estadoPagoLabel(estado), tone: estadoPagoTone(estado)),
          ]),
          if (!admin && url.isNotEmpty) ...[
            const SizedBox(height: 10),
            PfButton('Pagar con Wompi', kind: BtnKind.gold, small: true, onPressed: () => abrirCheckout(url)),
            const SizedBox(height: 6),
            Text('Al terminar vuelve a la app: el Premium se activa solo cuando Wompi confirma el pago.',
                style: Tx.body(size: 10.5, color: C.inkMute, height: 1.4)),
          ],
        ],
      ),
    );
  }
}

class PremiumScreen extends StatelessWidget {
  const PremiumScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'PlayFit Premium',
      body: LoadView<Map<String, dynamic>>(
        loader: () async {
          final d = asMap(await app.api.get('/api/social/premium'));
          app.setPremium(asBool(d['premium']), asStr(d['premium_hasta']));
          return d;
        },
        builder: (context, d, reload) {
          final activo = asBool(d['premium']);
          final pagos = asList(d['pagos']);
          final raw = d['beneficios'];
          final beneficios = raw is List ? raw.map((b) => b.toString()).toList() : <String>[];
          final sandbox = asStr(d['ambiente']) != 'production';
          return PfList(onRefresh: reload, children: [
            if (activo)
              MascotNote('yeah', '¡Eres Premium! Tu asistente te recuerda y puedes hablarle. Activo hasta el ${fechaPremium(asStr(d['premium_hasta']))}.')
            else
              const MascotNote('energizado', 'Haz que el asistente se adapte a ti: que recuerde tu objetivo, te escuche y te hable.'),
            PfCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(child: Text(activo ? 'Tu plan: Premium' : 'Tu plan: Gratis', style: Tx.display(size: 18))),
                    if (activo) PfBadge('${asInt(d['dias_restantes'])} días', tone: 'green'),
                  ]),
                  const SizedBox(height: 6),
                  Text('${precioCop(asInt(d['precio_cop']))} COP por ${asInt(d['dias_por_pago'])} días${sandbox ? ' · pagos de prueba (sandbox)' : ''}',
                      style: Tx.body(size: 12.5, color: C.inkSoft)),
                  const SizedBox(height: 12),
                  for (final b in beneficios)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Padding(padding: EdgeInsets.only(top: 1), child: LIcon('check-circle', size: 16, color: C.purple)),
                        const SizedBox(width: 8),
                        Expanded(child: Text(b, style: Tx.body(size: 13, height: 1.4))),
                      ]),
                    ),
                  Text('Rachas, XP, squads, retos, duelos, ranking, cámara y técnica siguen siendo gratis.',
                      style: Tx.body(size: 11.5, color: C.inkMute, height: 1.4)),
                ],
              ),
            ),
            PfButton(activo ? 'Renovar Premium' : 'Quiero el Premium', kind: BtnKind.gold, icon: 'sparkles', onPressed: () async {
              await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SoporteScreen(mensajeInicial: 'Quiero el Premium')));
              reload();
            }),
            const PanelNote('Te atiende una persona del equipo por el chat de Soporte y te envía el enlace de pago. Pagas en Wompi (tarjeta, Nequi o PSE); PlayFit nunca ve los datos de tu pago.', icon: 'shield-check'),
            if (pagos.isNotEmpty) ...[
              const SectionLabel('Mis pagos'),
              PfCard(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                child: Column(children: [
                  for (final p in pagos)
                    RowTile(
                      title: '${precioCop(asInt(p['monto_cop']))} · ${asInt(p['dias'])} días',
                      sub: Fmt.relative(asStr(p['created_at'])),
                      right: asStr(p['checkout_url']).isNotEmpty
                          ? PfButton('Pagar', kind: BtnKind.gold, small: true, expand: false, onPressed: () => abrirCheckout(asStr(p['checkout_url'])))
                          : PfBadge(estadoPagoLabel(asStr(p['estado'])), tone: estadoPagoTone(asStr(p['estado']))),
                      last: p == pagos.last,
                    ),
                ]),
              ),
            ],
          ]);
        },
      ),
    );
  }
}
