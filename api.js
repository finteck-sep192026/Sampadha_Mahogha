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
  // A login ID (CL-1001, RA-024) or email → the account's email; unknown input is treated as an email.
  async function loginEmail(identifier) {
    const id = String(identifier || '').trim();
    try {
      return (await sb.rpc('resolve_login', { identifier: id })).data || id;
    } catch {
      return id;
    }
  }
  async function login(identifier, password) {
    const email = await loginEmail(identifier);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Incorrect ID/email or password. Please try again.');
  }
  // Sign in with an email code, no password: loginCode('request') emails it, this checks it. The
  // session came from the mailbox, so the database counts it as through the sign-in code too.
  async function loginWithEmailCode(identifier, code) {
    const token = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(token)) throw new Error('Enter the code from the email.');
    const { error } = await sb.auth.verifyOtp({ email: await loginEmail(identifier), token, type: 'email' });
    if (error)
      throw new Error('That code is not right or has expired. Check the latest email, or send a new code.');
  }
  const logout = () => sb.auth.signOut();
  // Sign-in code (login-code Edge Function): after the password, the database refuses this
  // session until the code emailed to the person is verified.
  const loginCodeStatus = async () => (await sb.rpc('login_code_status')).data;
  async function loginCode(action, body = {}) {
    const { data, error } = await sb.functions.invoke('login-code', { body: { action, ...body } });
    if (error) {
      let message = error.message;
      try {
        message = (await error.context.json()).error || message;
      } catch {
        /* keep the generic message */
      }
      throw new Error(
        error.name === 'FunctionsFetchError' ? 'The sign-in code service is not reachable.' : message,
      );
    }
    return data;
  }
  async function currentProfile() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const { data: row } = await sb
      .from('profiles')
      .select('*')
      .eq('id', data.session.user.id)
      .maybeSingle();
    return row?.is_active ? row : null; // null: no profile, or access turned off (no access)
  }

  // ───────────── set-password links (accounts Edge Function emails them) ─────────────
  // The link lands here as #access_token=…&refresh_token=…&type=recovery, or #error=… when it has
  // expired or was used. Returns { ok } after storing the session, { error } or null (no link).
  async function sessionFromLink() {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (!hash.has('access_token') && !hash.has('error')) return null;
    history.replaceState(null, '', location.pathname + location.search);
    if (hash.has('error'))
      return { error: hash.get('error_description') || 'This link has expired or was already used.' };
    const { error } = await sb.auth.setSession({
      access_token: hash.get('access_token'),
      refresh_token: hash.get('refresh_token'),
    });
    return error ? { error: error.message } : { ok: true, type: hash.get('type') };
  }
  async function setPassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }

  // ───────────── mapping rows to the shapes the screens already render ─────────────
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
    clientId: r.client_id,
  });
  const mapMail = (r, reportRefs) => ({
    id: r.mail_ref,
    application: r.application_ref || reportRefs.get(r.report_id) || '—',
    to: r.recipient_email,
    cc: r.cc_emails || [],
    clientId: r.client_id,
    name: r.recipient_name || '',
    subject: r.subject,
    type: r.mail_type,
    status: r.status,
    sent: stamp(r.sent_at, true) + ' IST',
    delivered: r.delivered_at ? stamp(r.delivered_at, true) + ' IST' : '',
    note: r.provider_message || '',
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
    sentAt: r.sent_at,
    signedAt: r.signed_at,
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
    // Cash: 'portfolio' (from the 12-column CSV) or 'pack' (an uploaded monthly research pack PDF).
    cashKind: r.cash_kind || 'portfolio',
    packMonth: r.pack_month || '',
    packStocks: r.pack_stocks || [],
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
      brokerEmails,
      compliance,
      riskProfiles,
      clientDocuments,
    ] = await Promise.all([
      // "All recommendations" is built from delivered reports below; the old sample tables
      // (cash_recommendations, multi_recommendations) are no longer read.
      [],
      [],
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
      staff
        ? rpc('list_broker_email_clients')
        : ok(q('broker_email_consents')),
      staff ? rpc('list_client_compliance') : [],
      ok(q('risk_profiles', (x) => x.order('submitted_at', { ascending: false }).limit(200))),
      role === 'ra'
        ? []
        : ok(q('client_documents', (x) => x.order('created_at', { ascending: false }))),
    ]);

    const exitsByLeg = new Map();
    exits.forEach((e) => exitsByLeg.set(e.leg_id, [...(exitsByLeg.get(e.leg_id) || []), e]));
    const reportRefs = new Map(reports.map((r) => [r.id, r.report_ref]));
    const idToLogin = new Map(directory.map((p) => [p.id, p.login_id]));
    const planName = new Map(plans.map((p) => [p.code, p.name]));
    const subByClient = new Map(subs.map((s) => [s.client_id, s]));

    const mappedReports = reports.map((r) =>
      mapReport(r, legs, deliveries, exitsByLeg, attachments, cashRows),
    );
    // Every recommendation from a signed report that has been sent (RLS limits a client to the
    // reports delivered to them).
    const sentReports = mappedReports.filter((r) => r.sentAt);
    const publishedOf = (r) => stamp(r.signedAt || r.createdAt);
    return {
      cash: sentReports
        .filter((r) => r.segment === 'Cash')
        .flatMap((r) =>
          r.cashRows.map((c) => ({
            id: r.ref,
            reportId: r.id,
            product: r.cashProduct || c.productName,
            stock: c.stock,
            action: c.action,
            price: rupee(c.price, 2),
            qty: c.quantity,
            published: publishedOf(r),
            delivered: stamp(r.sentAt),
            status: c.action === 'HOLD' ? 'Hold' : 'Active',
          })),
        ),
      multi: sentReports
        .filter((r) => r.segment === 'Multi')
        .flatMap((r) =>
          r.rows.map((l) => ({
            id: r.ref,
            reportId: r.id,
            product: l.product,
            symbol: l.symbol,
            expiry: dateOnly(l.expiry),
            strike: l.strike === '' ? '—' : Number(l.strike).toLocaleString('en-IN'),
            option: l.option || '—',
            side: l.side,
            lots: l.lots,
            lotSize: l.lotSize,
            qty: l.quantity,
            price: rupee(l.price, 2),
            published: publishedOf(r),
            delivered: stamp(r.sentAt),
            status: l.status === 'Closed' ? 'Closed' : 'Active',
          })),
        ),
      plans,
      alerts: alerts.map(mapAlert),
      applications: apps.map(mapApplication),
      mails: mails.map((m) => mapMail(m, reportRefs)),
      strategies,
      directory,
      subscriptions: subs,
      payments,
      audit,
      reports: mappedReports,
      researchClients,
      cashClients,
      // Broker auto-email details per client (a client gets only their own row)
      brokerEmails,
      // Compliance (Compliance page): per-client overview for staff, risk answers, documents to sign
      compliance,
      riskProfiles,
      clientDocuments,
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
  // The database queues outgoing mail in email_log; the mailer Edge Function sends it. A failed flush
  // never fails the action itself: the rows stay queued and the next flush picks them up.
  const flushMail = async () => {
    try {
      return (await sb.functions.invoke('mailer', { body: { action: 'flush' } })).data;
    } catch {
      return null;
    }
  };
  const withMail = (fn) => async (...args) => {
    const result = await fn(...args);
    await flushMail();
    return result;
  };
  const submitApplication = withMail((payload) => rpc('submit_client_application', { payload }));
  const decideApplication = withMail((appRef, approve) =>
    rpc('decide_client_application', { p_app_ref: appRef, p_approve: approve }),
  );
  const markNotificationsRead = () => rpc('mark_notifications_read');
  const createDraft = (title, sections, legs) =>
    rpc('create_research_draft', { p_title: title, p_sections: sections, p_legs: legs });
  const sendReport = withMail((reportId, clientIds, types) =>
    rpc('send_research_report', { p_report_id: reportId, p_client_ids: clientIds, p_types: types }),
  );
  const createCashDraft = (product, frequency, fileName, rows) =>
    rpc('create_cash_report_draft', {
      p_product: product,
      p_frequency: frequency,
      p_file_name: fileName,
      p_rows: rows,
    });
  const sendCashReport = withMail((reportId, clientIds) =>
    rpc('send_cash_report', { p_report_id: reportId, p_client_ids: clientIds }),
  );

  // ───────────── broker auto-email (consent rows in v2.broker_email_consents) ─────────────
  // loginId is ignored for a client (always their own record); Admin/Sales name the client.
  const saveBrokerEmail = (loginId, details, consent = false) =>
    rpc('save_broker_email', {
      p_login_id: loginId || null,
      p_broker: details.broker,
      p_broker_client_id: details.brokerClientId,
      p_to_email: details.toEmail,
      p_cc_emails: details.ccEmails,
      p_consent: consent,
    });
  const revokeBrokerEmail = (loginId) => rpc('revoke_broker_email', { p_login_id: loginId || null });
  const sendBrokerTestEmail = withMail((loginId, testEmail) =>
    rpc('send_broker_test_email', { p_login_id: loginId || null, p_test_email: testEmail || null }),
  );
  // ───────────── client compliance (risk profile, documents to sign, KYC) ─────────────
  const riskQuestionnaire = () => rpc('risk_questionnaire');
  const submitRiskProfile = (answers) => rpc('submit_risk_profile', { p_answers: answers });
  const setClientKyc = (loginId, status) =>
    rpc('set_client_kyc', { p_login_id: loginId, p_status: status });
  const cancelClientDocument = (id) => rpc('cancel_client_document', { p_id: id });
  // Stored under a fresh id (never overwritten), then registered; the client is notified by email.
  const sendClientDocument = withMail(async (client, file, details) => {
    const id = crypto.randomUUID();
    must(
      await sb.storage
        .from(BUCKET)
        .upload(`clients/${client.id}/${id}.pdf`, file, {
          contentType: 'application/pdf',
          upsert: false,
        }),
    );
    return rpc('create_client_document', {
      p_id: id,
      p_login_id: client.login_id,
      p_title: details.title,
      p_kind: details.kind,
      p_file_name: file.name,
      p_sign_pages: details.signPages,
    });
  });
  async function clientEsign(action, body) {
    const { data, error } = await sb.functions.invoke('client-esign', {
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
  const clientEsignStart = (documentId, mobile, returnUrl) =>
    clientEsign('start', { documentId, mobile, returnUrl });
  const clientEsignVerify = (documentId) => clientEsign('verify', { documentId });

  const sendTestEmail = withMail((to) => rpc('send_test_email', { p_to: to }));
  // Staff and client logins (accounts Edge Function, Admin only).
  async function accounts(action, body = {}) {
    const { data, error } = await sb.functions.invoke('accounts', { body: { action, ...body } });
    if (error) {
      if (error.name === 'FunctionsFetchError')
        throw new Error('The account service is not reachable. Ask an administrator to deploy it.');
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

  async function mailerStatus() {
    const { data, error } = await sb.functions.invoke('mailer', { body: { action: 'status' } });
    if (error) throw new Error('The mailer service is not reachable.');
    return data;
  }
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

  // ───────────── Cash monthly research packs (made on the analyst's PC by the generator) ─────────────
  const listCashStockLists = async () =>
    must(await sb.from('cash_stock_lists').select('*').order('month', { ascending: false }).limit(24));
  const saveCashStockList = (month, fileName, lists) =>
    rpc('save_cash_stock_list', {
      p_month: month,
      p_file_name: fileName,
      p_lc: lists.LC,
      p_mc: lists.MC,
      p_sc: lists.SC,
    });
  const createCashPackDraft = (product, month, fileName, sha256) =>
    rpc('create_cash_pack_draft', {
      p_product: product,
      p_month: month,
      p_file_name: fileName,
      p_pdf_sha256: sha256,
    });
  const replaceCashPackPdf = (reportId, fileName, sha256) =>
    rpc('replace_cash_pack_pdf', { p_report_id: reportId, p_file_name: fileName, p_pdf_sha256: sha256 });

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
    loginCodeStatus,
    loginCode,
    loginWithEmailCode,
    currentProfile,
    loadWorkspace,
    submitApplication,
    decideApplication,
    markNotificationsRead,
    createDraft,
    sendReport,
    createCashDraft,
    listCashStockLists,
    saveCashStockList,
    createCashPackDraft,
    replaceCashPackPdf,
    sendCashReport,
    closeLeg,
    saveBrokerEmail,
    revokeBrokerEmail,
    sendBrokerTestEmail,
    mailerStatus,
    sendTestEmail,
    flushMail,
    accounts,
    sessionFromLink,
    setPassword,
    riskQuestionnaire,
    submitRiskProfile,
    setClientKyc,
    sendClientDocument,
    cancelClientDocument,
    clientEsignStart,
    clientEsignVerify,
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
