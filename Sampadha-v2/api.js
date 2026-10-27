// Data layer: everything the portal reads or writes goes through here.
// Security lives in Postgres (RLS + SECURITY DEFINER functions in schema v2), Storage policies and
// the esign Edge Function; this file only calls them.
(() => {
  const cfg = window.SAMPADHA_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    db: { schema: 'v2' },
  });
  const BUCKET = 'v2-research';

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
  const mapLeg = (l, exits, signedAt) => ({
    id: l.id,
    position: l.position,
    product: l.product,
    symbol: l.symbol,
    expiry: l.expiry,
    strike: l.strike == null ? '' : Number(l.strike),
    option: l.option_type || '',
    side: l.side,
    lots: l.lots,
    lotSize: l.lot_size,
    quantity: l.quantity,
    price: Number(l.initiation_price),
    t1: l.t1 == null ? '' : Number(l.t1),
    t2: l.t2 == null ? '' : Number(l.t2),
    t3: l.t3 == null ? '' : Number(l.t3),
    // Columns of the 19-column advice CSV (older typed-in legs fall back to their base fields).
    productName: l.product,
    adviceName: l.advice_name || '',
    exchangeName: l.exchange_name || '',
    strategyName: l.strategy_name || '',
    ifIntraday: l.if_intraday || '',
    priceType: l.price_type || '',
    buyOrSell: l.side,
    instrument: l.instrument || l.symbol,
    ceOrPe: l.option_type || '',
    contractName: l.contract_name || '',
    contractExpiryDate: l.expiry,
    entryPriceStart: Number(l.initiation_price),
    entryPriceEnd: l.entry_price_end == null ? '' : Number(l.entry_price_end),
    lot: l.lots,
    targetPrice: l.t1 == null ? '' : Number(l.t1),
    stopLoss: l.stop_loss == null ? '' : Number(l.stop_loss),
    exitPrice: l.exit_price == null ? '' : Number(l.exit_price),
    optionStrikePrice: l.strike == null ? '' : Number(l.strike),
    legId: l.leg_ref || '',
    published: istLocal(l.published_at),
    delivered: l.delivered_at ? stamp(l.delivered_at, true) + ' IST' : '',
    signed: signedAt ? stamp(signedAt, true) + ' IST' : '',
    status: l.status,
    closedLots: l.closed_lots,
    closedQty: l.closed_qty,
    remainingLots: l.remaining_lots,
    remainingQty: l.remaining_qty,
    closingPrice: l.avg_closing_price == null ? 0 : Number(l.avg_closing_price),
    lastExit: l.last_exit_at ? stamp(l.last_exit_at, true) + ' IST' : '',
    closedAt: l.closed_at ? stamp(l.closed_at, true) + ' IST' : '',
    exits: (exits || []).map((e) => ({
      id: e.exit_ref,
      sequence: e.sequence,
      lots: e.lots,
      quantity: e.quantity,
      price: Number(e.price),
      remainingLotsAfter: e.remaining_lots_after,
      remainingAfter: e.remaining_qty_after,
      statusAfter: e.status_after,
      at: stamp(e.at, true) + ' IST',
      recordedAt: Date.parse(e.at),
    })),
    statusHistory: (exits || []).map((e) => ({
      status: e.status_after,
      at: stamp(e.at, true) + ' IST',
      reference: e.exit_ref,
    })),
  });
  const mapCashRow = (c) => ({
    productName: c.product_name,
    portfolioName: c.portfolio_name,
    portfolioType: c.portfolio_type,
    stopPortfolio: c.stop_portfolio,
    isin: c.isin,
    weightage: Number(c.weightage),
    exchangeName: c.exchange_name,
    ifMutualFund: c.if_mutual_fund,
    stock: c.stock,
    action: c.action,
    price: Number(c.initiation_price),
    quantity: c.quantity,
  });
  const mapReport = (r, legs, deliveries, exitsByLeg, attachments, cashRows) => ({
    id: r.id,
    ref: r.report_ref,
    segment: r.segment,
    cashProduct: r.cash_product,
    frequency: r.frequency,
    fileName: r.source_file || '',
    createdAt: r.created_at,
    title: r.title,
    sections: r.sections,
    product: r.product,
    authorId: r.author_id,
    created: stamp(r.created_at, true) + ' IST',
    status: r.status,
    sent: r.sent_at ? stamp(r.sent_at, true) + ' IST' : '',
    esignStatus: r.esign_status,
    parrvaStatus: r.parrva_status,
    parrvaSubmitted: r.parrva_submitted_at ? stamp(r.parrva_submitted_at, true) + ' IST' : '',
    parrvaMessage: r.parrva_message || '',
    signed: r.signed_at ? stamp(r.signed_at, true) + ' IST' : '',
    signerName: r.signer_name || '',
    signedPdfPath: r.signed_pdf_path,
    rows: legs
      .filter((l) => l.report_id === r.id)
      .sort((a, b) => a.position - b.position)
      .map((l) => mapLeg(l, exitsByLeg.get(l.id), r.signed_at)),
    attachments: attachments
      .filter((a) => a.report_id === r.id)
      .sort((a, b) => a.slot - b.slot)
      .map((a) => ({
        id: a.id,
        slot: a.slot,
        name: a.file_name,
        type: a.mime_type,
        size: a.size_bytes,
        path: a.storage_path,
      })),
    cashRows: cashRows
      .filter((c) => c.report_id === r.id)
      .sort((a, b) => a.position - b.position)
      .map(mapCashRow),
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
      attachments,
      cashRows,
      deliveries,
      researchClients,
      cashClients,
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
      ok(q('research_attachments')),
      ok(q('cash_report_rows')),
      ok(q('research_deliveries')),
      ['ra', 'admin'].includes(role) ? rpc('list_research_clients') : [],
      ['ra', 'admin'].includes(role) ? rpc('list_cash_clients') : [],
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
      reports: reports.map((r) =>
        mapReport(r, legs, deliveries, exitsByLeg, attachments, cashRows),
      ),
      researchClients,
      cashClients,
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
  const createCashDraft = (product, frequency, fileName, rows) =>
    rpc('create_cash_report_draft', {
      p_product: product,
      p_frequency: frequency,
      p_file_name: fileName,
      p_rows: rows,
    });
  const sendCashReport = (reportId, clientIds) =>
    rpc('send_cash_report', { p_report_id: reportId, p_client_ids: clientIds });
  const closeLeg = (legId, lots, price) =>
    rpc('close_research_leg', { p_leg_id: legId, p_lots: lots, p_price: price });

  // ───────────── report files (Storage bucket v2-research, policies in the v2 migration) ─────────────
  const upload = async (path, body, contentType) =>
    must(await sb.storage.from(BUCKET).upload(path, body, { contentType, upsert: true }));
  async function uploadAttachment(reportId, slot, file) {
    await upload(`${reportId}/attachments/${slot}`, file, file.type);
    return rpc('register_research_attachment', {
      p_report_id: reportId,
      p_slot: slot,
      p_file_name: file.name || 'pasted-image.png',
      p_mime_type: file.type,
      p_size: file.size,
    });
  }
  const uploadPreviewPdf = (reportId, blob) =>
    upload(`${reportId}/preview.pdf`, blob, 'application/pdf');
  const downloadFile = async (path) => must(await sb.storage.from(BUCKET).download(path));

  // ───────────── weekly contract master (Uploads page → Multi Segment Quick input) ─────────────
  // Newest first; the first entry is the master Quick input uses. At most 50 per call.
  const listSymbolMasters = async (limit = 10) =>
    must(
      await sb
        .from('symbol_masters')
        .select('id, file_name, storage_path, size_bytes, symbols, contracts, format, uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(Math.min(Math.max(Math.trunc(limit) || 1, 1), 50)),
    );
  // Stored under a fresh id (never overwritten), then registered with the counts the browser parsed.
  async function uploadSymbolMaster(file, parsed, contentType) {
    const path = `masters/${crypto.randomUUID()}.${parsed.extension}`;
    must(await sb.storage.from(BUCKET).upload(path, file, { contentType, upsert: false }));
    return rpc('register_symbol_master', {
      p_path: path,
      p_file_name: file.name,
      p_symbols: parsed.symbols,
      p_contracts: parsed.contracts,
      p_format: parsed.format,
    });
  }

  // ───────────── Aadhaar eSign (the esign Edge Function holds the gateway API key) ─────────────
  async function esign(action, body) {
    const { data, error } = await sb.functions.invoke('esign', {
      body: { action, ...body },
    });
    if (error) {
      if (error.name === 'FunctionsFetchError')
        throw new Error('The eSign service is not reachable. Ask an administrator to deploy it.');
      let message = error.message;
      try {
        message = (await error.context.json()).error || message;
      } catch {
        /* keep the generic message */
      }
      throw new Error(message);
    }
    return data;
  }
  const esignStart = (reportId, mobile, returnUrl) =>
    esign('start', { reportId, mobile, returnUrl });
  const esignVerify = (reportId) => esign('verify', { reportId });

  // ───────────── CARE PaRRVA (the parrva Edge Function holds the PaRRVA login) ─────────────
  async function parrvaSubmit(reportId) {
    const { data, error } = await sb.functions.invoke('parrva', {
      body: { action: 'submit', reportId },
    });
    if (error) {
      if (error.name === 'FunctionsFetchError')
        throw new Error(
          'The CARE PaRRVA service is not reachable. Ask an administrator to deploy it.',
        );
      let message = error.message;
      try {
        message = (await error.context.json()).error || message;
      } catch {
        /* keep the generic message */
      }
      throw new Error(message);
    }
    return data;
  }

  window.Api = {
    sb,
    login,
    logout,
    currentProfile,
    loadWorkspace,
    submitApplication,
    decideApplication,
    markNotificationsRead,
    createDraft,
    sendReport,
    createCashDraft,
    sendCashReport,
    closeLeg,
    uploadAttachment,
    uploadPreviewPdf,
    downloadFile,
    listSymbolMasters,
    uploadSymbolMaster,
    esignStart,
    esignVerify,
    parrvaSubmit,
    fmt: { stamp, rupee, dateOnly },
  };
})();
