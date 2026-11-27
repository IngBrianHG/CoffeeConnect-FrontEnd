import {
  CakeSlice,
  Coffee,
  Cookie,
  Croissant,
  IceCreamCone,
  UtensilsCrossed,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import type { FixedKioskCategoryName } from '../../features/catalog/categoryNames';

const CATEGORY_ICONS: Record<FixedKioskCategoryName, LucideIcon> = {
  'Bebidas frías': IceCreamCone,
  'Bebidas calientes': Coffee,
  Postres: Cookie,
  Pasteles: CakeSlice,
  Repostería: Croissant,
  Pan: Wheat,
  Otros: UtensilsCrossed,
};

export function CategoryIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = Object.hasOwn(CATEGORY_ICONS, name)
    ? CATEGORY_ICONS[name as FixedKioskCategoryName]
    : UtensilsCrossed;
  return <Icon size={size} aria-hidden="true" />;
}
