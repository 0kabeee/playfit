import 'package:flutter/material.dart';

/// Llaves globales: permiten navegar y mostrar avisos desde fuera de un widget (p. ej. cuando expira la sesion).
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> messengerKey = GlobalKey<ScaffoldMessengerState>();

/// Pestaña activa del HomeShell (0 Inicio, 1 Squad, 2 Retos, 3 Técnica, 4 Perfil).
final ValueNotifier<int> shellTab = ValueNotifier<int>(0);
