import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'api.dart';
import 'i18n.dart';

void main() {
  runApp(const DriverApp());
}

String defaultApiBase() {
  if (kIsWeb) return 'http://localhost:3000/v1';
  switch (defaultTargetPlatform) {
    case TargetPlatform.android:
      return 'http://10.0.2.2:3000/v1';
    default:
      return 'http://localhost:3000/v1';
  }
}

Future<void> openMaps(double lat, double lng) async {
  final uri = Uri.parse(
    'https://www.google.com/maps/search/?api=1&query=$lat,$lng',
  );
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

class DriverApp extends StatelessWidget {
  const DriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ShareHaul Driver',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1B4F72)),
        useMaterial3: true,
      ),
      home: const BootPage(),
    );
  }
}

class BootPage extends StatefulWidget {
  const BootPage({super.key});

  @override
  State<BootPage> createState() => _BootPageState();
}

class _BootPageState extends State<BootPage> {
  final api = ApiClient(baseUrl: defaultApiBase());
  late final i18n = I18n(api);

  @override
  void initState() {
    super.initState();
    () async {
      await api.loadToken();
      await i18n.load();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => api.token == null
              ? LoginPage(api: api, i18n: i18n)
              : TripsPage(api: api, i18n: i18n),
        ),
      );
    }();
  }

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.api, required this.i18n});
  final ApiClient api;
  final I18n i18n;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  /// Latest demo bookings often land on 0003 when 0001/0002 are busy.
  final phoneCtrl = TextEditingController(text: '9000000003');
  final otpCtrl = TextEditingController(text: '123456');
  String? info;
  bool loading = false;

  Future<void> _login() async {
    setState(() => loading = true);
    try {
      await widget.api.post('/auth/otp/request', {
        'phone': phoneCtrl.text.trim(),
        'role': 'DRIVER',
      });
      final res = await widget.api.post('/auth/otp/verify', {
        'phone': phoneCtrl.text.trim(),
        'code': otpCtrl.text.trim(),
        'role': 'DRIVER',
      });
      await widget.api.saveToken(res['accessToken'] as String);
      try {
        await widget.api.post('/devices/token', {
          'token': 'web-driver-${phoneCtrl.text.trim()}',
          'platform': kIsWeb ? 'web' : 'app',
        });
      } catch (_) {}
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => TripsPage(api: widget.api, i18n: widget.i18n),
        ),
      );
    } catch (e) {
      setState(() => info = e.toString());
    } finally {
      setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.i18n.t('app.name', 'ShareHaul Driver')),
        actions: [
          PopupMenuButton<String>(
            initialValue: widget.i18n.locale,
            onSelected: (code) async {
              await widget.i18n.setLocale(code);
              setState(() {});
            },
            itemBuilder: (_) => I18n.locales
                .map((c) => PopupMenuItem(
                      value: c,
                      child: Text(I18n.localeLabels[c] ?? c),
                    ))
                .toList(),
            icon: const Icon(Icons.language),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: phoneCtrl,
              decoration: const InputDecoration(labelText: 'Phone'),
            ),
            TextField(
              controller: otpCtrl,
              decoration: const InputDecoration(labelText: 'OTP'),
            ),
            const SizedBox(height: 8),
            const Text(
              'Demo drivers: 9000000001 · 9000000002 · 9000000003\n'
              'Use the phone that owns the trip (check Admin vehicle MH12SH000x).',
              style: TextStyle(fontSize: 12),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: loading ? null : _login,
              child: const Text('Login as driver'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => KycPage(api: widget.api)),
              ),
              child: Text(widget.i18n.t('kyc.submit', 'KYC (after login)')),
            ),
            if (info != null) Text(info!),
          ],
        ),
      ),
    );
  }
}

class TripsPage extends StatefulWidget {
  const TripsPage({super.key, required this.api, required this.i18n});
  final ApiClient api;
  final I18n i18n;

  @override
  State<TripsPage> createState() => _TripsPageState();
}

