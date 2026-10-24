import '../common.dart';
import 'duelos.dart';
import 'premium.dart';
import 'soporte.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  static String _icon(String tipo) {
    switch (tipo) {
      case 'racha':
        return 'flame';
      case 'nivel':
        return 'bar-chart-3';
      case 'insignia':
        return 'medal';
      case 'reto':
        return 'trophy';
      case 'squad':
        return 'users';
      case 'duelo':
        return 'target';
      case 'soporte':
        return 'message-circle';
      case 'pago':
        return 'sparkles';
      default:
        return 'bell';
    }
  }

  static String _tone(String tipo) {
    switch (tipo) {
      case 'racha':
        return 'orange';
      case 'nivel':
        return 'purple';
      case 'insignia':
        return 'gold';
      case 'reto':
        return 'purple';
      case 'squad':
        return 'blue';
      case 'duelo':
        return 'orange';
      case 'soporte':
        return 'green';
      case 'pago':
        return 'purple';
      default:
        return 'grey';
    }
  }

  Future<Map<String, dynamic>> _load() async {
    final data = asMap(await app.api.get('/api/social/notifications'));
    app.markNotificationsRead(); // se muestran como "nuevas" esta vez y quedan leidas
    return data;
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Notificaciones',
      body: LoadView<Map<String, dynamic>>(
        loader: _load,
        builder: (context, data, reload) {
          final items = asList(data['items']);
          if (items.isEmpty) {
            return PfList(onRefresh: reload, children: const [
              EmptyState(pose: 'pensativo', title: 'Todo al día', body: 'Cuando haya novedades de tu racha, tu squad o tus retos las verás aquí.'),
            ]);
          }
          return PfList(
            onRefresh: reload,
            children: [
              RowCard([
                for (final n in items)
                  RowTile(
                    title: asStr(n['titulo']),
                    sub: [
                      if (asStr(n['cuerpo']).isNotEmpty) asStr(n['cuerpo']),
                      Fmt.relative(asStr(n['created_at'])),
                    ].join(' · '),
                    left: IconDisc(_icon(asStr(n['tipo'])), tone: _tone(asStr(n['tipo']))),
                    chevron: asStr(n['tipo']) == 'duelo' || asStr(n['tipo']) == 'soporte' || (asStr(n['tipo']) == 'pago' && !app.isAdmin),
                    onTap: asStr(n['tipo']) == 'duelo'
                        ? () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const DuelosScreen()))
                        : (asStr(n['tipo']) == 'soporte'
                            ? () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SoporteScreen()))
                            : (asStr(n['tipo']) == 'pago' && !app.isAdmin
                                ? () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const PremiumScreen()))
                                : null)),
                    right: asBool(n['leida'])
                        ? null
                        : Container(width: 9, height: 9, decoration: const BoxDecoration(color: C.gold, shape: BoxShape.circle)),
                  ),
              ]),
            ],
          );
        },
      ),
    );
  }
}
