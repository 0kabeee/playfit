import 'dart:async';

import '../common.dart';
import 'perfil.dart' show CuentaScreen;
import 'soporte.dart' show SoporteBubble, SoporteInput;

/// Panel del administrador (equipo de PlayFit): metricas agregadas, usuarios, retos, soporte y auditoria.
/// El admin NUNCA ve datos clinicos ni entrenamientos individuales.
class AdminShell extends StatefulWidget {
  const AdminShell({super.key});

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  static const List<String> _titles = ['Resumen', 'Usuarios', 'Retos', 'Soporte', 'Auditoría'];
  static const List<String> _icons = ['bar-chart-3', 'users', 'trophy', 'message-circle', 'shield-check'];
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: C.cream,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            const OfflineBanner(),
            PfAppBar(
              title: 'Admin · ${_titles[_tab]}',
              actions: [
                PfIconButton('settings', onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const CuentaScreen()))),
              ],
            ),
            Expanded(
              child: IndexedStack(
                index: _tab,
                children: const [AdminResumenTab(), AdminUsuariosTab(), AdminRetosTab(), AdminSoporteTab(), AdminAuditoriaTab()],
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
                  onTap: () => setState(() => _tab = i),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 160),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                        decoration: BoxDecoration(color: _tab == i ? C.goldBg : Colors.transparent, borderRadius: BorderRadius.circular(999)),
                        child: LIcon(_icons[i], size: 21, color: _tab == i ? C.ink : C.inkMute),
                      ),
                      const SizedBox(height: 2),
                      Text(_titles[i], style: Tx.body(size: 10.5, w: FontWeight.w700, color: _tab == i ? C.ink : C.inkMute)),
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

// ====================================================================== RESUMEN (metricas agregadas)
class AdminResumenTab extends StatelessWidget {
  const AdminResumenTab({super.key});

  @override
  Widget build(BuildContext context) {
    return LoadView<Map<String, dynamic>>(
      loader: () async => asMap(await app.api.get('/api/auth/admin/metrics')),
      builder: (context, m, reload) {
        final semanas = asList(m['sesiones_por_semana']);
        final ret = m['retencion_7d'];
        return PfList(onRefresh: reload, children: [
          const PanelNote('Datos agregados y anónimos: nadie ve entrenamientos ni historiales de personas concretas.', icon: 'shield-check'),
          MetricGrid([
            MetricTile('Usuarios', '${asInt(m['usuarios_total'])}'),
            MetricTile('Nuevos (7 días)', '${asInt(m['usuarios_nuevos_7d'])}'),
            MetricTile('Activos (7 días)', '${asInt(m['usuarios_activos_7d'])}'),
            MetricTile('Retención 7 días', ret == null ? '—' : '${asInt(ret)}%'),
            MetricTile('Sesiones totales', '${asInt(m['sesiones_total'])}'),
            MetricTile('Squads', '${asInt(m['squads'])}'),
            MetricTile('Retos activos', '${asInt(m['retos_activos'])}'),
            MetricTile('Retos de squads', '${asInt(m['retos_de_squad_activos'])}'),
            MetricTile('Duelos en curso', '${asInt(m['duelos_activos'])}'),
            MetricTile('Soporte pendiente', '${asInt(m['soporte_pendientes'])}'),
            MetricTile('Con 2FA', '${asInt(m['usuarios_con_2fa'])}'),
          ]),
          const SectionLabel('Sesiones por semana'),
          if (semanas.isEmpty)
            Text('Aún no hay sesiones en las últimas 4 semanas.', style: Tx.body(size: 13, color: C.inkSoft))
          else
            PfCard(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Column(
                children: [
                  for (final s in semanas)
                    RowTile(
                      title: 'Semana del ${Fmt.dayLabel(asStr(s['desde']))}',
                      sub: '${asInt(s['usuarios'])} usuarios',
                      right: Text('${asInt(s['sesiones'])}', style: Tx.mono(size: 15, w: FontWeight.w700)),
                      last: s == semanas.last,
                    ),
                ],
              ),
            ),
        ]);
      },
    );
  }
}

// ====================================================================== USUARIOS
class AdminUsuariosTab extends StatefulWidget {
  const AdminUsuariosTab({super.key});

