import '../common.dart';

// ====================================================================== SPLASH
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: C.cream,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Mascot('hero', size: 230, enter: true),
              const SizedBox(height: 14),
              Text('PlayFit', style: Tx.display(size: 40, w: FontWeight.w800)),
              const SizedBox(height: 2),
              Text('Entrena con tu squad', style: Tx.body(size: 14, color: C.inkSoft)),
              const SizedBox(height: 28),
              const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: C.gold)),
            ],
          ),
        ),
      ),
    );
  }
}

// ====================================================================== SESION EXPIRADA
class SessionExpiredScreen extends StatelessWidget {
  const SessionExpiredScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: C.cream,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 40, 20, 24),
          children: [
            const MascotStage('cansado', color: C.blueBg, size: 150, enter: true),
            const SizedBox(height: 22),
            Text('Tu sesión expiró', textAlign: TextAlign.center, style: Tx.display(size: 24)),
            const SizedBox(height: 8),
            Text(
              'Por seguridad cerramos tu sesión después de un tiempo. Inicia sesión de nuevo para continuar.',
              textAlign: TextAlign.center,
              style: Tx.body(size: 13.5, color: C.inkSoft, height: 1.5),
            ),
            const SizedBox(height: 24),
            PfButton('Iniciar sesión', kind: BtnKind.gold, onPressed: app.leaveExpired),
          ],
        ),
      ),
    );
  }
}

