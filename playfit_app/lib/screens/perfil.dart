import '../common.dart';
import 'premium.dart';
import 'ranking.dart';
import 'security_screens.dart';
import 'sesiones.dart';
import 'soporte.dart';

// ====================================================================== PESTAÑA PERFIL
class PerfilTab extends StatelessWidget {
  const PerfilTab({super.key});

  Future<Map<String, dynamic>> _load() async {
    final dash = asMap(await app.api.get('/api/social/dashboard'));
    var records = <Map<String, dynamic>>[];
    var medidas = <Map<String, dynamic>>[];
    var badges = <Map<String, dynamic>>[];
    try {
      records = asList(await app.api.get('/api/social/records'));
    } catch (_) {}
    try {
      medidas = asList(await app.api.get('/api/clinical/students/me/measurements'));
    } catch (_) {}
    try {
      badges = asList(await app.api.get('/api/social/badges'));
    } catch (_) {}
    return <String, dynamic>{'dash': dash, 'records': records, 'medidas': medidas, 'badges': badges};
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: app,
      builder: (context, _) => LoadView<Map<String, dynamic>>(
        loader: _load,
        builder: (context, data, reload) {
          final dash = asMap(data['dash']);
          final records = asList(data['records']).where((r) => r['mejor_peso_kg'] != null).toList();
          final medidas = asList(data['medidas']);
          final badges = asList(data['badges']);
          final got = badges.where((b) => asBool(b['obtenida'])).length;
          final ultima = medidas.isEmpty ? <String, dynamic>{} : medidas.last;

          final tiles = <MetricTile>[
            MetricTile('Peso actual', ultima.isEmpty ? '—' : Fmt.kg(asNum(ultima['peso_kg']))),
            MetricTile('XP total', '${asInt(dash['xp_total'])}'),
            for (final r in records.take(3)) MetricTile(asStr(r['nombre']), Fmt.kg(asNum(r['mejor_peso_kg']))),
          ];

          return PfList(onRefresh: reload, children: [
            PfCard(
              child: Row(
                children: [
                  Avatar(app.initials, size: 66, ring: 'gold'),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(app.fullName, style: Tx.display(size: 21), maxLines: 2, overflow: TextOverflow.ellipsis),
                        Text(asStr(app.user['email']), style: Tx.body(size: 11.5, color: C.inkMute), overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            PfBadge('Nivel ${asInt(dash['nivel'])}', tone: 'gold'),
                            if (app.experience.isNotEmpty) PfBadge(app.experience, tone: 'blue'),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            MascotNote(
              asInt(dash['racha_actual']) > 0 ? 'yeah' : 'feliz',
              asInt(dash['racha_actual']) > 0
                  ? '¡Vas muy bien, ${app.firstName}! Llevas ${asInt(dash['racha_actual'])} días de racha.'
                  : 'Hola, ${app.firstName}. Cuando quieras, registramos una sesión.',
            ),
            const SectionLabel('Mis números'),
            MetricGrid(tiles),
            const SectionLabel('Mi progreso'),
            RowCard([
              RowTile(
                title: 'Historial de sesiones',
                sub: 'Todo lo que has entrenado',
                left: const IconDisc('clock', tone: 'blue'),
                chevron: true,
                onTap: () => _push(context, const SesionesScreen()),
              ),
              RowTile(
                title: 'Insignias',
                sub: badges.isEmpty ? 'Tus logros' : '$got de ${badges.length} obtenidas',
                left: const IconDisc('medal', tone: 'gold'),
                chevron: true,
                onTap: () => _push(context, const InsigniasScreen()),
              ),
              RowTile(
                title: 'Ranking',
                sub: 'Puesto #${asInt(dash['puesto'])}',
                left: const IconDisc('bar-chart-3', tone: 'purple'),
                chevron: true,
                onTap: () => _push(context, const RankingScreen()),
              ),
            ]),
            const SectionLabel('PlayFit Premium'),
            ListenableBuilder(
              listenable: app,
              builder: (context, _) => RowCard([
                RowTile(
                  title: app.isPremium ? 'Eres Premium' : 'Hazte Premium',
                  sub: app.isPremium
                      ? 'Activo hasta el ${fechaPremium(asStr(app.user['premium_hasta']))}'
                      : 'Más mensajes con el asistente y rutinas a tu medida',
                  left: const IconDisc('sparkles', tone: 'purple'),
                  right: app.isPremium ? const PfBadge('Premium', tone: 'purple') : null,
                  chevron: true,
                  onTap: () => _push(context, const PremiumScreen()),
                ),
              ]),
            ),
            const SectionLabel('Ayuda'),
            RowCard([
              RowTile(
                title: 'Ayuda y soporte',
                sub: 'Dudas, pagos y Premium · te atiende una persona si lo necesitas',
                left: const IconDisc('message-circle', tone: 'blue'),
                chevron: true,
                onTap: () => _push(context, const SoporteScreen()),
              ),
            ]),
            const SectionLabel('Mi salud'),
            RowCard([
              RowTile(
                title: 'Historial clínico',
                sub: 'Privado · cada consulta queda registrada',
                left: const IconDisc('shield-check', tone: 'green'),
                chevron: true,
                onTap: () => _push(context, const HistorialClinicoScreen()),
              ),
            ]),
          ]);
        },
      ),
    );
  }

  static void _push(BuildContext context, Widget w) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => w));
  }
}

