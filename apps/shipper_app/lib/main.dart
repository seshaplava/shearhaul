import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'api.dart';
import 'i18n.dart';

void main() {
  runApp(const ShipperApp());
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

const corridorPresets = {
  'BOM-PNQ': {
    'label': 'Mumbai → Pune',
    'originLat': 19.076,
    'originLng': 72.8777,
    'originAddress': 'Mumbai Andheri',
    'destLat': 18.5204,
    'destLng': 73.8567,
    'destAddress': 'Pune Baner',
  },
  'DEL-JAI': {
    'label': 'Delhi → Jaipur',
    'originLat': 28.6139,
    'originLng': 77.209,
    'originAddress': 'Delhi Okhla',
    'destLat': 26.9124,
    'destLng': 75.7873,
    'destAddress': 'Jaipur Sitapura',
  },
  'MAA-BLR': {
    'label': 'Chennai → Bengaluru',
    'originLat': 13.0827,
    'originLng': 80.2707,
    'originAddress': 'Chennai Guindy',
    'destLat': 12.9716,
    'destLng': 77.5946,
    'destAddress': 'Bengaluru Peenya',
  },
  'HYD-BLR': {
    'label': 'Hyderabad → Bengaluru',
    'originLat': 17.385,
    'originLng': 78.4867,
    'originAddress': 'Hyderabad Kukatpally',
    'destLat': 12.9716,
    'destLng': 77.5946,
    'destAddress': 'Bengaluru Electronic City',
  },
  'AMD-BOM': {
    'label': 'Ahmedabad → Mumbai',
    'originLat': 23.0225,
    'originLng': 72.5714,
    'originAddress': 'Ahmedabad Vatva',
    'destLat': 19.076,
    'destLng': 72.8777,
    'destAddress': 'Mumbai Bhiwandi',
  },
};

class ShipperApp extends StatelessWidget {
  const ShipperApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ShareHaul Shipper',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0B6E4F)),
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
    _boot();
  }

  Future<void> _boot() async {
    await api.loadToken();
    await i18n.load();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => api.token == null
            ? LoginPage(api: api, i18n: i18n)
            : HomePage(api: api, i18n: i18n),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.api, required this.i18n});
  final ApiClient api;
  final I18n i18n;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final phoneCtrl = TextEditingController(text: '9111111111');
  final otpCtrl = TextEditingController(text: '123456');
  String? info;
  bool loading = false;

  Future<void> _request() async {
    setState(() {
      loading = true;
      info = null;
    });
    try {
      final res = await widget.api.post('/auth/otp/request', {
        'phone': phoneCtrl.text.trim(),
        'role': 'SHIPPER',
      });
      setState(() => info = 'OTP sent. Dev code: ${res['devCode'] ?? 'check SMS'}');
    } catch (e) {
      setState(() => info = e.toString());
    } finally {
      setState(() => loading = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      loading = true;
      info = null;
    });
    try {
      final res = await widget.api.post('/auth/otp/verify', {
        'phone': phoneCtrl.text.trim(),
        'code': otpCtrl.text.trim(),
        'role': 'SHIPPER',
      });
      await widget.api.saveToken(res['accessToken'] as String);
      try {
        await widget.api.post('/devices/token', {
          'token': 'web-shipper-${phoneCtrl.text.trim()}',
          'platform': kIsWeb ? 'web' : 'app',
        });
      } catch (_) {}
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => HomePage(api: widget.api, i18n: widget.i18n),
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
    final t = widget.i18n.t;
    return Scaffold(
      appBar: AppBar(
        title: Text(t('app.name', 'ShareHaul')),
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
            Text(t('auth.otp.title', 'Enter mobile number'),
                style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 16),
            TextField(
              controller: phoneCtrl,
              decoration: const InputDecoration(labelText: 'Phone'),
              keyboardType: TextInputType.phone,
            ),
            TextField(
              controller: otpCtrl,
              decoration: const InputDecoration(labelText: 'OTP'),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: loading ? null : _request, child: const Text('Request OTP')),
            const SizedBox(height: 8),
            FilledButton.tonal(onPressed: loading ? null : _verify, child: const Text('Verify & login')),
            if (info != null) ...[
              const SizedBox(height: 16),
              Text(info!),
            ],
          ],
        ),
      ),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.api, required this.i18n});
  final ApiClient api;
  final I18n i18n;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List loads = [];
  String? error;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final res = await widget.api.get('/loads');
      setState(() => loads = res as List);
    } catch (e) {
      setState(() => error = e.toString());
    } finally {
      setState(() => loading = false);
    }
  }

  Future<void> _logout() async {
    await widget.api.clearToken();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => LoginPage(api: widget.api, i18n: widget.i18n),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.i18n.t;
    return Scaffold(
      appBar: AppBar(
        title: Text(t('load.post', 'My loads')),
        actions: [
          IconButton(
            tooltip: 'Notifications',
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
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
          IconButton(onPressed: _logout, icon: const Icon(Icons.logout)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => PostLoadPage(api: widget.api, i18n: widget.i18n),
            ),
          );
          _refresh();
        },
        label: Text(t('load.post', 'Post load')),
        icon: const Icon(Icons.add),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Text(error!))
              : loads.isEmpty
                  ? const Center(child: Text('No loads yet'))
                  : ListView.builder(
                      itemCount: loads.length,
                      itemBuilder: (_, i) {
                        final l = loads[i] as Map;
                        return ListTile(
                          title: Text('${l['originAddress']} → ${l['destAddress']}'),
                          subtitle: Text('${l['mode']} · ${l['status']} · ${l['weightKg']} kg'),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => LoadDetailPage(
                                api: widget.api,
                                i18n: widget.i18n,
                                loadId: l['id'] as String,
                              ),
                            ),
                          ),
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
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await widget.api.get('/notifications');
      setState(() {
        items = res as List;
        error = null;
      });
    } catch (e) {
      setState(() => error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: error != null
          ? Center(child: Text(error!))
          : items.isEmpty
              ? const Center(child: Text('No notifications yet'))
              : ListView.builder(
                  itemCount: items.length,
                  itemBuilder: (_, i) {
                    final n = items[i] as Map;
                    final unread = n['readAt'] == null;
                    return ListTile(
                      leading: Icon(
                        unread ? Icons.mark_email_unread : Icons.mark_email_read,
                        color: unread ? Colors.orange : null,
                      ),
                      title: Text('${n['title']}'),
                      subtitle: Text('${n['body']}'),
                      onTap: () async {
                        try {
                          await widget.api.post('/notifications/${n['id']}/read', {});
                          _load();
                        } catch (_) {}
                      },
                    );
                  },
                ),
    );
  }
}

class PostLoadPage extends StatefulWidget {
  const PostLoadPage({super.key, required this.api, required this.i18n});
  final ApiClient api;
  final I18n i18n;

  @override
  State<PostLoadPage> createState() => _PostLoadPageState();
}

class _PostLoadPageState extends State<PostLoadPage> {
  bool loading = false;
  String? error;
  String mode = 'DEDICATED';
  String corridor = 'BOM-PNQ';
  bool wantInsurance = true;

  Future<void> _submit() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final now = DateTime.now().toUtc();
      final c = corridorPresets[corridor]!;
      final load = await widget.api.post('/loads', {
        'mode': mode,
        'corridorCode': corridor,
        'originLat': c['originLat'],
        'originLng': c['originLng'],
        'originAddress': c['originAddress'],
        'destLat': c['destLat'],
        'destLng': c['destLng'],
        'destAddress': c['destAddress'],
        'weightKg': mode == 'SHARED' ? 600 : 1200,
        'volumeCft': mode == 'SHARED' ? 100 : 200,
        'cargoType': 'general',
        'windowStart': now.add(const Duration(hours: 2)).toIso8601String(),
        'windowEnd': now.add(const Duration(hours: 12)).toIso8601String(),
      });
      if (wantInsurance) {
        try {
          await widget.api.post('/insurance/quote', {
            'loadId': load['id'],
            'select': true,
          });
        } catch (_) {}
      }
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => LoadDetailPage(
            api: widget.api,
            i18n: widget.i18n,
            loadId: load['id'] as String,
          ),
        ),
      );
    } catch (e) {
      setState(() => error = e.toString());
    } finally {
      setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.i18n.t('load.post', 'Post load'))),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: ListView(
          children: [
            DropdownButtonFormField<String>(
              value: corridor,
              decoration: InputDecoration(
                labelText: widget.i18n.t('corridor.pick', 'Choose corridor'),
              ),
              items: corridorPresets.entries
                  .map((e) => DropdownMenuItem(
                        value: e.key,
                        child: Text('${e.value['label']} (${e.key})'),
                      ))
                  .toList(),
              onChanged: (v) => setState(() => corridor = v ?? corridor),
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: [
                ButtonSegment(
                  value: 'DEDICATED',
                  label: Text(widget.i18n.t('mode.dedicated', 'Dedicated')),
                ),
                ButtonSegment(
                  value: 'SHARED',
                  label: Text(widget.i18n.t('mode.shared', 'Shared')),
                ),
                ButtonSegment(
                  value: 'RETURN',
                  label: Text(widget.i18n.t('mode.return', 'Return')),
                ),
              ],
              selected: {mode},
              onSelectionChanged: (s) => setState(() => mode = s.first),
            ),
            if (mode == 'SHARED') ...[
              const SizedBox(height: 12),
              Text(
                'Shared waits ~90s for co-loads, splits price by weight×distance (2-opt route), then you can convert to Dedicated if alone.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (mode == 'RETURN') ...[
              const SizedBox(height: 12),
              Text(
                'Return loads are priced lower and matched to trucks finishing near your pickup (empty-mile score).',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(widget.i18n.t('insurance.add', 'Cargo insurance quote')),
              value: wantInsurance,
              onChanged: (v) => setState(() => wantInsurance = v),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: loading ? null : _submit,
              child: Text(loading ? 'Posting…' : 'Post $mode load'),
            ),
            if (error != null) Text(error!, style: const TextStyle(color: Colors.red)),
          ],
        ),
      ),
    );
  }
}

