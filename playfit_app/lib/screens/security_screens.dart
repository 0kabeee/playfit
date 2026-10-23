import 'package:url_launcher/url_launcher.dart';

import '../common.dart';

String _groupKey(String s) => RegExp('.{1,4}').allMatches(s).map((m) => m.group(0)!).join(' ');

// ====================================================================== LISTA DE CODIGOS DE RESPALDO
class BackupCodesView extends StatelessWidget {
  final List<String> codes;
  const BackupCodesView({super.key, required this.codes});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const PanelNote(
          'Guarda estos códigos en un lugar seguro. Cada uno sirve UNA sola vez para entrar si pierdes tu celular. No volverás a verlos.',
          icon: 'shield-alert',
        ),
        const SizedBox(height: 4),
        PfCard(
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final c in codes)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: C.cream, borderRadius: BorderRadius.circular(10)),
                  child: Text(c, style: Tx.mono(size: 14, w: FontWeight.w700)),
                ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        PfButton('Copiar los códigos', kind: BtnKind.secondary, onPressed: () async {
          await copyToClipboard(codes.join('\n'));
          toast('Códigos copiados', type: ToastType.success);
        }),
      ],
    );
  }
}

// ====================================================================== CODIGO AL INICIAR SESION
class TwoFactorCodeScreen extends StatefulWidget {
  final String desafio;
  const TwoFactorCodeScreen({super.key, required this.desafio});

  @override
  State<TwoFactorCodeScreen> createState() => _TwoFactorCodeScreenState();
}

class _TwoFactorCodeScreenState extends State<TwoFactorCodeScreen> {
  final _code = TextEditingController();
  String? _err;
  bool _loading = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final code = _code.text.trim();
    if (code.length < 6) {
      setState(() => _err = 'Escribe el código de 6 dígitos o un código de respaldo');
      return;
    }
    setState(() {
      _loading = true;
      _err = null;
    });
    try {
      await app.verifyTwoFactor(widget.desafio, code);
      toast('Bienvenido de nuevo', type: ToastType.success);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'DESAFIO_INVALIDO') {
        toast(e.message, type: ToastType.error);
        Navigator.of(context).maybePop();
        return;
      }
      setState(() => _err = e.code == 'CODIGO_2FA_INVALIDO' ? 'Código incorrecto' : e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Verificación en dos pasos',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 14, 22, 24),
        children: [
          const Center(child: Mascot('pensativo', size: 110, enter: true)),
          const SizedBox(height: 10),
          Text(
            'Abre tu app de autenticación y escribe el código de 6 dígitos de PlayFit. Si perdiste tu celular, usa uno de tus códigos de respaldo.',
            style: Tx.body(size: 13.5, color: C.inkSoft, height: 1.5),
          ),
          const SizedBox(height: 18),
          PfField(
            label: 'Código',
            controller: _code,
            hint: '123456',
            keyboard: TextInputType.visiblePassword,
            action: TextInputAction.done,
            error: _err,
            maxLength: 11,
            onChanged: (_) => setState(() => _err = null),
            onSubmitted: (_) => _submit(),
          ),
          PfButton('Verificar', kind: BtnKind.gold, loading: _loading, onPressed: _submit),
        ],
      ),
    );
  }
}

// ====================================================================== CONFIGURAR 2FA
/// Con [desafio]: el administrador lo configura al iniciar sesion (es obligatorio y todavia no tiene sesion).
/// Sin [desafio]: un usuario con sesion lo activa desde Cuenta.
class TwoFactorSetupScreen extends StatefulWidget {
  final String? desafio;
  const TwoFactorSetupScreen({super.key, this.desafio});

  @override
  State<TwoFactorSetupScreen> createState() => _TwoFactorSetupScreenState();
}

