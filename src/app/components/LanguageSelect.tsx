import { useId } from 'react';
import { LANGUAGES, languageName, type LanguageCode } from '../../core/languages';
import { useI18n } from '../i18n';

export function LanguageSelect(props: {
  label: string;
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
}) {
  const { lang } = useI18n();
  const id = useId();
  const options = LANGUAGES.map((code) => ({ code, name: languageName(code, lang) })).sort((a, b) =>
    a.name.localeCompare(b.name, lang),
  );
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as LanguageCode)}
        className="rounded-md border border-slate-300 bg-white px-3 py-2"
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
