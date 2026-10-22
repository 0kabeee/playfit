import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Colores y medidas tomados 1:1 del mockup (variables CSS :root).
class C {
  static const Color cream = Color(0xFFF6F1E7);
  static const Color creamDark = Color(0xFFEFE8D8);
  static const Color surface = Color(0xFFFFFDF8);
  static const Color ink = Color(0xFF211B15);
  static const Color inkSoft = Color(0xFF6B6255);
  static const Color inkMute = Color(0xFFA79C89);
  static const Color line = Color(0xFFE8DFCE);
  static const Color lineStrong = Color(0xFFD7CBAF);
  static const Color gold = Color(0xFFF0B23E);
  static const Color goldBg = Color(0xFFFCEFD3);
  static const Color brown = Color(0xFFC69368);
  static const Color brownBg = Color(0xFFF3E7DB);
  static const Color yellow = Color(0xFFDFA827);
  static const Color yellowBg = Color(0xFFFBF1D4);
  static const Color green = Color(0xFF5C9048);
  static const Color greenBg = Color(0xFFE8F1E3);
  static const Color blue = Color(0xFF4E7FAE);
  static const Color blueBg = Color(0xFFE7EFF6);
  static const Color purple = Color(0xFF8368AE);
  static const Color purpleBg = Color(0xFFEFEAF6);
  static const Color pink = Color(0xFFC96C77);
  static const Color pinkBg = Color(0xFFF8E9EB);
  static const Color orange = Color(0xFFD9832E);
  static const Color orangeBg = Color(0xFFFCEEDD);
  static const Color error = Color(0xFFB23B2C);
  static const Color errorBg = Color(0xFFFAEAE7);

  static const double rs = 14;
  static const double rm = 20;
  static const double rl = 26;

  /// Color fuerte por nombre de tono
  static Color fg(String tone) {
    switch (tone) {
      case 'brown':
        return brown;
      case 'yellow':
        return yellow;
      case 'green':
        return green;
      case 'blue':
        return blue;
      case 'purple':
        return purple;
      case 'pink':
        return pink;
      case 'orange':
        return orange;
      case 'error':
        return error;
      case 'gold':
        return ink;
      case 'grey':
        return inkSoft;
      default:
        return ink;
    }
  }

  /// Color de fondo suave por nombre de tono
  static Color bg(String tone) {
    switch (tone) {
      case 'brown':
        return brownBg;
      case 'yellow':
        return yellowBg;
      case 'green':
        return greenBg;
      case 'blue':
        return blueBg;
      case 'purple':
        return purpleBg;
      case 'pink':
        return pinkBg;
      case 'orange':
        return orangeBg;
      case 'error':
        return errorBg;
      case 'gold':
        return goldBg;
      case 'grey':
        return line;
      default:
        return cream;
    }
  }
}

/// Estilos de texto: Nunito Sans (cuerpo), Baloo 2 (titulos) y Space Mono (cifras), como en el mockup.
class Tx {
  static TextStyle body({double size = 14, FontWeight w = FontWeight.w400, Color color = C.ink, double? height, double? letter}) =>
      GoogleFonts.nunitoSans(fontSize: size, fontWeight: w, color: color, height: height, letterSpacing: letter);

  static TextStyle display({double size = 19, FontWeight w = FontWeight.w700, Color color = C.ink, double? height}) =>
      GoogleFonts.baloo2(fontSize: size, fontWeight: w, color: color, height: height);

  static TextStyle mono({double size = 14, FontWeight w = FontWeight.w400, Color color = C.ink, double? letter}) =>
      GoogleFonts.spaceMono(fontSize: size, fontWeight: w, color: color, letterSpacing: letter);
}

ThemeData buildTheme() {
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: C.cream,
    colorScheme: ColorScheme.fromSeed(seedColor: C.gold, surface: C.surface),
    splashColor: C.goldBg,
    highlightColor: Colors.transparent,
  );
}