class _TwoFactorSetupScreenState extends State<TwoFactorSetupScreen> {
  Map<String, dynamic>? _cfg;
  String? _loadErr;
  List<String>? _codes;
  final _code = TextEditingController();
  String? _err;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() => _loadErr = null);
    try {
      final d = widget.desafio;
      final data = d != null ? await app.startInitialTwoFactor(d) : asMap(await app.api.post('/api/auth/2fa/setup'));
      if (mounted) setState(() => _cfg = asMap(data));
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadErr = e.message);
    }
  }

  Future<void> _openAuthenticator() async {
    final uri = Uri.tryParse(asStr(_cfg?['otpauth_uri']));
    if (uri == null) return;
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok) toast('No encontré una app de autenticación. Copia la clave e ingrésala a mano.');
    } catch (_) {
      toast('No encontré una app de autenticación. Copia la clave e ingrésala a mano.');
    }
  }

  Future<void> _confirm() async {
    FocusScope.of(context).unfocus();
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _err = 'Escribe el código de 6 dígitos que muestra tu app');
      return;
    }
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      List<String> codes;
      if (widget.desafio != null) {
        codes = await app.confirmInitialTwoFactor(widget.desafio!, code);
      } else {
        final r = asMap(await app.api.post('/api/auth/2fa/enable', body: {'codigo': code}));
        codes = (r['codigos_respaldo'] is List) ? (r['codigos_respaldo'] as List).map((e) => e.toString()).toList() : <String>[];
      }
      if (mounted) setState(() => _codes = codes);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'DESAFIO_INVALIDO') {
        toast(e.message, type: ToastType.error);
        Navigator.of(context).maybePop();
        return;
      }
      setState(() => _err = e.code == 'CODIGO_2FA_INVALIDO' ? 'Código incorrecto. Revisa la hora de tu celular.' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finish() async {
    if (widget.desafio != null) {
      await app.finishPendingLogin();
    } else {
      app.bump();
      if (mounted) Navigator.of(context).pop(true);
    }
  }

  Widget _stepScan() {
    final cfg = _cfg;
    if (_loadErr != null) {
      return EmptyState(
        pose: 'cansado',
        title: 'No pude preparar el código',
        body: _loadErr!,
        actions: [PfButton('Reintentar', kind: BtnKind.gold, onPressed: _start)],
      );
    }
    if (cfg == null) {
      return const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator(color: C.gold)));
    }
    final secret = asStr(cfg['secreto']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.desafio != null)
          const PanelNote('Como administrador, la verificación en dos pasos es obligatoria para proteger los datos de PlayFit.', icon: 'shield-check'),
        Text('1. Instala una app de autenticación', style: Tx.body(size: 13.5, w: FontWeight.w800)),
        const SizedBox(height: 4),
        Text('Por ejemplo Google Authenticator, Microsoft Authenticator o Authy.', style: Tx.body(size: 12.5, color: C.inkSoft)),
        const SizedBox(height: 14),
        Text('2. Agrega PlayFit', style: Tx.body(size: 13.5, w: FontWeight.w800)),
        const SizedBox(height: 8),
        PfButton('Abrir mi app de autenticación', kind: BtnKind.secondary, onPressed: _openAuthenticator),
        const SizedBox(height: 8),
        Text('O escribe esta clave a mano en tu app:', style: Tx.body(size: 12.5, color: C.inkSoft)),
        const SizedBox(height: 6),
        PfCard(
          child: Row(
            children: [
              Expanded(child: SelectableText(_groupKey(secret), style: Tx.mono(size: 15, w: FontWeight.w700))),
              PfIconButton('check-circle', onTap: () async {
                await copyToClipboard(secret);
                toast('Clave copiada', type: ToastType.success);
              }),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Text('3. Escribe el código que te muestra', style: Tx.body(size: 13.5, w: FontWeight.w800)),
        const SizedBox(height: 8),
        PfField(
          label: 'Código de 6 dígitos',
          controller: _code,
          hint: '123456',
          keyboard: TextInputType.number,
          action: TextInputAction.done,
          maxLength: 6,
          error: _err,
          onChanged: (_) => setState(() => _err = null),
          onSubmitted: (_) => _confirm(),
        ),
        PfButton('Activar', kind: BtnKind.gold, loading: _busy, onPressed: _confirm),
      ],
    );
  }

  Widget _stepCodes() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('¡Verificación activada!', style: Tx.display(size: 22)),
        const SizedBox(height: 10),
        BackupCodesView(codes: _codes ?? const <String>[]),
        const SizedBox(height: 14),
        PfButton(widget.desafio != null ? 'Ya los guardé, entrar' : 'Ya los guardé', kind: BtnKind.gold, onPressed: _finish),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !(_codes != null && widget.desafio != null), // en el flujo del admin no se puede salir sin ver los codigos
      child: PfScaffold(
        title: 'Verificación en dos pasos',
        body: ListView(
          padding: const EdgeInsets.fromLTRB(22, 14, 22, 28),
          children: [_codes == null ? _stepScan() : _stepCodes()],
        ),
      ),
    );
  }
}

// ====================================================================== OLVIDE MI CONTRASENA
class ForgotPasswordScreen extends StatefulWidget {
  final String email;
  const ForgotPasswordScreen({super.key, this.email = ''});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  late final TextEditingController _email = TextEditingController(text: widget.email);
  final _code = TextEditingController();
  final _pass = TextEditingController();
  final _pass2 = TextEditingController();
  int _step = 1;
  bool _busy = false;
  final Map<String, String> _err = <String, String>{};