  @override
  State<AdminUsuariosTab> createState() => _AdminUsuariosTabState();
}

class _AdminUsuariosTabState extends State<AdminUsuariosTab> {
  final _search = TextEditingController();
  String _q = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _newAdmin() async {
    final nombre = TextEditingController();
    final apellido = TextEditingController();
    final email = TextEditingController();
    final pass = TextEditingController();
    String? err;
    bool busy = false;
    await showPfSheet<void>(
      context,
      (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Nuevo administrador', style: Tx.display(size: 19)),
            const SizedBox(height: 4),
            Text('Al entrar por primera vez tendrá que configurar la verificación en dos pasos.', style: Tx.body(size: 12.5, color: C.inkSoft)),
            const SizedBox(height: 16),
            PfField(label: 'Nombre', controller: nombre, caps: TextCapitalization.words),
            PfField(label: 'Apellido', controller: apellido, caps: TextCapitalization.words),
            PfField(label: 'Correo', controller: email, keyboard: TextInputType.emailAddress),
            PasswordField(label: 'Contraseña inicial', controller: pass, hint: 'Mínimo 8, con letras y números', error: err),
            PfButton('Crear administrador', kind: BtnKind.gold, loading: busy, onPressed: () async {
              setSheet(() {
                busy = true;
                err = null;
              });
              try {
                await app.api.post('/api/auth/users', body: {
                  'rol': 'admin',
                  'nombre': nombre.text.trim(),
                  'apellido': apellido.text.trim(),
                  'email': email.text.trim(),
                  'password': pass.text,
                });
                toast('Administrador creado', type: ToastType.success);
                app.bump();
                if (ctx.mounted) Navigator.pop(ctx);
              } on ApiException catch (e) {
                setSheet(() {
                  busy = false;
                  err = e.message;
                });
              }
            }),
          ],
        ),
      ),
    );
    // (los controladores no se liberan aqui: la hoja sigue animando su cierre y aun los usa)
  }

  Future<void> _actions(Map<String, dynamic> u) async {
    final id = asInt(u['id']);
    final activo = asBool(u['activo']);
    final es2fa = asBool(u['dos_factores']);
    final soyYo = id == app.userId;
    await showPfSheet<void>(
      context,
      (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${asStr(u['nombre'])} ${asStr(u['apellido'])}', style: Tx.display(size: 19)),
          const SizedBox(height: 2),
          Text('${asStr(u['email'])} · ${asStr(u['rol']) == 'admin' ? 'Administrador' : 'Usuario'}', style: Tx.body(size: 12.5, color: C.inkSoft)),
          const SizedBox(height: 16),
          if (soyYo)
            Text('Esta es tu cuenta.', style: Tx.body(size: 12.5, color: C.inkMute))
          else ...[
            PfButton(activo ? 'Desactivar cuenta' : 'Reactivar cuenta', kind: activo ? BtnKind.danger : BtnKind.gold, onPressed: () async {
              Navigator.pop(ctx);
              final ok = await confirmSheet(
                context,
                title: activo ? '¿Desactivar esta cuenta?' : '¿Reactivar esta cuenta?',
                body: activo ? 'La persona no podrá entrar y se cerrarán sus sesiones.' : 'La persona podrá volver a entrar.',
                action: activo ? 'Desactivar' : 'Reactivar',
                danger: activo,
              );
              if (!ok) return;
              try {
                await app.api.patch('/api/auth/users/$id', body: {'activo': !activo});
                toast(activo ? 'Cuenta desactivada' : 'Cuenta reactivada', type: ToastType.success);
                app.bump();
              } on ApiException catch (e) {
                toast(e.message, type: ToastType.error);
              }
            }),
            if (es2fa) ...[
              const SizedBox(height: 10),
              PfButton('Restablecer su 2FA', kind: BtnKind.secondary, onPressed: () async {
                Navigator.pop(ctx);
                final ok = await confirmSheet(
                  context,
                  title: '¿Restablecer la verificación en dos pasos?',
                  body: 'Úsalo solo si la persona perdió su celular y sus códigos de respaldo. Se cerrarán sus sesiones y quedará registrado en la auditoría.',
                  action: 'Restablecer',
                );
                if (!ok) return;
                try {
                  await app.api.post('/api/auth/users/$id/2fa/reset');
                  toast('2FA restablecido', type: ToastType.success);
                  app.bump();
                } on ApiException catch (e) {
                  toast(e.message, type: ToastType.error);
                }
              }),
            ],
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LoadView<List<Map<String, dynamic>>>(
      loader: () async => asList(await app.api.get('/api/auth/users')),
      builder: (context, users, reload) {
        final q = _q.trim().toLowerCase();
        final shown = users.where((u) {
          if (q.isEmpty) return true;
          return '${asStr(u['nombre'])} ${asStr(u['apellido'])} ${asStr(u['email'])}'.toLowerCase().contains(q);
        }).toList();
        return PfList(onRefresh: reload, children: [
          PfField(
            label: 'Buscar',
            controller: _search,
            hint: 'Nombre o correo',
            onChanged: (v) => setState(() => _q = v),
          ),
          PfButton('Nuevo administrador', kind: BtnKind.secondary, icon: 'plus', onPressed: _newAdmin),
          SectionLabel('${shown.length} cuentas'),
          if (shown.isEmpty)
            Text('Nadie coincide con la búsqueda.', style: Tx.body(size: 13, color: C.inkSoft))
          else
            PfCard(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Column(
                children: [
                  for (final u in shown)
                    RowTile(
                      title: '${asStr(u['nombre'])} ${asStr(u['apellido'])}',
                      sub: '${asStr(u['email'])} · ${asStr(u['rol']) == 'admin' ? 'Admin' : 'Usuario'}',
                      left: Avatar(Fmt.initials(asStr(u['nombre']), asStr(u['apellido'])), size: 38),
                      right: Wrap(spacing: 4, children: [
                        if (asBool(u['dos_factores'])) const PfBadge('2FA', tone: 'green'),
                        if (!asBool(u['activo'])) const PfBadge('Inactiva', tone: 'grey'),
                      ]),
                      chevron: true,
                      last: u == shown.last,
                      onTap: () => _actions(u),
                    ),
                ],
              ),
            ),
        ]);
      },
    );
  }
}

// ====================================================================== RETOS OFICIALES
class AdminRetosTab extends StatelessWidget {
  const AdminRetosTab({super.key});

  Future<void> _create(BuildContext context) async {
    List<Map<String, dynamic>> ejercicios = <Map<String, dynamic>>[];
    try {
      ejercicios = asList(await app.api.get('/api/content/exercises')).where((e) => asBool(e['mide_reps'])).toList();
    } catch (_) {}
    if (!context.mounted) return;
    final titulo = TextEditingController();
    final desc = TextEditingController();
    final meta = TextEditingController();
    int tipo = 0; // 0 individual, 1 squad
    int metrica = 0; // 0 sesiones, 1 dias_activos, 2 reps
    int ejercicio = 0;
    int duracion = 1; // 0:7 1:14 2:30
    String? err;
    bool busy = false;
    const dias = [7, 14, 30];
    await showPfSheet<void>(
      context,
      (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Nuevo reto oficial', style: Tx.display(size: 19)),
            const SizedBox(height: 4),
            Text('Aparecerá en Retos para todos los usuarios.', style: Tx.body(size: 12.5, color: C.inkSoft)),
            const SizedBox(height: 16),
            PfField(label: 'Título', controller: titulo, maxLength: 100, caps: TextCapitalization.sentences),
            PfField(label: 'Descripción', controller: desc, maxLength: 255, maxLines: 2, caps: TextCapitalization.sentences),
            Text('TIPO', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
            const SizedBox(height: 6),
            Segmented(labels: const ['Individual', 'De squad'], selected: tipo, onChanged: (i) => setSheet(() => tipo = i)),
            const SizedBox(height: 10),
            Text('MÉTRICA', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
            const SizedBox(height: 6),
            Segmented(
              labels: ejercicios.isEmpty ? const ['Sesiones', 'Días activos'] : const ['Sesiones', 'Días activos', 'Repeticiones'],
              selected: metrica,
              onChanged: (i) => setSheet(() => metrica = i),
            ),
            if (metrica == 2 && ejercicios.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text('EJERCICIO', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
              const SizedBox(height: 6),
              Segmented(
                labels: [for (final e in ejercicios) asStr(e['nombre'])],
                selected: ejercicio,
                scroll: true,
                onChanged: (i) => setSheet(() => ejercicio = i),
              ),
            ],
            const SizedBox(height: 10),
            PfField(label: 'Meta', controller: meta, hint: metrica == 2 ? 'Ej. 100 repeticiones' : 'Ej. 5', keyboard: TextInputType.number, maxLength: 6),
            Text('DURACIÓN', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
            const SizedBox(height: 6),
            Segmented(labels: const ['7 días', '14 días', '30 días'], selected: duracion, onChanged: (i) => setSheet(() => duracion = i)),
            if (err != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(err!, style: Tx.body(size: 12, w: FontWeight.w600, color: C.error))),
            const SizedBox(height: 14),
            PfButton('Publicar reto', kind: BtnKind.gold, loading: busy, onPressed: () async {
              final m = int.tryParse(meta.text.trim());
              if (titulo.text.trim().length < 3 || desc.text.trim().length < 3 || m == null || m < 1) {
                setSheet(() => err = 'Completa título, descripción y una meta válida.');
                return;
              }
              final hoy = Fmt.bogotaNow();
              final fin = DateTime.utc(hoy.year, hoy.month, hoy.day).add(Duration(days: dias[duracion]));
              final finIso = '${fin.year.toString().padLeft(4, '0')}-${fin.month.toString().padLeft(2, '0')}-${fin.day.toString().padLeft(2, '0')}';
              setSheet(() {
                busy = true;
                err = null;
              });
              try {
                await app.api.post('/api/social/challenges', body: {
                  'titulo': titulo.text.trim(),
                  'descripcion': desc.text.trim(),
                  'tipo': tipo == 0 ? 'individual' : 'squad',
                  'metrica': const ['sesiones', 'dias_activos', 'reps'][metrica],
                  if (metrica == 2) 'ejercicio_id': asInt(ejercicios[ejercicio]['id']),
                  'meta': m,
                  'fecha_inicio': Fmt.todayIso(),
                  'fecha_fin': finIso,
                });
                toast('Reto publicado', type: ToastType.success);
                app.bump();
                if (ctx.mounted) Navigator.pop(ctx);
              } on ApiException catch (e) {
                setSheet(() {
                  busy = false;
                  err = e.message;
                });
              }
            }),
          ],
        ),
      ),
    );
  }

  Future<void> _toggle(BuildContext context, Map<String, dynamic> r) async {
    final activo = asBool(r['activo']);
    final ok = await confirmSheet(
      context,
      title: activo ? '¿Desactivar este reto?' : '¿Reactivar este reto?',
      body: activo ? 'Dejará de aparecer para los usuarios. El progreso ya guardado no se borra.' : 'Volverá a aparecer para los usuarios.',
      action: activo ? 'Desactivar' : 'Reactivar',
      danger: activo,
    );
    if (!ok) return;
    try {
      await app.api.patch('/api/social/admin/challenges/${asInt(r['id'])}', body: {'activo': !activo});
      app.bump();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    return LoadView<List<Map<String, dynamic>>>(
      loader: () async => asList(await app.api.get('/api/social/admin/challenges')),
      builder: (context, retos, reload) {
        return PfList(onRefresh: reload, children: [
          PfButton('Crear reto oficial', kind: BtnKind.gold, icon: 'plus', onPressed: () => _create(context)),
          SectionLabel('${retos.length} retos'),
          if (retos.isEmpty)
            Text('Todavía no hay retos.', style: Tx.body(size: 13, color: C.inkSoft))
          else
            PfCard(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Column(
                children: [
                  for (final r in retos)
                    RowTile(
                      title: asStr(r['titulo']),
                      sub: '${r['squad'] == null ? 'Oficial' : 'Squad ${asStr(r['squad'])}'} · meta ${asInt(r['meta'])} ${metricUnit(asStr(r['metrica']))} · ${asInt(r['participantes'])} participan · ${asInt(r['completados'])} completaron',
                      left: IconDisc(metricIcon(asStr(r['metrica'])), tone: metricTone(asStr(r['metrica']))),
                      right: PfBadge(asBool(r['activo']) ? 'Activo' : 'Inactivo', tone: asBool(r['activo']) ? 'green' : 'grey'),
                      last: r == retos.last,
                      onTap: () => _toggle(context, r),
                    ),
                ],
              ),
            ),
        ]);
      },
    );
  }
}

// ====================================================================== SOPORTE (bandeja)
/// Solo llegan las conversaciones transferidas a un humano (pagos, Premium o cuando el usuario lo pide).
/// Las que siguen con el asistente automatico son privadas del usuario.
class AdminSoporteTab extends StatefulWidget {
  const AdminSoporteTab({super.key});

  @override
  State<AdminSoporteTab> createState() => _AdminSoporteTabState();
}

class _AdminSoporteTabState extends State<AdminSoporteTab> {
  int _filtro = 0; // 0 abiertas, 1 cerradas

  String _estado(String e) => e == 'pendiente' ? 'Sin responder' : (e == 'atendiendo' ? 'En atención' : 'Cerrada');
  String _tone(String e) => e == 'pendiente' ? 'orange' : (e == 'atendiendo' ? 'blue' : 'grey');

  @override
  Widget build(BuildContext context) {
    return LoadView<Map<String, dynamic>>(
      key: ValueKey<int>(_filtro),
      loader: () async => asMap(await app.api.get('/api/social/admin/support', query: {'estado': _filtro == 0 ? 'abiertas' : 'cerrada'})),
      builder: (context, d, reload) {
        final convs = asList(d['conversaciones']);
        return PfList(onRefresh: reload, children: [
          Segmented(
            labels: ['Abiertas${asInt(d['pendientes']) > 0 ? ' (${asInt(d['pendientes'])} nuevas)' : ''}', 'Cerradas'],
            selected: _filtro,
            onChanged: (i) => setState(() => _filtro = i),
          ),
          const PanelNote('Aquí llegan los chats que el asistente transfiere a un humano: pagos, Premium o cuando el usuario pide una persona. Cada conversación que abres queda en la auditoría.', icon: 'shield-check'),
          if (convs.isEmpty)
            Text(_filtro == 0 ? 'No hay conversaciones abiertas. ¡Todo al día!' : 'Aún no hay conversaciones cerradas.', style: Tx.body(size: 13, color: C.inkSoft))
          else
            PfCard(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Column(
                children: [
                  for (final c in convs)
                    RowTile(
                      title: '${asStr(c['nombre'])} ${asStr(c['apellido'])}',
                      sub: '${asStr(c['motivo']) == 'pago' ? 'Pago · ' : ''}${asStr(c['ultimo_mensaje'])}',
                      left: Avatar(Fmt.initials(asStr(c['nombre']), asStr(c['apellido'])), size: 38),
                      right: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          PfBadge(asInt(c['no_leidos_admin']) > 0 ? '${asInt(c['no_leidos_admin'])} nuevos' : _estado(asStr(c['estado'])), tone: asInt(c['no_leidos_admin']) > 0 ? 'gold' : _tone(asStr(c['estado']))),
                          const SizedBox(height: 4),
                          Text(Fmt.relative(asStr(c['ultimo_mensaje_at'])), style: Tx.body(size: 10.5, color: C.inkMute)),
                        ],
                      ),
                      last: c == convs.last,
                      onTap: () async {
                        await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => AdminSoporteChatScreen(conversacionId: asInt(c['id']))));
                        app.bump();
                      },
                    ),
                ],
              ),
            ),
        ]);
      },
    );
  }
}

class AdminSoporteChatScreen extends StatefulWidget {
  final int conversacionId;
  const AdminSoporteChatScreen({super.key, required this.conversacionId});

  @override
  State<AdminSoporteChatScreen> createState() => _AdminSoporteChatScreenState();
}

class _AdminSoporteChatScreenState extends State<AdminSoporteChatScreen> {
  Map<String, dynamic>? _conv;
  Object? _error;
  bool _sending = false;
  Timer? _poll;
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 8), (_) {
      if (asStr(_conv?['estado']) != 'cerrada') _load(silent: true);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _mensajes => asList(_conv?['mensajes']);

  Future<void> _load({bool silent = false}) async {
    try {
      final d = asMap(await app.api.get('/api/social/admin/support/${widget.conversacionId}'));
      if (!mounted) return;
      final antes = _mensajes.length;
      setState(() {
        _conv = d;
        _error = null;
      });
      if (_mensajes.length != antes) _scrollDown();
    } catch (e) {
      if (!mounted || silent) return;
      setState(() => _error = e);
    }
  }

  void _scrollDown() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent + 120, duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send() async {
    final t = _input.text.trim();
    if (t.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final d = asMap(await app.api.post('/api/social/admin/support/${widget.conversacionId}/messages', body: {'mensaje': t}));
      if (!mounted) return;
      _input.clear();
      setState(() => _conv = d);
      _scrollDown();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _cerrar() async {
    final ok = await confirmSheet(context, title: '¿Cerrar la conversación?', body: 'El usuario verá que fue cerrada. Si escribe de nuevo se abre otra.', action: 'Cerrar', danger: false);
    if (!ok) return;
    try {
      await app.api.post('/api/social/admin/support/${widget.conversacionId}/close');
      toast('Conversación cerrada', type: ToastType.success);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = asMap(_conv?['usuario']);
    final cerrada = asStr(_conv?['estado']) == 'cerrada';
    Widget body;
    if (_conv == null && _error != null) {
      body = ErrorState(error: _error!, onRetry: _load);
    } else if (_conv == null) {
      body = const SkeletonScreen();
    } else {
      body = Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: PanelNote(
              '${asStr(u['email'])}${asStr(_conv?['motivo']) == 'pago' ? ' · motivo: pago' : ''}',
              icon: 'circle-user',
            ),
          ),
          Expanded(
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              children: [for (final m in _mensajes) SoporteBubble(m, mia: asStr(m['autor']) == 'admin')],
            ),
          ),
          if (cerrada)
            const Padding(padding: EdgeInsets.all(16), child: PanelNote('Esta conversación está cerrada.', icon: 'check-circle'))
          else
            SoporteInput(controller: _input, sending: _sending, onSend: _send, hint: 'Responde al usuario…'),
        ],
      );
    }
    return PfScaffold(
      title: _conv == null ? 'Soporte' : '${asStr(u['nombre'])} ${asStr(u['apellido'])}',
      actions: _conv != null && !cerrada ? [PfIconButton('check-circle', onTap: _cerrar)] : const [],
      body: body,
    );
  }
}