class LoadDetailPage extends StatefulWidget {
  const LoadDetailPage({
    super.key,
    required this.api,
    required this.i18n,
    required this.loadId,
  });
  final ApiClient api;
  final I18n i18n;
  final String loadId;

  @override
  State<LoadDetailPage> createState() => _LoadDetailPageState();
}

class _LoadDetailPageState extends State<LoadDetailPage> {
  Map? load;
  Map? offersMeta;
  List offers = [];
  List insurance = [];
  String? error;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final l = await widget.api.get('/loads/${widget.loadId}');
      final o = await widget.api.get('/loads/${widget.loadId}/offers') as Map;
      List ins = [];
      try {
        ins = await widget.api.get('/insurance/load/${widget.loadId}') as List;
      } catch (_) {}
      setState(() {
        load = l as Map;
        offersMeta = o;
        offers = o['offers'] as List? ?? [];
        insurance = ins;
      });
    } catch (e) {
      setState(() => error = e.toString());
    } finally {
      setState(() => loading = false);
    }
  }

      Future<void> _select(String offerId) async {
    try {
      final res = await widget.api.post('/offers/$offerId/select', {});
      if (!mounted) return;
      final tripId = (res['trip'] as Map)['id'] as String;
      final payment = res['payment'] as Map?;
      final checkout = res['checkout'] as Map?;
      final status = payment?['status'];
      if (status == 'CREATED' && checkout != null) {
        // Razorpay / mock authorize dialog
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Authorize escrow'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  checkout['provider'] == 'razorpay'
                      ? 'Razorpay order ${checkout['order_id']}\nAmount: ₹${((checkout['amount'] as num?) ?? 0) / 100}'
                      : 'Mock escrow — no real charge.',
                ),
                const SizedBox(height: 8),
                Text(
                  'After live Razorpay Checkout, webhook confirms HOLD. For demo, tap Confirm hold.',
                  style: Theme.of(ctx).textTheme.bodySmall,
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () async {
                  await widget.api.post('/payments/trip/$tripId/mock-confirm', {});
                  if (ctx.mounted) Navigator.pop(ctx);
                },
                child: const Text('Confirm hold'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Continue to track'),
              ),
            ],
          ),
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Trip assigned · escrow $status')),
      );
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => TripTrackPage(
            api: widget.api,
            i18n: widget.i18n,
            tripId: tripId,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _convertDedicated() async {
    try {
      await widget.api.post('/loads/${widget.loadId}/convert-dedicated', {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Converted to Dedicated — refresh offers')),
      );
      _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isShared = load?['mode'] == 'SHARED';
    final canConvert = offersMeta?['canConvertDedicated'] == true ||
        offers.any((o) => ((o as Map)['priceBreakdown'] as Map?)?['soloShared'] == true);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Load & offers'),
        actions: [IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh))],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Text(error!))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text('${load?['originAddress']} → ${load?['destAddress']}'),
                    Text('Status: ${load?['status']} · Mode: ${load?['mode']}'),
                    if (insurance.isNotEmpty)
                      Text(
                        'Insurance: ₹${((insurance.first as Map)['premiumPaisa'] as int) / 100} selected',
                      ),
                    if (isShared) ...[
                      const SizedBox(height: 8),
                      Text(
                        'Shared wait ends: ${offersMeta?['sharedWaitEndsAt'] ?? '—'}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      Text(
                        'Fallback: ${offersMeta?['aloneFallback'] ?? '—'}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (canConvert)
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton(
                            onPressed: _convertDedicated,
                            child: const Text('Convert to Dedicated (solo / timeout)'),
                          ),
                        ),
                    ],
                    const Divider(),
                    Text('Offers', style: Theme.of(context).textTheme.titleMedium),
                    if (offers.isEmpty)
                      const Text('No offers yet — pull to refresh'),
                    ...offers.map((o) {
                      final m = o as Map;
                      final price = (m['pricePaisa'] as int) / 100;
                      final b = (m['priceBreakdown'] as Map?) ?? {};
                      final co = b['coLoadCount'] ?? 0;
                      final saved = b['inrSaved'];
                      final etaMin = b['etaRangeMin'];
                      final etaMax = b['etaRangeMax'];
                      final routeKm = b['routeKm'];
                      return Card(
                        child: ListTile(
                          title: Text('₹${price.toStringAsFixed(0)} · ${b['regNo'] ?? 'truck'}'),
                          subtitle: Text(
                            [
                              if (isShared) 'Co-loads: $co · save ₹$saved',
                              if (etaMin != null) 'ETA ${etaMin}–${etaMax}h',
                              if (routeKm != null) 'Route ~${routeKm} km',
                              if (b['splitMethod'] != null) 'Split: ${b['splitMethod']}',
                              if (b['soloShared'] == true) 'Solo shared (full truck share)',
                            ].where((x) => x.isNotEmpty).join('\n'),
                          ),
                          isThreeLine: true,
                          trailing: FilledButton(
                            onPressed: () => _select(m['id'] as String),
                            child: const Text('Select'),
                          ),
                        ),
                      );
                    }),
                  ],
                ),
    );
  }
}