  @override
  void dispose() {
    for (final c in [_email, _code, _pass, _pass2]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    FocusScope.of(context).unfocus();
    final email = _email.text.trim();
    if (!email.contains('@') || !email.contains('.')) {
      setState(() => _err['email'] = 'Escribe un correo válido');
      return;
    }
    setState(() {
      _busy = true;
      _err.clear();
    });
    try {
      await app.forgotPassword(email);
      if (!mounted) return;
      toast('Si el correo está registrado, te enviamos un código.', type: ToastType.success);
      setState(() => _step = 2);
    } on ApiException catch (e) {
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    FocusScope.of(context).unfocus();
    _err.clear();
    if (!RegExp(r'^\d{6}$').hasMatch(_code.text.trim())) _err['code'] = 'Escribe el código de 6 dígitos del correo';
    final p = _pass.text;
    if (p.length < 8 || !RegExp(r'[A-Za-z]').hasMatch(p) || !RegExp(r'\d').hasMatch(p)) {
      _err['pass'] = 'Mínimo 8 caracteres, con letras y números';
    } else if (p.length > 72) {
      _err['pass'] = 'Máximo 72 caracteres';
    }
    if (_pass2.text != p) _err['pass2'] = 'Las contraseñas no coinciden';
    if (_err.isNotEmpty) {
      setState(() {});
      return;
    }
    setState(() => _busy = true);
    try {
      await app.resetPassword(_email.text.trim(), _code.text.trim(), p);
      if (!mounted) return;
      toast('Contraseña actualizada. Ya puedes iniciar sesión.', type: ToastType.success);
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.code == 'CODIGO_INVALIDO') {
          _err['code'] = 'Código inválido o vencido';
        } else if (e.code == 'PASSWORD_DEBIL') {
          _err['pass'] = e.message;
        }
      });
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PfScaffold(
      title: 'Recuperar contraseña',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 14, 22, 28),
        children: [
          if (_step == 1) ...[
            Text('Te enviaremos un código de 6 dígitos al correo de tu cuenta. Vence en 15 minutos.', style: Tx.body(size: 13.5, color: C.inkSoft, height: 1.5)),
            const SizedBox(height: 18),
            PfField(
              label: 'Correo',
              controller: _email,
              hint: 'nombre@universidad.edu.co',
              keyboard: TextInputType.emailAddress,
              action: TextInputAction.done,
              error: _err['email'],
              onChanged: (_) => setState(() => _err.remove('email')),
              onSubmitted: (_) => _send(),
            ),
            PfButton('Enviar código', kind: BtnKind.gold, loading: _busy, onPressed: _send),
            const SizedBox(height: 10),
            PfButton('Ya tengo un código', kind: BtnKind.secondary, onPressed: () {
              final email = _email.text.trim();
              if (!email.contains('@') || !email.contains('.')) {
                setState(() => _err['email'] = 'Escribe primero tu correo');
                return;
              }
              setState(() => _step = 2);
            }),
          ] else ...[
            Text('Revisa tu correo (también la carpeta de spam) y escribe el código con tu nueva contraseña.', style: Tx.body(size: 13.5, color: C.inkSoft, height: 1.5)),
            const SizedBox(height: 18),
            PfField(
              label: 'Código del correo',
              controller: _code,
              hint: '123456',
              keyboard: TextInputType.number,
              maxLength: 6,
              action: TextInputAction.next,
              error: _err['code'],
              onChanged: (_) => setState(() => _err.remove('code')),
            ),
            PasswordField(
              label: 'Contraseña nueva',
              controller: _pass,
              hint: 'Mínimo 8, con letras y números',
              error: _err['pass'],
              action: TextInputAction.next,
              onChanged: (_) => setState(() => _err.remove('pass')),
            ),
            PasswordField(
              label: 'Confirmar contraseña',
              controller: _pass2,
              error: _err['pass2'],
              action: TextInputAction.done,
              onChanged: (_) => setState(() => _err.remove('pass2')),
            ),
            PfButton('Cambiar contraseña', kind: BtnKind.gold, loading: _busy, onPressed: _reset),
            const SizedBox(height: 10),
            PfButton('Reenviar código', kind: BtnKind.secondary, onPressed: _busy ? null : () => setState(() => _step = 1)),
          ],
        ],
      ),
    );
  }
}

// ====================================================================== AJUSTES DE 2FA (desde Cuenta)
Future<void> openTwoFactorSettings(BuildContext context) async {
  Map<String, dynamic> st;
  try {
    st = asMap(await app.api.get('/api/auth/2fa'));
  } on ApiException catch (e) {
    toast(e.message, type: ToastType.error);
    return;
  }
  if (!context.mounted) return;
  if (!asBool(st['activo'])) {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const TwoFactorSetupScreen()));
    return;
  }
  await showPfSheet<void>(context, (ctx) => _TwoFactorManageSheet(status: st));
}

