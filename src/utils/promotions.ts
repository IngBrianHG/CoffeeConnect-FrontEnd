import type { CartItem } from '../types/Order';
import type { Product } from '../types/Product';
import type { Promotion } from '../types/Promotion';

/**
 * Cálculo de promociones en el navegador (solo para MOSTRAR el descuento al cliente).
 * El precio final lo vuelve a calcular el servidor con la misma regla
 * (backend/utils/promotions.js), así que este cálculo no se puede manipular.
 *
 * Regla NXM: las unidades que califican se ordenan de más caras a más baratas,
 * se forman grupos de buy_qty y en cada grupo salen gratis las más baratas.
 */

export interface LinePricing {
  discount: number;
  net: number;
  promoNames: string[];
}

export interface CartPricing {
  subtotal: number;
  discountTotal: number;
  total: number;
  lines: Record<string, LinePricing>;
  applied: { promoId: number; name: string; discount: number }[];
  hints: string[];
}

const toCents = (n: number) => Math.round(Number(n) * 100);
const fromCents = (c: number) => c / 100;

function matchesScope(promo: Promotion, product: Product): boolean {
  if (promo.product_id) return promo.product_id === product.id;
  if (promo.category_id) return promo.category_id === product.category_id;
  return true;
}

/** Texto corto para la etiqueta: "2x1", "3x2", "20% OFF" */
export function promoLabel(p: Promotion): string {
  return p.type === 'PERCENT' ? `${Number(p.percent)}% OFF` : `${p.buy_qty}x${p.pay_qty}`;
}

/** Promociones que aplican a un producto (para mostrar la etiqueta en el menú) */
export function getProductPromos(product: Product, promotions: Promotion[]): Promotion[] {
  return promotions.filter(p => matchesScope(p, product));
}

export function promoScopeName(p: Promotion): string {
  return p.product_name || p.category_name || 'todo el menú';
}

export function calculateCartPricing(cart: CartItem[], promotions: Promotion[]): CartPricing {
  interface Unit { lineId: string; price: number; product: Product; used: boolean }
  const units: Unit[] = [];
  cart.forEach(item => {
    for (let i = 0; i < item.quantity; i++) {
      units.push({ lineId: item.lineId, price: toCents(item.product.price), product: item.product, used: false });
    }
  });

  const lineDiscount: Record<string, number> = {};
  const lineNames: Record<string, Set<string>> = {};
  const applied: CartPricing['applied'] = [];
  const hints: string[] = [];

  for (const promo of [...promotions].sort((a, b) => a.id - b.id)) {
    const eligible = units
      .filter(u => !u.used && matchesScope(promo, u.product))
      .sort((a, b) => b.price - a.price);
    let promoDiscount = 0;

    const addDiscount = (u: Unit, cents: number) => {
      promoDiscount += cents;
      lineDiscount[u.lineId] = (lineDiscount[u.lineId] ?? 0) + cents;
      (lineNames[u.lineId] ??= new Set()).add(promo.name);
    };

    if (promo.type === 'PERCENT') {
      const pct = Number(promo.percent);
      if (!(pct > 0 && pct <= 100)) continue;
      for (const u of eligible) {
        u.used = true;
        addDiscount(u, Math.round((u.price * pct) / 100));
      }
    } else {
      const buy = promo.buy_qty;
      const pay = promo.pay_qty;
      if (!(buy > pay && pay >= 1)) continue;
      const freePerGroup = buy - pay;
      const groups = Math.floor(eligible.length / buy);

      for (let g = 0; g < groups; g++) {
        const group = eligible.slice(g * buy, (g + 1) * buy);
        group.forEach(u => { u.used = true; });
        group.slice(buy - freePerGroup).forEach(u => addDiscount(u, u.price));
      }

      // Sugerencia: faltan unidades para completar el siguiente grupo
      const leftover = eligible.length - groups * buy;
      if (leftover > 0) {
        const need = buy - leftover;
        hints.push(
          `${promo.name}: agrega ${need} más de ${promoScopeName(promo)} y te llevas ${freePerGroup} gratis`
        );
      }
    }

    if (promoDiscount > 0) {
      applied.push({ promoId: promo.id, name: promo.name, discount: fromCents(promoDiscount) });
    }
  }

  const lines: Record<string, LinePricing> = {};
  let subtotalC = 0;
  let discountC = 0;
  cart.forEach(item => {
    const gross = toCents(item.product.price) * item.quantity;
    const disc = Math.min(lineDiscount[item.lineId] ?? 0, gross);
    subtotalC += gross;
    discountC += disc;
    lines[item.lineId] = {
      discount: fromCents(disc),
      net: fromCents(gross - disc),
      promoNames: [...(lineNames[item.lineId] ?? [])],
    };
  });

  return {
    subtotal: fromCents(subtotalC),
    discountTotal: fromCents(discountC),
    total: fromCents(subtotalC - discountC),
    lines,
    applied,
    hints,
  };
}

/** Id único para cada línea del carrito (compatible con http en red local, a diferencia de crypto.randomUUID) */
export function newLineId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const MAX_NOTE_LENGTH = 200;
