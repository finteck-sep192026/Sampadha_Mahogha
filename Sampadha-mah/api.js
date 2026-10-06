// Data layer: everything the portal reads or writes goes through here.
// Security lives in Postgres (RLS + SECURITY DEFINER functions); this file only calls it.
(() => {
  const cfg = window.SAMPADHA_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const IST = 'Asia/Kolkata';
  const stampParts = (iso) => {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: IST,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .forEach((p) => (parts[p.type] = p.value));
    return parts;
  };
  // '12 Aug 2026 • 09:24'  (add seconds for mail timestamps)
  const stamp = (iso, seconds = false) => {
    if (!iso) return '';
    const p = stampParts(iso);
    return `${p.day} ${p.month} ${p.year} • ${p.hour}:${p.minute}${seconds ? ':' + p.second : ''}`;
  };
  // value for <input type="datetime-local"> style 'YYYY-MM-DDTHH:mm' in IST
  const istLocal = (iso) => {
    const p = stampParts(iso),
      months = {
        Jan: '01',
        Feb: '02',
        Mar: '03',
        Apr: '04',
        May: '05',
        Jun: '06',
        Jul: '07',
        Aug: '08',
        Sep: '09',
        Oct: '10',
        Nov: '11',
        Dec: '12',
      };
    return `${p.year}-${months[p.month]}-${p.day}T${p.hour}:${p.minute}`;
  };
  const dateOnly = (d) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-');
    const names = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${day} ${names[Number(m) - 1]} ${y}`;
  };
  const rupee = (n, decimals = 0) =>
    '₹' +
    Number(n).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  // Postgres/PostgREST errors arrive as "message"; strip nothing, but keep ours readable.
  const rpc = async (name, args) => must(await sb.rpc(name, args));

  const CHANNEL_ICON = { Email: '✉', WhatsApp: '◉', 'In-app': '🔔' };

  // ───────────── session ─────────────
  async function login(identifier, password) {
    const id = String(identifier || '').trim();
    let email = null;
    try {
      email = (await sb.rpc('resolve_login', { identifier: id })).data;
    } catch {
      /* fall through: treat the input as an email */
    }
    const { error } = await sb.auth.signInWithPassword({ email: email || id, password });
    if (error) throw new Error('Incorrect ID/email or password. Please try again.');
  }
  const logout = () => sb.auth.signOut();
  async function currentProfile() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const { data: row } = await sb
      .from('profiles')
      .select('*')
      .eq('id', data.session.user.id)
      .maybeSingle();
    return row; // null when the user has no profile (no access)
  }

  // ───────────── mapping rows to the shapes the screens already render ─────────────
  const mapCash = (r) => ({
    id: r.ref,
    product: r.product,
    stock: r.stock,
    price: rupee(r.price),
    qty: r.qty,
    published: stamp(r.published_at),
    delivered: stamp(r.delivered_at),
    status: r.status,
  });
  const mapMulti = (r) => ({
    id: r.ref,
    product: r.product,
    symbol: r.symbol,
    expiry: dateOnly(r.expiry),
    strike: Number(r.strike).toLocaleString('en-IN'),
    option: r.option_type,
    side: r.side,
    lots: r.lots,
    lotSize: r.lot_size,
    qty: r.qty,
    price: rupee(r.price, 2),
    published: stamp(r.published_at),
    delivered: stamp(r.delivered_at),
    status: r.status,
  });
  const mapAlert = (r) => ({
    id: r.alert_ref,
    channel: r.channel,
    icon: CHANNEL_ICON[r.channel] || '🔔',
    title: r.title,
    detail: r.detail,
    time: stamp(r.created_at) + ' IST',
    unread: r.unread,
  });
  const mapApplication = (r) => ({
    id: r.app_ref,
    name: r.full_name,
    pan: r.pan,
    mobile: r.mobile,
    email: r.email,
    broker: r.broker || '—',
    demat: r.demat_id || '—',
    segments: (r.segments || []).join(', ') || '—',
    risk: r.risk_profile || '—',
    amount: r.proposed_amount == null ? '—' : rupee(r.proposed_amount),
    submitted: stamp(r.submitted_at) + ' IST',
    status: r.status,
  });
  const mapMail = (r, reportRefs) => ({
    id: r.mail_ref,
    application: r.application_ref || reportRefs.get(r.report_id) || '—',
    to: r.recipient_email,
    name: r.recipient_name || '',
    subject: r.subject,
    type: r.mail_type,
    status: r.status,
    sent: stamp(r.sent_at, true) + ' IST',
    body: r.body,
  });
  const mapLeg = (l, exits) => ({
    id: l.id,
    product: l.product,
    symbol: l.symbol,
    expiry: l.expiry,
    strike: Number(l.strike),
    option: l.option_type,
    side: l.side,
    lots: l.lots,
    lotSize: l.lot_size,
    quantity: l.quantity,
    price: Number(l.initiation_price),
    published: istLocal(l.published_at),
    delivered: l.delivered_at ? stamp(l.delivered_at, true) + ' IST' : '',
    status: l.status,
    closedQty: l.closed_qty,
    remainingQty: l.remaining_qty,
    closingPrice: l.avg_closing_price == null ? 0 : Number(l.avg_closing_price),
    lastExit: l.last_exit_at ? stamp(l.last_exit_at, true) + ' IST' : '',
    closedAt: l.closed_at ? stamp(l.closed_at, true) + ' IST' : '',
    exits: (exits || []).map((e) => ({
      quantity: e.quantity,
      price: Number(e.price),
      at: stamp(e.at, true) + ' IST',
    })),
  });
  const mapReport = (r, legs, deliveries, exitsByLeg) => ({
    id: r.id,
    ref: r.report_ref,
    title: r.title,
    sections: r.sections,
    product: r.product,
    authorId: r.author_id,
    created: stamp(r.created_at, true) + ' IST',
    status: r.status,
    sent: r.sent_at ? stamp(r.sent_at, true) + ' IST' : '',
    rows: legs
      .filter((l) => l.report_id === r.id)
      .sort((a, b) => a.position - b.position)
      .map((l) => mapLeg(l, exitsByLeg.get(l.id))),
    recipients: deliveries.filter((d) => d.report_id === r.id).map((d) => d.client_id),
  });

  // ───────────── workspace load (RLS decides what each role actually gets back) ─────────────
  async function loadWorkspace(profile) {
    const role = profile.role,
      staff = ['admin', 'ra', 'sales'].includes(role),
      q = (table, build) => {
        const query = sb.from(table).select('*');
        return build ? build(query) : query;
      },
      ok = async (promise) => {
        const { data, error } = await promise;
        if (error) throw new Error(error.message);
        return data || [];
      };
    const [
      cash,
      multi,
      plans,
      alerts,
      apps,
      mails,
      strategies,
      directory,
      subs,
      payments,
      audit,
      reports,
      legs,
      exits,
      deliveries,
      researchClients,
    ] = await Promise.all([
      ok(q('cash_recommendations', (x) => x.order('published_at'))),
      ok(q('multi_recommendations', (x) => x.order('published_at'))),
      ok(q('plans', (x) => x.order('sort_order'))),
      role === 'client'
        ? ok(q('client_notifications', (x) => x.order('created_at', { ascending: false })))
        : [],
      ['admin', 'sales'].includes(role)
        ? ok(q('client_applications', (x) => x.order('submitted_at', { ascending: false })))
        : [],
      ['admin', 'sales', 'client'].includes(role)
        ? ok(q('email_log', (x) => x.order('sent_at', { ascending: false })))
        : [],
      ['admin', 'ra'].includes(role)
        ? ok(q('strategies', (x) => x.order('updated_at', { ascending: false })))
        : [],
      ['admin', 'sales'].includes(role) ? ok(q('profiles', (x) => x.order('login_id'))) : [],
      ['admin', 'sales', 'client'].includes(role) ? ok(q('subscriptions')) : [],
      ['admin', 'client'].includes(role) ? ok(q('payments', (x) => x.order('invoice_no'))) : [],
      role === 'admin'
        ? ok(q('audit_log', (x) => x.order('at', { ascending: false }).limit(100)))
        : [],
      ok(q('research_reports', (x) => x.order('created_at', { ascending: false }))),
      ok(q('research_legs')),
      ok(q('research_leg_exits', (x) => x.order('at'))),
      ok(q('research_deliveries')),
      ['ra', 'admin'].includes(role) ? rpc('list_research_clients') : [],
    ]);

    const exitsByLeg = new Map();
    exits.forEach((e) => exitsByLeg.set(e.leg_id, [...(exitsByLeg.get(e.leg_id) || []), e]));
    const reportRefs = new Map(reports.map((r) => [r.id, r.report_ref]));
    const idToLogin = new Map(directory.map((p) => [p.id, p.login_id]));
    const planName = new Map(plans.map((p) => [p.code, p.name]));
    const subByClient = new Map(subs.map((s) => [s.client_id, s]));

    return {
      cash: cash.map(mapCash),
      multi: multi.map(mapMulti),
      plans,
      alerts: alerts.map(mapAlert),
      applications: apps.map(mapApplication),
      mails: mails.map((m) => mapMail(m, reportRefs)),
      strategies,
      directory,
      subscriptions: subs,
      payments,
      audit,
      reports: reports.map((r) => mapReport(r, legs, deliveries, exitsByLeg)),
      researchClients,
      // [name, id, risk, kyc, plan, email, mobile] rows for the client relationship table
      clientRows: directory
        .filter((p) => p.role === 'client')
        .map((p) => [
          p.full_name,
          p.login_id,
          p.risk_profile || '—',
          p.kyc_status || '—',
          planName.get(subByClient.get(p.id)?.plan_code) || '—',
          p.email,
          p.mobile || '—',
        ]),
      idToLogin,
    };
  }

  // ───────────── writes (all enforced again server-side) ─────────────
  const submitApplication = (payload) => rpc('submit_client_application', { payload });
  const decideApplication = (appRef, approve) =>
    rpc('decide_client_application', { p_app_ref: appRef, p_approve: approve });
  const markNotificationsRead = () => rpc('mark_notifications_read');
  const createDraft = (title, sections, legs) =>
    rpc('create_research_draft', { p_title: title, p_sections: sections, p_legs: legs });
  const sendReport = (reportId, clientIds, types) =>
    rpc('send_research_report', { p_report_id: reportId, p_client_ids: clientIds, p_types: types });
  const closeLeg = (legId, qty, price) =>
    rpc('close_research_leg', { p_leg_id: legId, p_qty: qty, p_price: price });

  // ───────────── authenticator-app (TOTP) signing ─────────────
  const mfa = {
    async factor() {
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) throw new Error(error.message);
      return (data.totp || []).find((f) => f.status === 'verified') || null;
    },
    async enroll() {
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of (list?.all || []).filter((x) => x.status === 'unverified'))
        await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Sampadha reports ' + Date.now(),
      });
      if (error) throw new Error(error.message);
      return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    // Verifying makes the auth server stamp `amr: totp` into the next access token.
    async verify(factorId, code) {
      const { error } = await sb.auth.mfa.challengeAndVerify({
        factorId,
        code: String(code).trim(),
      });
      if (error) throw new Error('That code was not accepted. Check the app and try again.');
    },
  };

  window.Api = {
    sb,
    login,
    logout,
    currentProfile,
    loadWorkspace,
    mfa,
    submitApplication,
    decideApplication,
    markNotificationsRead,
    createDraft,
    sendReport,
    closeLeg,
    fmt: { stamp, rupee, dateOnly },
  };
})();