class _TripsPageState extends State<TripsPage> {
  List trips = [];
  String? error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final res = await widget.api.get('/trips');
      setState(() {
        trips = res as List;
        error = null;
      });
    } catch (e) {
      setState(() => error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My trips'),
        actions: [
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => NotificationsPage(api: widget.api),
              ),
            ),
            icon: const Icon(Icons.notifications_outlined),
          ),
          PopupMenuButton<String>(
            initialValue: widget.i18n.locale,
            onSelected: (code) async {
              await widget.i18n.setLocale(code);
              setState(() {});
            },
            itemBuilder: (_) => I18n.locales
                .map((c) => PopupMenuItem(
                      value: c,
                      child: Text(I18n.localeLabels[c] ?? c),
                    ))
                .toList(),
            icon: const Icon(Icons.language),
          ),
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => KycPage(api: widget.api)),
            ),
            icon: const Icon(Icons.badge_outlined),
          ),
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
          IconButton(
            onPressed: () async {
              await widget.api.clearToken();
              if (!context.mounted) return;
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(
                  builder: (_) =>
                      LoginPage(api: widget.api, i18n: widget.i18n),
                ),
              );
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: error != null
          ? Center(child: Text(error!))
          : trips.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(
                    child: Text(
                      'No trips for this driver.\n\n'
                      'Logout and try 9000000002 or 9000000003.\n'
                      'Your latest shipper booking may be on another demo truck.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView.builder(
                  itemCount: trips.length,
                  itemBuilder: (_, i) {
                    final t = trips[i] as Map;
                    final vehicle = t['vehicle'] as Map?;
                    return ListTile(
                      title: Text('${t['status']} · ${vehicle?['regNo'] ?? 'truck'}'),
                      subtitle: Text('${t['mode']} · ${t['id']}'),
                      onTap: () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => TripActionPage(
                              api: widget.api,
                              i18n: widget.i18n,
                              tripId: t['id'] as String,
                            ),
                          ),
                        );
                        _refresh();
                      },
                    );
                  },
                ),
    );
  }
}

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key, required this.api});
  final ApiClient api;

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  List items = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await widget.api.get('/notifications');
      setState(() => items = res as List);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: items.isEmpty
          ? const Center(child: Text('No notifications'))
          : ListView.builder(
              itemCount: items.length,
              itemBuilder: (_, i) {
                final n = items[i] as Map;
                return ListTile(
                  title: Text('${n['title']}'),
                  subtitle: Text('${n['body']}'),
                  onTap: () async {
                    await widget.api.post('/notifications/${n['id']}/read', {});
                    _load();
                  },
                );
              },
            ),
    );
  }
}

class KycPage extends StatefulWidget {
  const KycPage({super.key, required this.api});
  final ApiClient api;

  @override
  State<KycPage> createState() => _KycPageState();
}

class _KycPageState extends State<KycPage> {
  Map? status;
  String? info;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await widget.api.get('/kyc/status');
      setState(() => status = s as Map);
    } catch (e) {
      setState(() => info = e.toString());
    }
  }

  Future<void> _submit() async {
    try {
      final key = 'kyc/dl-${DateTime.now().millisecondsSinceEpoch}.jpg';
      final presign = await widget.api.post('/storage/presign', {
        'key': key,
        'contentType': 'image/jpeg',
      });
      await widget.api.post('/kyc/documents', {
        'docType': 'DL',
        'storageKey': (presign['key'] as String?) ?? key,
      });
      setState(() => info = 'DL submitted · storage ${presign['key'] ?? key}');
      _load();
    } catch (e) {
      setState(() => info = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final docs = (status?['documents'] as List?) ?? [];
    return Scaffold(
      appBar: AppBar(title: const Text('Driver KYC')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Status: ${status?['driverKyc'] ?? '…'}'),
            const SizedBox(height: 12),
            FilledButton(onPressed: _submit, child: const Text('Submit demo DL')),
            const Divider(),
            ...docs.map((d) {
              final m = d as Map;
              return ListTile(
                title: Text('${m['docType']}'),
                subtitle: Text('${m['status']} · ${m['storageKey']}'),
              );
            }),
            if (info != null) Text(info!),
          ],
        ),
      ),
    );
  }
}

class TripActionPage extends StatefulWidget {
  const TripActionPage({
    super.key,
    required this.api,
    required this.i18n,
    required this.tripId,
  });
  final ApiClient api;
  final I18n i18n;
  final String tripId;

  @override
  State<TripActionPage> createState() => _TripActionPageState();
}

class _TripActionPageState extends State<TripActionPage> {
  Map? trip;
  List returnOffers = [];
  String? info;
  bool busy = false;