// ====================================================================== HISTORIAL CLINICO
/// Sin mascota a proposito: es una pantalla clinicamente sensible. No se guardan copias en el telefono.
class HistorialClinicoScreen extends StatefulWidget {
  const HistorialClinicoScreen({super.key});

  @override
  State<HistorialClinicoScreen> createState() => _HistorialClinicoScreenState();
}

class _HistorialClinicoScreenState extends State<HistorialClinicoScreen> {
  bool _editing = false;
  bool _saving = false;
  final _peso = TextEditingController();
  final _altura = TextEditingController();
  final _cond = TextEditingController();
  int _nivel = 0;
  final Map<String, String> _err = <String, String>{};
  static const List<String> _niveles = ['Principiante', 'Intermedio', 'Avanzado'];

  @override
  void dispose() {
    _peso.dispose();
    _altura.dispose();
    _cond.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _load() async {
    final h = asMap(await app.api.get('/api/clinical/students/me/history'));
    var medidas = <Map<String, dynamic>>[];
    try {
      medidas = asList(await app.api.get('/api/clinical/students/me/measurements'));
    } catch (_) {}
    return <String, dynamic>{'h': h, 'medidas': medidas};
  }

  static String _catImc(String c) {
    switch (c) {
      case 'bajo_peso':
        return 'Bajo peso';
      case 'sobrepeso':
        return 'Sobrepeso';
      case 'obesidad':
        return 'Obesidad';
      default:
        return 'Normal';
    }
  }

  double? _num(String s) => double.tryParse(s.trim().replaceAll(',', '.'));

  void _startEdit(Map<String, dynamic> h, Map<String, dynamic> ultima) {
    _peso.text = ultima.isEmpty ? '' : asNum(ultima['peso_kg']).toString();
    _altura.text = ultima.isEmpty ? '' : asNum(ultima['estatura_cm']).toString();
    _cond.text = asStr(h['condiciones']);
    final i = _niveles.indexOf(app.experience);
    _nivel = i < 0 ? 0 : i;
    _err.clear();
    setState(() => _editing = true);
  }

  Future<void> _save(Map<String, dynamic> h, Map<String, dynamic> ultima) async {
    FocusScope.of(context).unfocus();
    _err.clear();
    final peso = _num(_peso.text);
    var alt = _num(_altura.text);
    if (alt != null && alt < 3) alt = alt * 100;
    if (peso == null || peso < 30 || peso > 250) _err['peso'] = 'Peso entre 30 y 250 kg';
    if (alt == null || alt < 120 || alt > 230) _err['altura'] = 'Altura entre 120 y 230 cm';
    if (_err.isNotEmpty) {
      setState(() {});
      return;
    }
    setState(() => _saving = true);
    try {
      final cambioMedida = ultima.isEmpty || asNum(ultima['peso_kg']) != peso || asNum(ultima['estatura_cm']) != alt;
      if (cambioMedida) {
        await app.api.post('/api/clinical/students/me/measurements', body: {'peso_kg': peso, 'estatura_cm': alt});
      }
      // el servicio reemplaza el historial completo: se reenvian los campos que esta pantalla no edita
      await app.api.put('/api/clinical/students/me/history', body: {
        'condiciones': _cond.text.trim(),
        'lesiones': h['lesiones'],
        'medicamentos': h['medicamentos'],
      });
      await app.setExperience(_niveles[_nivel]);
      toast('Datos guardados', type: ToastType.success);
      app.bump();
      if (mounted) setState(() => _editing = false);
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Historial clínico',
      body: LoadView<Map<String, dynamic>>(
        loader: _load,
        builder: (context, data, reload) {
          final h = asMap(data['h']);
          final medidas = asList(data['medidas']);
          final ultima = medidas.isEmpty ? <String, dynamic>{} : medidas.last;
          final flags = asList(h['flags']);
          final textos = <String>[
            if (asStr(h['condiciones']).isNotEmpty) asStr(h['condiciones']),
            if (asStr(h['lesiones']).isNotEmpty) asStr(h['lesiones']),
          ];

          if (_editing) {
            return PfList(children: [
              const PanelNote('Tus datos son privados: solo los ves tú.', icon: 'shield-check'),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: PfField(
                      label: 'Peso (kg)',
                      controller: _peso,
                      keyboard: const TextInputType.numberWithOptions(decimal: true),
                      error: _err['peso'],
                      onChanged: (_) => setState(() => _err.remove('peso')),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: PfField(
                      label: 'Altura (cm)',
                      controller: _altura,
                      keyboard: const TextInputType.numberWithOptions(decimal: true),
                      error: _err['altura'],
                      onChanged: (_) => setState(() => _err.remove('altura')),
                    ),
                  ),
                ],
              ),
              Text('NIVEL DE EXPERIENCIA', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
              const SizedBox(height: 6),
              Segmented(labels: _niveles, selected: _nivel, onChanged: (i) => setState(() => _nivel = i)),
              const SizedBox(height: 4),
              PfField(
                label: 'Condiciones o lesiones relevantes',
                controller: _cond,
                maxLines: 4,
                maxLength: 600,
                hint: 'Ej. esguince de rodilla en 2024, asma leve…',
                caps: TextCapitalization.sentences,
              ),
              PfButton('Guardar cambios', kind: BtnKind.gold, loading: _saving, onPressed: () => _save(h, ultima)),
              const SizedBox(height: 10),
              PfButton('Cancelar', kind: BtnKind.secondary, onPressed: _saving ? null : () => setState(() => _editing = false)),
            ]);
          }

          return PfList(onRefresh: reload, children: [
            const PanelNote(
              'Solo tú puedes ver estos datos. Cada consulta queda registrada y esta pantalla no guarda copias en tu teléfono.',
              icon: 'lock',
            ),
            MetricGrid([
              MetricTile('Peso', ultima.isEmpty ? '—' : Fmt.kg(asNum(ultima['peso_kg']))),
              MetricTile('Altura', ultima.isEmpty ? '—' : '${asNum(ultima['estatura_cm']).toStringAsFixed(0)} cm'),
              MetricTile('IMC', ultima.isEmpty ? '—' : '${asNum(ultima['imc']).toStringAsFixed(1)} · ${_catImc(asStr(ultima['categoria_imc']))}'),
              MetricTile('Experiencia', app.experience.isEmpty ? '—' : app.experience),
            ]),
            const SectionLabel('Condiciones o lesiones relevantes'),
            PfCard(
              child: Text(
                textos.isEmpty ? 'Sin condiciones registradas.' : textos.join('\n'),
                style: Tx.body(size: 13.5, color: textos.isEmpty ? C.inkMute : C.ink, height: 1.5),
              ),
            ),
            const SectionLabel('Indicadores generales'),
            PfCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (flags.isEmpty)
                    Text('Aún no hay indicadores.', style: Tx.body(size: 12.5, color: C.inkMute))
                  else
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [for (final f in flags) PfBadge(Fmt.flagLabel(asStr(f['codigo'])), tone: asStr(f['codigo']) == 'SIN_RESTRICCIONES' ? 'green' : 'orange')],
                    ),
                  const SizedBox(height: 10),
                  Text(
                    'Son lo único que usan las recomendaciones de ejercicios y el asistente: nunca el texto de tu historial.',
                    style: Tx.body(size: 11.5, color: C.inkMute, height: 1.4),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            PfButton('Editar mis datos', kind: BtnKind.gold, icon: 'pencil', onPressed: () => _startEdit(h, ultima)),
          ]);
        },
      ),
    );
  }
}

