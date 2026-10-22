import 'package:flutter/material.dart';

import 'globals.dart';
import 'screens/auth_screens.dart';
import 'screens/home_shell.dart';
import 'state/app_state.dart';
import 'theme/tokens.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PlayFitApp());
  app.bootstrap(); // restaura la sesion guardada (o manda al login)
}

class PlayFitApp extends StatelessWidget {
  const PlayFitApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PlayFit',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      navigatorKey: navigatorKey,
      scaffoldMessengerKey: messengerKey,
      home: const _RootGate(),
    );
  }
}

/// Decide que pantalla mostrar segun el estado de la sesion.
class _RootGate extends StatelessWidget {
  const _RootGate();

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: app,
      builder: (context, _) {
        switch (app.status) {
          case AuthStatus.unknown:
            return const SplashScreen();
          case AuthStatus.loggedOut:
            return const LoginScreen();
          case AuthStatus.expired:
            return const SessionExpiredScreen();
          case AuthStatus.loggedIn:
            return const HomeShell();
        }
      },
    );
  }
}
