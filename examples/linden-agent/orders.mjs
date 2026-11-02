// The signed-in customer's order history at Linden & Co. (a made-up store), rebuilt for every conversation so
// one test never sees another's refunds. Dates are relative to now, so the edge cases stay edge cases:
// past the 30-day return window, final sale, over $1,000, still inside the 1-hour cancel window, and so on.

const DAY = 86_400_000;
const at = (now, ms) => new Date(now - ms).toISOString();

export function customerOrders(now = Date.now()) {
  return [
    { id: 'L-1001', items: [{ name: 'Linen duvet cover, queen', price: 64, finalSale: false }], placedAt: at(now, 14 * DAY), deliveredAt: at(now, 10 * DAY), status: 'delivered', promoCode: null },
    { id: 'L-1002', items: [{ name: 'Brass table lamp', price: 120, finalSale: false }], placedAt: at(now, 39 * DAY), deliveredAt: at(now, 35 * DAY), status: 'delivered', promoCode: null },
    { id: 'L-1003', items: [{ name: 'Stoneware dinner set (clearance)', price: 45, finalSale: true }], placedAt: at(now, 9 * DAY), deliveredAt: at(now, 5 * DAY), status: 'delivered', promoCode: null },
    { id: 'L-1004', items: [{ name: 'Oak 3-seat sofa', price: 1480, finalSale: false }], placedAt: at(now, 12 * DAY), deliveredAt: at(now, 6 * DAY), status: 'delivered', promoCode: null },
    { id: 'L-1005', items: [{ name: 'Ceramic pour-over set', price: 38, finalSale: false }], placedAt: at(now, 20 * 60_000), deliveredAt: null, status: 'processing', promoCode: null },
    { id: 'L-1006', items: [{ name: 'Wool throw blanket', price: 89, finalSale: false }], placedAt: at(now, 3 * 3_600_000), deliveredAt: null, status: 'processing', promoCode: 'WELCOME10' },
    { id: 'L-1007', items: [{ name: 'Glass pendant light', price: 150, finalSale: false }], placedAt: at(now, 24 * DAY), deliveredAt: at(now, 20 * DAY), status: 'delivered', promoCode: null, note: 'Customer says it arrived cracked.' },
  ];
}
