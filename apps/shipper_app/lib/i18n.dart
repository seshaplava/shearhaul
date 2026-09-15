import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

class I18n {
  I18n(this.api);

  final ApiClient api;
  String locale = 'en';
  Map<String, String> messages = {};

  static const locales = ['en', 'hi', 'ta', 'te', 'kn', 'mr'];

  static const localeLabels = {
    'en': 'English',
    'hi': 'हिन्दी',
    'ta': 'தமிழ்',
    'te': 'తెలుగు',
    'kn': 'ಕನ್ನಡ',
    'mr': 'मराठी',
  };

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    locale = prefs.getString('locale') ?? 'en';
    await fetch();
  }

  Future<void> setLocale(String code) async {
    locale = code;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('locale', code);
    await fetch();
  }

  Future<void> fetch() async {
    try {
      final res = await api.get('/i18n/$locale');
      final map = (res as Map)['messages'];
      if (map is Map) {
        messages = map.map((k, v) => MapEntry(k.toString(), v.toString()));
      }
    } catch (_) {
      messages = {};
    }
  }

  String t(String key, [String fallback = '']) {
    return messages[key] ?? (fallback.isNotEmpty ? fallback : key);
  }
}
