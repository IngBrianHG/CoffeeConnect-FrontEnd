import type { MeasurementCategory, MeasurementUnit } from './model';
import { Dropdown } from 'primereact/dropdown';

const categoryNames: Record<MeasurementCategory, string> = {
  weight: 'Peso', volume: 'Volumen', preparation: 'Preparación', count: 'Conteo', purchase: 'Presentaciones',
};

export function MeasurementUnitSelect({
  units, value, onChange, compatibleCodes, id, disabled = false,
}: {
  units: MeasurementUnit[];
  value: string;
  onChange: (code: string) => void;
  compatibleCodes: Set<string>;
  id?: string;
  disabled?: boolean;
}) {
  const categories: MeasurementCategory[] = ['weight', 'volume', 'preparation', 'count'];
  const options = categories.flatMap(category => {
    const choices = units.filter(unit => unit.category === category && compatibleCodes.has(unit.code));
    return choices.length ? [{
      label: categoryNames[category],
      items: choices.map(unit => ({ label: `${unit.name} (${unit.abbreviation})`, value: unit.code })),
    }] : [];
  });
  return (
    <Dropdown
      inputId={id}
      value={value}
      options={options}
      optionGroupLabel="label"
      optionGroupChildren="items"
      onChange={event => onChange(event.value)}
      placeholder="Selecciona unidad"
      required
      disabled={disabled}
      className="w-full"
    />
  );
}