// ====================================================================== AUDITORIA
class AdminAuditoriaTab extends StatelessWidget {
  const AdminAuditoriaTab({super.key});

  String _accion(String a) {
    switch (a) {
      case 'leer':
        return 'Lectura';
      case 'crear':
        return 'Creación';
      case 'actualizar':
        return 'Modificación';
      case 'eliminar':
        return 'Eliminación';
      default:
        return a;
    }
  }

  @override
  Widget build(BuildContext context) {
    return LoadView<List<Map<String, dynamic>>>(
      loader: () async => asList(await app.api.get('/api/auth/admin/audit', query: {'limite': '100'})),
      builder: (context, filas, reload) {
        return PfList(onRefresh: reload, children: [
          const PanelNote('Cada acceso a datos sensibles queda registrado aquí (Ley 1581). Se muestran los 100 más recientes.', icon: 'shield-check'),
          if (filas.isEmpty)
            Text('Aún no hay registros.', style: Tx.body(size: 13, color: C.inkSoft))
          else
            PfCard(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Column(
                children: [
                  for (final f in filas)
                    RowTile(
                      title: '${_accion(asStr(f['accion']))} · ${asStr(f['recurso'])}',
                      sub: '${f['usuario_email'] ?? 'cuenta eliminada'} · ${asStr(f['ip'], 'sin IP')} · ${Fmt.relative(asStr(f['created_at']))}',
                      last: f == filas.last,
                    ),
                ],
              ),
            ),
        ]);
      },
    );
  }
}