// ====================================================================== LOGIN
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _pass = TextEditingController();
  String? _emailErr;
  String? _passErr;
  bool _loading = false;

  @override
  void dispose() {
    _email.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final email = _email.text.trim();
    setState(() {
      _emailErr = email.contains('@') && email.contains('.') ? null : 'Escribe un correo válido';
      _passErr = _pass.text.isEmpty ? 'Escribe tu contraseña' : null;
    });
    if (_emailErr != null || _passErr != null) return;

    setState(() => _loading = true);
    try {
      await app.login(email, _pass.text);
      toast('Bienvenido de nuevo', type: ToastType.success);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'CREDENCIALES_INVALIDAS') setState(() => _passErr = 'Correo o contraseña incorrectos');
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: C.cream,
      body: SafeArea(
        child: Column(
          children: [
            const OfflineBanner(),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(22, 18, 22, 24),
                children: [
                  const Center(child: Mascot('feliz', size: 128, enter: true)),
                  const SizedBox(height: 6),
                  Center(child: Text('Inicia sesión', style: Tx.display(size: 28))),
                  const SizedBox(height: 4),
                  Center(child: Text('Entrena con tu squad y mantén tu racha', style: Tx.body(size: 13.5, color: C.inkSoft))),
                  const SizedBox(height: 24),
                  PfField(
                    label: 'Correo',
                    controller: _email,
                    hint: 'nombre@universidad.edu.co',
                    keyboard: TextInputType.emailAddress,
                    action: TextInputAction.next,
                    error: _emailErr,
                    onChanged: (_) => setState(() => _emailErr = null),
                  ),
                  PasswordField(
                    controller: _pass,
                    error: _passErr,
                    action: TextInputAction.done,
                    onChanged: (_) => setState(() => _passErr = null),
                    onSubmitted: (_) => _submit(),
                  ),
                  const SizedBox(height: 6),
                  PfButton('Iniciar sesión', kind: BtnKind.gold, loading: _loading, onPressed: _submit),
                  const SizedBox(height: 10),
                  PfButton(
                    'Crear cuenta',
                    kind: BtnKind.secondary,
                    onPressed: _loading
                        ? null
                        : () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const RegisterScreen())),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ====================================================================== REGISTRO (2 pasos)
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  int _step = 1;
  bool _loading = false;

  final _name = TextEditingController();
  final _email = TextEditingController();
  final _pass = TextEditingController();
  final _pass2 = TextEditingController();
  bool _consent = false;

  final _peso = TextEditingController();
  final _altura = TextEditingController();
  final _cond = TextEditingController();
  int _nivel = 0;
  int _lesion = 0; // 0 = no, 1 = si

  final Map<String, String> _err = <String, String>{};

  @override
  void dispose() {
    for (final c in [_name, _email, _pass, _pass2, _peso, _altura, _cond]) {
      c.dispose();
    }
    super.dispose();
  }

  static const List<String> _niveles = ['Principiante', 'Intermedio', 'Avanzado'];

  double? _num(String s) => double.tryParse(s.trim().replaceAll(',', '.'));

  bool _validateStep1() {
    _err.clear();
    final parts = _name.text.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.length < 2 || parts.first.length < 2) _err['name'] = 'Escribe tu nombre y apellido';
    final email = _email.text.trim();
    if (!email.contains('@') || !email.contains('.')) _err['email'] = 'Escribe un correo válido';
    final p = _pass.text;
    if (p.length < 8) {
      _err['pass'] = 'Mínimo 8 caracteres';
    } else if (!RegExp(r'[A-Za-z]').hasMatch(p) || !RegExp(r'\d').hasMatch(p)) {
      _err['pass'] = 'Combina letras y números';
    } else if (p.length > 72) {
      _err['pass'] = 'Máximo 72 caracteres';
    }
    if (_pass2.text != p) _err['pass2'] = 'Las contraseñas no coinciden';
    if (!_consent) _err['consent'] = 'Debes aceptar el tratamiento de datos para continuar';
    setState(() {});
    return _err.isEmpty;
  }

  bool _validateStep2() {
    _err.clear();
    final peso = _num(_peso.text);
    if (peso == null || peso < 30 || peso > 250) _err['peso'] = 'Peso entre 30 y 250 kg';
    var alt = _num(_altura.text);
    if (alt != null && alt < 3) alt = alt * 100; // "1.75" -> 175 cm
    if (alt == null || alt < 120 || alt > 230) _err['altura'] = 'Altura entre 120 y 230 cm';
    if (_lesion == 1 && _cond.text.trim().isEmpty) _err['cond'] = 'Describe brevemente tu lesión o condición';
    setState(() {});
    return _err.isEmpty;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_validateStep2()) return;
    final parts = _name.text.trim().split(RegExp(r'\s+'));
    final nombre = parts.first;
    final apellido = parts.sublist(1).join(' ');
    var alt = _num(_altura.text)!;
    if (alt < 3) alt = alt * 100;

    setState(() => _loading = true);
    try {
      await app.register(
        nombre: nombre,
        apellido: apellido,
        email: _email.text,
        password: _pass.text,
        peso: _num(_peso.text)!,
        altura: alt,
        nivel: _niveles[_nivel],
        condiciones: _lesion == 1 ? _cond.text : '',
      );
      toast('¡Cuenta creada! Bienvenido a PlayFit', type: ToastType.success);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'EMAIL_EN_USO') {
        setState(() {
          _step = 1;
          _err['email'] = 'Ya existe una cuenta con ese correo';
        });
      }
      if (e.code == 'PASSWORD_DEBIL') {
        setState(() {
          _step = 1;
          _err['pass'] = e.message;
        });
      }
      toast(e.message, type: ToastType.error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _stepOne() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Crea tu cuenta', style: Tx.display(size: 26)),
        const SizedBox(height: 4),
        Text('Paso 1 de 2 · datos de acceso', style: Tx.body(size: 13, color: C.inkSoft)),
        const SizedBox(height: 20),
        PfField(
          label: 'Nombre completo',
          controller: _name,
          hint: 'Ej. Camila Reyes',
          caps: TextCapitalization.words,
          action: TextInputAction.next,
          error: _err['name'],
          onChanged: (_) => setState(() => _err.remove('name')),
        ),
        PfField(
          label: 'Correo institucional',
          controller: _email,
          hint: 'nombre@universidad.edu.co',
          keyboard: TextInputType.emailAddress,
          action: TextInputAction.next,
          error: _err['email'],
          onChanged: (_) => setState(() => _err.remove('email')),
        ),
        PasswordField(
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
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => setState(() {
            _consent = !_consent;
            _err.remove('consent');
          }),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 140),
                width: 22,
                height: 22,
                margin: const EdgeInsets.only(top: 1),
                decoration: BoxDecoration(
                  color: _consent ? C.ink : C.surface,
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(color: _err['consent'] != null ? C.error : (_consent ? C.ink : C.lineStrong), width: 1.5),
                ),
                child: _consent ? const Center(child: LIcon('check', size: 14, color: C.cream)) : null,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Acepto el tratamiento de mis datos personales y de salud para usar PlayFit, según la Ley 1581 de 2012. Puedo revocarlo o eliminar mi cuenta cuando quiera.',
                  style: Tx.body(size: 12, color: C.inkSoft, height: 1.5),
                ),
              ),
            ],
          ),
        ),
        if (_err['consent'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(_err['consent']!, style: Tx.body(size: 11.5, w: FontWeight.w600, color: C.error)),
          ),
        const SizedBox(height: 22),
        PfButton('Continuar', kind: BtnKind.gold, onPressed: () {
          FocusScope.of(context).unfocus();
          if (_validateStep1()) setState(() => _step = 2);
        }),
        const SizedBox(height: 10),
        PfButton('Ya tengo cuenta', kind: BtnKind.secondary, onPressed: () => Navigator.of(context).maybePop()),
      ],
    );
  }

  Widget _stepTwo() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Cuéntanos de ti', style: Tx.display(size: 26)),
        const SizedBox(height: 4),
        Text('Paso 2 de 2 · tu punto de partida', style: Tx.body(size: 13, color: C.inkSoft)),
        const SizedBox(height: 14),
        const PanelNote(
          'Estos datos son privados: solo los ves tú y tu docente. La app solo usa indicadores generales (nunca el texto de tu historial) para adaptar recomendaciones.',
          icon: 'shield-check',
        ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: PfField(
                label: 'Peso (kg)',
                controller: _peso,
                hint: '62',
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
                hint: '165',
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
        Text('¿TIENES ALGUNA LESIÓN O CONDICIÓN MÉDICA?', style: Tx.body(size: 10.5, w: FontWeight.w700, color: C.inkSoft, letter: 0.5)),
        const SizedBox(height: 6),
        Segmented(labels: const ['No', 'Sí'], selected: _lesion, onChanged: (i) => setState(() => _lesion = i)),
        if (_lesion == 1)
          PfField(
            label: 'Descríbela brevemente',
            controller: _cond,
            hint: 'Ej. esguince de rodilla en 2024, asma leve…',
            maxLines: 3,
            maxLength: 600,
            caps: TextCapitalization.sentences,
            error: _err['cond'],
            onChanged: (_) => setState(() => _err.remove('cond')),
          ),
        const SizedBox(height: 14),
        PfButton('Crear cuenta y empezar', kind: BtnKind.gold, loading: _loading, onPressed: _submit),
        const SizedBox(height: 10),
        PfButton('Atrás', kind: BtnKind.secondary, onPressed: _loading ? null : () => setState(() => _step = 1)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: C.cream,
      body: SafeArea(
        child: Column(
          children: [
            const OfflineBanner(),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 16, 0),
              child: Row(
                children: [
                  PfIconButton('chevron-left', onTap: () {
                    if (_step == 2 && !_loading) {
                      setState(() => _step = 1);
                    } else {
                      Navigator.of(context).maybePop();
                    }
                  }),
                  const Spacer(),
                  Text('$_step / 2', style: Tx.mono(size: 12, color: C.inkMute)),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(22, 8, 22, 28),
                children: [_step == 1 ? _stepOne() : _stepTwo()],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