class TripTrackPage extends StatefulWidget {
  const TripTrackPage({
    super.key,
    required this.api,
    required this.i18n,
    required this.tripId,
  });
  final ApiClient api;
  final I18n i18n;
  final String tripId;

  @override
  State<TripTrackPage> createState() => _TripTrackPageState();
}

class _TripTrackPageState extends State<TripTrackPage> {
  Map? trip;
  Map? location;
  Map? mapInfo;
  List docs = [];
  String? error;
  String? info;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final t = await widget.api.get('/trips/${widget.tripId}');
      final loc = await widget.api.get('/trips/${widget.tripId}/location');
      List d = [];
      try {
        d = await widget.api.get('/documents/trip/${widget.tripId}') as List;
      } catch (_) {}
      Map? map;
      final location = (loc as Map)['location'] as Map?;
      if (location != null) {
        try {
          map = await widget.api.get(
            '/maps/static?lat=${location['lat']}&lng=${location['lng']}',
          ) as Map;
        } catch (_) {}
      }
      setState(() {
        trip = t as Map;
        this.location = loc;
        docs = d;
        mapInfo = map;
        error = null;
      });
    } catch (e) {
      setState(() => error = e.toString());
    }
  }

  Future<void> _claim() async {
    try {
      await widget.api.post('/claims', {
        'tripId': widget.tripId,
        'type': 'DAMAGE',
        'notes': 'Demo claim from shipper app',
        'amountClaimed': 50000,
      });
      setState(() => info = 'Claim opened — trip marked DISPUTED');
      _refresh();
    } catch (e) {
      setState(() => info = e.toString());
    }
  }

  Future<void> _docs() async {
    try {
      await widget.api.post('/documents/trip/${widget.tripId}/lr', {});
      await widget.api.post('/documents/trip/${widget.tripId}/invoice', {});
      setState(() => info = 'LR + GST invoice stubs issued');
      _refresh();
    } catch (e) {
      setState(() => info = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final loc = location?['location'] as Map?;
    final stops = (trip?['stops'] as List?) ?? [];
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.i18n.t('trip.track', 'Track trip')),
        actions: [IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh))],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: error != null
            ? Text(error!)
            : ListView(
                children: [
                  Text('Status: ${trip?['status'] ?? '…'}',
                      style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 12),
                  Text('Location: ${loc == null ? 'waiting for GPS' : '${loc['lat']}, ${loc['lng']}'}'),
                  if (loc != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: () => openMaps(
                          (loc['lat'] as num).toDouble(),
                          (loc['lng'] as num).toDouble(),
                        ),
                        icon: const Icon(Icons.map_outlined),
                        label: const Text('Open in Google Maps'),
                      ),
                    ),
                  if (mapInfo?['url'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.network(
                          mapInfo!['url'] as String,
                          height: 180,
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                  const SizedBox(height: 8),
                  Text('Payments: ${((trip?['payments'] as List?) ?? []).map((p) => '${p['status']}/${p['gatewayProvider'] ?? ''}').join(', ')}'),
                  const Divider(),
                  Text('Stops', style: Theme.of(context).textTheme.titleMedium),
                  ...stops.map((s) {
                    final m = s as Map;
                    final pod = m['pod'] as Map?;
                    return ListTile(
                      dense: true,
                      title: Text('${m['seq']}. ${m['type']} · ${m['address']}'),
                      subtitle: Text(pod?['passed'] == true ? 'POD ✓' : 'POD pending'),
                      trailing: IconButton(
                        icon: const Icon(Icons.navigation_outlined),
                        onPressed: () => openMaps(
                          (m['lat'] as num).toDouble(),
                          (m['lng'] as num).toDouble(),
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 8),
                  FilledButton.tonal(
                    onPressed: _docs,
                    child: Text(widget.i18n.t('docs.lr', 'Issue LR + invoice')),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _claim,
                    child: Text(widget.i18n.t('claim.open', 'Open damage claim')),
                  ),
                  if (docs.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text('Docs: ${docs.map((d) => d['docType']).join(', ')}'),
                  ],
                  if (info != null) ...[
                    const SizedBox(height: 12),
                    Text(info!),
                  ],
                ],
              ),
      ),
    );
  }
}