  static const nextStatus = {
    'ASSIGNED': 'EN_ROUTE_PICKUP',
    'EN_ROUTE_PICKUP': 'AT_PICKUP',
    'AT_PICKUP': 'LOADED',
    'LOADED': 'IN_TRANSIT',
    'IN_TRANSIT': 'AT_DROPOFF',
    'AT_DROPOFF': 'DELIVERED',
  };

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final t = await widget.api.get('/trips/${widget.tripId}');
    List offers = [];
    final status = (t as Map)['status'] as String?;
    if (status == 'IN_TRANSIT' || status == 'AT_DROPOFF') {
      try {
        final r = await widget.api.get('/trips/${widget.tripId}/return-offers') as Map;
        offers = r['offers'] as List? ?? [];
      } catch (_) {}
    }
    setState(() {
      trip = t;
      returnOffers = offers;
    });
  }

  Future<void> _run(Future<void> Function() fn) async {
    setState(() {
      busy = true;
      info = null;
    });
    try {
      await fn();
      await _refresh();
    } catch (e) {
      setState(() => info = e.toString());
    } finally {
      setState(() => busy = false);
    }
  }

  bool allPodsPassed(String type) {
    final stops = (trip?['stops'] as List?) ?? [];
    final typed = stops.where((s) => (s as Map)['type'] == type).toList();
    if (typed.isEmpty) return true;
    return typed.every((s) => ((s as Map)['pod'] as Map?)?['passed'] == true);
  }

  @override
  Widget build(BuildContext context) {
    final status = trip?['status'] as String?;
    final stops = List<Map>.from(((trip?['stops'] as List?) ?? []).map((s) => s as Map));
    stops.sort((a, b) => ((a['seq'] as int?) ?? 0).compareTo((b['seq'] as int?) ?? 0));

    final next = status == null ? null : nextStatus[status];
    final needPickupPod = next == 'LOADED' && !allPodsPassed('PICKUP');
    final needDropoffPod = next == 'DELIVERED' && !allPodsPassed('DROPOFF');
    final advanceEnabled = !busy && next != null && !needPickupPod && !needDropoffPod;

    return Scaffold(
      appBar: AppBar(title: Text(status ?? 'Trip')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text('Trip ${widget.tripId}', style: Theme.of(context).textTheme.titleMedium),
          Text('Status: $status · Mode: ${trip?['mode']}'),
          Text('Vehicle: ${(trip?['vehicle'] as Map?)?['regNo'] ?? '-'}'),
          if (needPickupPod)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Submit all pickup PODs before LOADED.',
                  style: TextStyle(color: Colors.orange)),
            ),
          if (needDropoffPod)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Submit all dropoff PODs before DELIVERED.',
                  style: TextStyle(color: Colors.orange)),
            ),
          const SizedBox(height: 12),
          Text('Stops (POD per stop)', style: Theme.of(context).textTheme.titleMedium),
          ...stops.map((m) {
            final pod = m['pod'] as Map?;
            final passed = pod?['passed'] == true;
            return Card(
              child: ListTile(
                title: Text('${m['seq']}. ${m['type']} · ${m['address']}'),
                subtitle: Text(passed
                    ? widget.i18n.t('pod.submit', 'POD passed')
                    : 'POD required'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.map_outlined),
                      onPressed: () => openMaps(
                        (m['lat'] as num).toDouble(),
                        (m['lng'] as num).toDouble(),
                      ),
                    ),
                    FilledButton.tonal(
                      onPressed: busy || passed
                          ? null
                          : () => _run(() async {
                                await widget.api.post('/trips/${widget.tripId}/pod', {
                                  'stopId': m['id'],
                                  'otp': '000000',
                                  'lat': m['lat'],
                                  'lng': m['lng'],
                                  'signatureOk': true,
                                });
                                setState(() => info = 'POD for stop ${m['seq']}');
                              }),
                      child: Text(passed ? 'Done' : 'POD'),
                    ),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: busy
                ? null
                : () => _run(() async {
                      await widget.api.post('/trips/${widget.tripId}/accept');
                      setState(() => info = 'Accepted');
                    }),
            child: const Text('1. Accept assignment'),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: advanceEnabled
                ? () => _run(() async {
                      final res = await widget.api.post(
                        '/trips/${widget.tripId}/status',
                        {'status': next},
                      );
                      final st = res['trip']?['status'] ?? next;
                      setState(() => info = 'Moved to $st');
                    })
                : null,
            child: Text(
              next == null
                  ? '2. Advance status'
                  : needPickupPod || needDropoffPod
                      ? '2. Advance → $next (POD required)'
                      : '2. Advance → $next',
            ),
          ),
          const SizedBox(height: 8),
          FilledButton.tonal(
            onPressed: busy || status == null
                ? null
                : () => _run(() async {
                      await widget.api.post('/tracking/points', {
                        'tripId': widget.tripId,
                        'points': [
                          {
                            'lat': 18.5204,
                            'lng': 73.8567,
                            'speed': 40,
                            'recordedAt': DateTime.now().toUtc().toIso8601String(),
                          }
                        ],
                      });
                      setState(() => info = 'GPS point sent');
                    }),
            child: const Text('3. Send GPS point'),
          ),
          if (returnOffers.isNotEmpty) ...[
            const Divider(),
            Text('Return offers near dropoff',
                style: Theme.of(context).textTheme.titleMedium),
            ...returnOffers.map((o) {
              final m = o as Map;
              final price = (m['pricePaisa'] as int) / 100;
              final b = (m['priceBreakdown'] as Map?) ?? {};
              return ListTile(
                title: Text('₹${price.toStringAsFixed(0)} · ${b['distKm']} km'),
                subtitle: Text(
                  '${b['origin'] ?? 'Load'} → ${b['dest'] ?? ''}\n'
                  'Toward home ~${b['towardHomeKm'] ?? '-'} km',
                ),
                isThreeLine: true,
                trailing: FilledButton(
                  onPressed: busy
                      ? null
                      : () => _run(() async {
                            final res = await widget.api
                                .post('/offers/${m['id']}/accept-return', {});
                            setState(() =>
                                info = 'Return trip ${(res['trip'] as Map?)?['id']}');
                          }),
                  child: const Text('Take'),
                ),
              );
            }),
          ],
          if (info != null) ...[
            const SizedBox(height: 16),
            Text(info!),
          ],
        ],
      ),
    );
  }
}
