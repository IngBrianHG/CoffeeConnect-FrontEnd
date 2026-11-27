export const FIXED_KIOSK_CATEGORY_NAMES = [
  'Bebidas frías',
  'Bebidas calientes',
  'Postres',
  'Pasteles',
  'Repostería',
  'Pan',
  'Otros',
] as const;

export type FixedKioskCategoryName = typeof FIXED_KIOSK_CATEGORY_NAMES[number];
