const assert = require('node:assert/strict');
const { test } = require('node:test');

const coupons = require('../lib/coupons');
const invoice = require('../lib/invoice');
const orders = require('../lib/orders');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

const mixedCart = [
  { id: 1, name: 'Rice', sku: 'RICE', hsn: '1006', price: 600, qty: 2 },
  { id: 2, name: 'Ghee', sku: 'GHEE', hsn: '0405', price: 800, qty: 1 }
];
const tea = { id: 3, name: 'Tea', sku: 'TEA', hsn: '0902', price: 500, qty: 1 };

// The order route stores the aggregate billing figures and catalog line snapshots.
function billedOrder(items, coupon = '') {
  const billing = pricing.computeTotals(items, coupon);
  const order = orders.add({ nextOrderId: 1, orders: [] }, {
    date: '01/04/2022',
    items,
    coupon,
    subtotal: billing.subtotal,
    discount: billing.discount,
    tax: billing.tax,
    total: billing.total
  });
  return { order, billing };
}

test('checkout apportions the capped SAVE10 discount before applying each HSN rate', () => {
  const { billing } = billedOrder(mixedCart, 'SAVE10');
  const { lines, ...totals } = billing;

  assert.deepEqual(totals, {
    subtotal: 2000, discount: 150, taxable: 1850, tax: 144.30,
    cgst: 72.15, sgst: 72.15, total: 1994.30
  });
  assert.deepEqual(lines.map(({ gstPercent, discount, taxable, tax }) => ({
    gstPercent, discount, taxable, tax
  })), [
    { gstPercent: 5, discount: 90, taxable: 1110, tax: 55.50 },
    { gstPercent: 12, discount: 60, taxable: 740, tax: 88.80 }
  ]);
});