class _TwoFactorManageSheet extends StatefulWidget {
  final Map<String, dynamic> status;
  const _TwoFactorManageSheet({required this.status});

  @override
  State<_TwoFactorManageSheet> createState() => _TwoFactorManageSheetState();
}

class _TwoFactorManageSheetState extends State<_TwoFactorManageSheet> {
  String _mode = 'menu'; // menu | regen | disable | codes
  final _code = TextEditingController();
  final _pass = TextEditingController();
  String? _err;
  bool _busy = false;
  List<String> _codes = <String>[];

  @override
  void dispose() {
    _code.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _regen() async {
    if (_code.text.trim().length < 6) {
      setState(() => _err = 'Escribe el código de tu app');
      return;
    }
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      final r = asMap(await app.api.post('/api/auth/2fa/backup-codes', body: {'codigo': _code.text.trim()}));
      setState(() {
        _codes = (r['codigos_respaldo'] is List) ? (r['codigos_respaldo'] as List).map((e) => e.toString()).toList() : <String>[];
        _mode = 'codes';
      });
    } on ApiException catch (e) {
      setState(() => _err = e.code == 'CODIGO_2FA_INVALIDO' ? 'Código incorrecto' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _disable() async {
    if (_pass.text.isEmpty || _code.text.trim().length < 6) {
      setState(() => _err = 'Escribe tu contraseña y un código de tu app');
      return;
    }
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await app.api.post('/api/auth/2fa/disable', body: {'password': _pass.text, 'codigo': _code.text.trim()});
      toast('Verificación en dos pasos desactivada');
      app.bump();
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      setState(() {
        if (e.code == 'CODIGO_2FA_INVALIDO') {
          _err = 'Código incorrecto';
        } else if (e.code == 'CREDENCIALES_INVALIDAS') {
          _err = 'Contraseña incorrecta';
        } else {
          _err = e.message;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final obligatorio = asBool(widget.status['obligatorio']);
    final libres = asInt(widget.status['codigos_respaldo_disponibles']);
    switch (_mode) {
      case 'regen':
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Códigos de respaldo nuevos', style: Tx.display(size: 19)),
          const SizedBox(height: 4),
          Text('Los anteriores dejarán de funcionar.', style: Tx.body(size: 12.5, color: C.inkSoft)),
          const SizedBox(height: 16),
          PfField(label: 'Código de tu app', controller: _code, keyboard: TextInputType.number, maxLength: 6, error: _err),
          PfButton('Generar', kind: BtnKind.gold, loading: _busy, onPressed: _regen),
        ]);
      case 'disable':
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Desactivar verificación', style: Tx.display(size: 19, color: C.error)),
          const SizedBox(height: 4),
          Text('Tu cuenta quedará protegida solo con la contraseña.', style: Tx.body(size: 12.5, color: C.inkSoft)),
          const SizedBox(height: 16),
          PasswordField(label: 'Contraseña', controller: _pass),
          PfField(label: 'Código de tu app o de respaldo', controller: _code, maxLength: 11, error: _err),
          PfButton('Desactivar', kind: BtnKind.danger, loading: _busy, onPressed: _disable),
        ]);
      case 'codes':
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Tus códigos nuevos', style: Tx.display(size: 19)),
          const SizedBox(height: 12),
          BackupCodesView(codes: _codes),
          const SizedBox(height: 12),
          PfButton('Listo', kind: BtnKind.gold, onPressed: () {
            app.bump();
            Navigator.pop(context);
          }),
        ]);
      default:
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Verificación en dos pasos', style: Tx.display(size: 19)),
          const SizedBox(height: 6),
          Row(children: [
            const PfBadge('Activa', tone: 'green', icon: 'shield-check'),
            const SizedBox(width: 8),
            Text('$libres códigos de respaldo disponibles', style: Tx.body(size: 12, color: C.inkSoft)),
          ]),
          const SizedBox(height: 16),
          PfButton('Generar códigos de respaldo nuevos', kind: BtnKind.secondary, onPressed: () => setState(() => _mode = 'regen')),
          const SizedBox(height: 10),
          if (obligatorio)
            Text('Para administradores es obligatoria y no se puede desactivar.', style: Tx.body(size: 12, color: C.inkMute))
          else
            PfButton('Desactivar', kind: BtnKind.danger, onPressed: () => setState(() => _mode = 'disable')),
        ]);
    }
  }
}
