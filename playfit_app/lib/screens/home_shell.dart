import '../common.dart';
import 'dashboard_tab.dart';
import 'notifications.dart';
import 'perfil.dart';
import 'retos.dart';
import 'squad.dart';
import 'tecnica.dart';

/// Contenedor con las 5 pestañas (Inicio, Squad, Retos, Técnica, Perfil).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  static const List<String> _titles = ['Inicio', 'Mi squad', 'Retos', 'Técnica', 'Mi perfil'];
  static const List<String> _icons = ['home', 'users', 'trophy', 'book-open', 'circle-user'];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    shellTab.addListener(_onTab);
    app.refreshUnread();
  }

  @override
  void dispose() {
    shellTab.removeListener(_onTab);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _onTab() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      app.syncPending();
      app.refreshUnread();
      app.bump(); // al volver a la app se refrescan los datos
    }
  }

  List<Widget> _actions(BuildContext context, int tab) {
    switch (tab) {
      case 0:
        return [
          ListenableBuilder(
            listenable: app,
            builder: (context, _) => PfIconButton(
              'bell',
              dot: app.unreadNotifs > 0,
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const NotificationsScreen())),
            ),
          ),
        ];
      case 1:
        return [
          PfIconButton('plus', onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const InvitarScreen()))),
        ];
      case 4:
        return [
          PfIconButton('settings', onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const CuentaScreen()))),
        ];
      default:
        return const [];
    }
  }

  @override
  Widget build(BuildContext context) {
    final tab = shellTab.value;
    return Scaffold(
      backgroundColor: C.cream,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            const OfflineBanner(),
            PfAppBar(title: _titles[tab], actions: _actions(context, tab)),
            Expanded(
              child: IndexedStack(
                index: tab,
                children: const [DashboardTab(), SquadTab(), RetosTab(), TecnicaTab(), PerfilTab()],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(color: C.surface, border: Border(top: BorderSide(color: C.line))),
        padding: EdgeInsets.fromLTRB(4, 8, 4, 8 + MediaQuery.of(context).padding.bottom),
        child: Row(
          children: [
            for (var i = 0; i < _titles.length; i++)
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => shellTab.value = i,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 160),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        decoration: BoxDecoration(
                          color: tab == i ? C.goldBg : Colors.transparent,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: LIcon(_icons[i], size: 21, color: tab == i ? C.ink : C.inkMute),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _titles[i] == 'Mi squad' ? 'Squad' : (_titles[i] == 'Mi perfil' ? 'Perfil' : _titles[i]),
                        style: Tx.body(size: 10.5, w: FontWeight.w700, color: tab == i ? C.ink : C.inkMute),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