test('an undiscounted 18% HSN line matches checkout', () => {
  const { order } = billedOrder([tea]);
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.total, 590);
  assert.equal(figures.total, 590);
  assert.equal(figures.tax, 90);
  assert.equal(figures.cgst, 45);
  assert.equal(figures.sgst, 45);
  assert.equal(reports.getGstReconciliation({ orders: [order] }).rows[0].matched, true);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('invoice matches the billed total and GST breakdown for a mixed-rate discounted order', () => {
  const { order } = billedOrder(mixedCart, 'SAVE10');
  const { rows, ...totals } = invoice.computeInvoiceFigures(order);

  assert.deepEqual(totals, {
    subtotal: 2000, discount: 150, tax: 144.30, cgst: 72.15, sgst: 72.15, total: 1994.30
  });
  assert.deepEqual(rows.map(({ gstPercent, lineTax }) => ({ gstPercent, lineTax })), [
    { gstPercent: 5, lineTax: 55.50 },
    { gstPercent: 12, lineTax: 88.80 }
  ]);

  const html = invoice.render(order);
  assert.match(html, /<td class="r">5%<\/td><td class="r">₹55\.50<\/td>/);
  assert.match(html, /<td class="r">12%<\/td><td class="r">₹88\.80<\/td>/);
  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">₹144\.30/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹1994\.30/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('invoice and reconciliation still report a genuine historical total mismatch', () => {
  const { order } = billedOrder(mixedCart, 'SAVE10');
  const historicalOrder = { ...order, total: 1990 };
  const { rows, ...summary } = reports.getGstReconciliation({ orders: [historicalOrder] });

  assert.equal(rows[0].invoiceTotal, 1994.30);
  assert.equal(rows[0].ledgerTotal, 1990);
  assert.equal(rows[0].delta, 4.30);
  assert.equal(rows[0].matched, false);
  assert.deepEqual(summary, { totalChecked: 1, mismatchCount: 1, totalDelta: 4.30 });
  assert.match(invoice.render(historicalOrder), /Accountant Reconciliation Notice:.*₹1994\.30.*₹1990\.00.*\+₹4\.30/);
});

test('invoice resolves GST slabs from order lines that store HSN alone', () => {
  const { order } = billedOrder(mixedCart);
  const { rows, ...totals } = invoice.computeInvoiceFigures(order);

  assert.equal(order.tax, 156);
  assert.equal(order.total, 2156);
  assert.deepEqual(totals, {
    subtotal: 2000, discount: 0, tax: 156, cgst: 78, sgst: 78, total: 2156
  });
  assert.deepEqual(rows.map(({ hsn, gstPercent, lineTax }) => ({ hsn, gstPercent, lineTax })), [
    { hsn: '1006', gstPercent: 5, lineTax: 60 },
    { hsn: '0405', gstPercent: 12, lineTax: 96 }
  ]);
});

test('reconciliation matches a mixed-rate invoice with a capped coupon', () => {
  const { order } = billedOrder(mixedCart, 'SAVE10');
  const { rows, ...summary } = reports.getGstReconciliation({ orders: [order] });

  assert.deepEqual(summary, { totalChecked: 1, mismatchCount: 0, totalDelta: 0 });
  assert.deepEqual(rows[0], {
    orderId: 1, date: '01/04/2022', customer: 'Walk-in', coupon: 'SAVE10',
    ledgerSubtotal: 2000, ledgerDiscount: 150, ledgerTax: 144.30, ledgerTotal: 1994.30,
    invoiceDiscount: 150, invoiceTax: 144.30, invoiceTotal: 1994.30, delta: 0, matched: true
  });
});

test('invoice applies a flat coupon before calculating GST', () => {
  const { order } = billedOrder([tea], 'FLAT50');
  const figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual({ discount: order.discount, tax: order.tax, total: order.total }, {
    discount: 50, tax: 81, total: 531
  });
  assert.deepEqual({ discount: figures.discount, tax: figures.tax, total: figures.total }, {
    discount: 50, tax: 81, total: 531
  });
});

test('an uncapped percent coupon matches checkout on both GST and total', () => {
  const { order } = billedOrder([tea], 'SAVE10');
  const figures = invoice.computeInvoiceFigures(order);
  const reconciliation = reports.getGstReconciliation({ orders: [order] });

  assert.equal(order.total, 531);
  assert.equal(figures.total, 531);
  assert.equal(order.tax, 81);
  assert.equal(figures.tax, 81);
  assert.equal(order.discount, 50);
  assert.equal(figures.discount, 50);
  assert.equal(reconciliation.rows[0].matched, true);
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('invoice skips stored coupons that checkout rejects', () => {
  for (const { coupon, price, total } of [
    { coupon: 'SAVE10', price: 100, total: 118 },
    { coupon: 'DIWALI20', price: 1000, total: 1180 }
  ]) {
    assert.equal(coupons.validate(coupon, price).valid, false, coupon);

    // Represent a pre-existing record without submitting the coupon to checkout.
    const { order } = billedOrder([{ ...tea, price }]);
    const figures = invoice.computeInvoiceFigures({ ...order, coupon });
    assert.equal(figures.discount, 0, coupon);
    assert.equal(figures.total, total, coupon);
  }
});

test('invoice honors a stored decimal GST rate like checkout', () => {
  const item = { ...tea, price: 100, gstRate: 0.12 };
  const { order, billing } = billedOrder([item]);
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(billing.lines[0].gstPercent, 12);
  assert.equal(order.tax, 12);
  assert.equal(order.total, 112);
  assert.equal(figures.rows[0].gstPercent, 12);
  assert.equal(figures.tax, 12);
  assert.equal(figures.total, 112);
});

test('invoice GST totals add up to the rounded GST on each line', () => {
  const items = [{ ...tea, price: 0.03 }, { ...tea, id: 4, price: 0.03 }];
  const { order, billing } = billedOrder(items);
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.tax, 0.02);
  assert.equal(billing.cgst, 0.01);
  assert.equal(billing.sgst, 0.01);
  assert.equal(order.total, 0.08);
  assert.deepEqual(figures.rows.map(({ lineTax }) => lineTax), [0.01, 0.01]);
  assert.equal(figures.tax, 0.02);
  assert.equal(figures.cgst, 0.01);
  assert.equal(figures.sgst, 0.01);
  assert.equal(figures.total, 0.08);
});