// ====================================================================== CUENTA
class CuentaScreen extends StatefulWidget {
  const CuentaScreen({super.key});

  @override
  State<CuentaScreen> createState() => _CuentaScreenState();
}

class _CuentaScreenState extends State<CuentaScreen> {
  Map<String, bool> _consents = <String, bool>{};
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _loadConsents();
  }

  Future<void> _loadConsents() async {
    try {
      final c = asMap(await app.api.get('/api/auth/consents'));
      if (mounted) {
        setState(() {
          _consents = <String, bool>{for (final k in c.keys) k: asBool(c[k])};
          _loaded = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  Future<void> _toggle(String tipo, bool value) async {
    final before = _consents[tipo] ?? false;
    setState(() => _consents[tipo] = value);
    try {
      await app.api.put('/api/auth/consents/$tipo', body: {'aceptado': value});
    } on ApiException catch (e) {
      if (mounted) setState(() => _consents[tipo] = before);
      toast(e.message, type: ToastType.error);
    }
  }

  Future<void> _logout() async {
    final ok = await confirmSheet(context, title: '¿Cerrar sesión?', body: 'Tendrás que iniciar sesión de nuevo para entrar.', action: 'Cerrar sesión', danger: false);
    if (ok) await app.logout();
  }

  Future<void> _changePassword() async {
    final actual = TextEditingController();
    final nueva = TextEditingController();
    String? err;
    bool busy = false;
    await showPfSheet<void>(
      context,
      (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Cambiar contraseña', style: Tx.display(size: 19)),
            const SizedBox(height: 4),
            Text('Por seguridad cerraremos tus sesiones y tendrás que entrar de nuevo.', style: Tx.body(size: 12.5, color: C.inkSoft)),
            const SizedBox(height: 16),
            PasswordField(label: 'Contraseña actual', controller: actual),
            PasswordField(label: 'Contraseña nueva', controller: nueva, hint: 'Mínimo 8, con letras y números', error: err),
            PfButton('Cambiar contraseña', kind: BtnKind.gold, loading: busy, onPressed: () async {
              final n = nueva.text;
              if (n.length < 8 || !RegExp(r'[A-Za-z]').hasMatch(n) || !RegExp(r'\d').hasMatch(n)) {
                setSheet(() => err = 'Mínimo 8 caracteres, con letras y números');
                return;
              }
              setSheet(() {
                busy = true;
                err = null;
              });
              try {
                await app.api.post('/api/auth/password', body: {'actual': actual.text, 'nueva': n});
                toast('Contraseña actualizada. Inicia sesión de nuevo.', type: ToastType.success);
                await app.logout();
              } on ApiException catch (e) {
                setSheet(() {
                  busy = false;
                  err = e.code == 'CREDENCIALES_INVALIDAS' ? 'La contraseña actual no es correcta' : e.message;
                });
              }
            }),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteAccount() async {
    final pass = TextEditingController();
    String? err;
    bool busy = false;
    await showPfSheet<void>(
      context,
      (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Eliminar mi cuenta', style: Tx.display(size: 19, color: C.error)),
            const SizedBox(height: 8),
            Text(
              'Esta acción es permanente. Se borrarán tu perfil, tus sesiones, tu historial clínico, tus mediciones y tus conversaciones con el asistente. No se puede deshacer.',
              style: Tx.body(size: 12.5, color: C.inkSoft, height: 1.5),
            ),
            const SizedBox(height: 16),
            PasswordField(label: 'Confirma con tu contraseña', controller: pass, error: err),
            PfButton('Eliminar definitivamente', kind: BtnKind.danger, loading: busy, onPressed: () async {
              if (pass.text.isEmpty) {
                setSheet(() => err = 'Escribe tu contraseña');
                return;
              }
              setSheet(() {
                busy = true;
                err = null;
              });
              try {
                await app.deleteAccount(pass.text);
                toast('Tu cuenta fue eliminada');
              } on ApiException catch (e) {
                setSheet(() {
                  busy = false;
                  err = e.code == 'CREDENCIALES_INVALIDAS' ? 'Contraseña incorrecta' : e.message;
                });
              }
            }),
            const SizedBox(height: 10),
            PfButton('Cancelar', kind: BtnKind.secondary, onPressed: () => Navigator.pop(ctx)),
          ],
        ),
      ),
    );
  }

  Widget _switch(String tipo, String title, String sub, {bool last = false}) {
    final on = _consents[tipo] ?? false;
    return RowTile(
      title: title,
      sub: sub,
      last: last,
      right: GestureDetector(
        onTap: _loaded ? () => _toggle(tipo, !on) : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          width: 46,
          height: 27,
          padding: const EdgeInsets.all(3),
          alignment: on ? Alignment.centerRight : Alignment.centerLeft,
          decoration: BoxDecoration(color: on ? C.green : C.lineStrong, borderRadius: BorderRadius.circular(999)),
          child: Container(width: 21, height: 21, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Cuenta',
      body: PfList(children: [
        PfCard(
          child: Row(
            children: [
              Avatar(app.initials, size: 52),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(app.fullName, style: Tx.body(size: 15, w: FontWeight.w800)),
                    Text(asStr(app.user['email']), style: Tx.body(size: 12, color: C.inkMute), overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (!app.isAdmin) const SectionLabel('Permisos'),
        if (!app.isAdmin)
          PfCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
          child: Column(
            children: [
              _switch('ia_chatbot', 'Asistente de IA', 'Permite usar el chat con Gemini'),
              _switch('uso_camara', 'Cámara', 'Para el conteo automático (próximamente)'),
              _switch('datos_salud', 'Datos de salud', 'Necesario para guardar tu historial clínico', last: true),
            ],
          ),
        ),
        const SectionLabel('Seguridad'),
        RowCard([
          if (!app.isAdmin)
            RowTile(
              title: 'Historial clínico',
              sub: 'Revisa y edita tus datos de salud',
              left: const IconDisc('shield-check', tone: 'green'),
              chevron: true,
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const HistorialClinicoScreen())),
            ),
          RowTile(
            title: 'Verificación en dos pasos',
            sub: app.isAdmin ? 'Obligatoria para administradores' : 'Pide un código de tu celular al iniciar sesión',
            left: const IconDisc('lock', tone: 'purple'),
            chevron: true,
            onTap: () => openTwoFactorSettings(context),
          ),
          RowTile(
            title: 'Cambiar contraseña',
            left: const IconDisc('lock', tone: 'blue'),
            chevron: true,
            onTap: _changePassword,
          ),
        ]),
        const SizedBox(height: 4),
        PfButton('Cerrar sesión', kind: BtnKind.secondary, icon: 'log-out', onPressed: _logout),
        if (!app.isAdmin) const SizedBox(height: 10),
        if (!app.isAdmin) PfButton('Eliminar mi cuenta', kind: BtnKind.danger, onPressed: _deleteAccount),
        const SizedBox(height: 16),
        Center(child: Text('PlayFit 0.6.0', style: Tx.body(size: 11, color: C.inkMute))),
      ]),
    );
  }
}
