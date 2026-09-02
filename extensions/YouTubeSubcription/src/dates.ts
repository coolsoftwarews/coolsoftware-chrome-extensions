/**
 * Reading "5 days ago" in whatever language YouTube is speaking.
 *
 * A feed tile carries no machine-readable date — just the relative phrase it
 * prints. So the period filter has to read that phrase, which means knowing the
 * words for the units in the reader's language.
 *
 * The shape of the phrase varies more than the words do ("vor 5 Tagen",
 * "il y a 5 jours", "5 dagen geleden", "5日前"), so nothing here matches whole
 * phrases. It finds a number, looks at the word next to it, and asks whether
 * that word starts with a known unit stem. Stems rather than full words because
 * most of these languages inflect for plural, and a stem covers both.
 */

export type LanguageCode =
  | 'en' | 'de' | 'es' | 'fr' | 'it' | 'nl' | 'pt' | 'pl'
  | 'tr' | 'id' | 'ru' | 'ja' | 'ko' | 'zh';

export const LANGUAGES: Array<{ code: LanguageCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pt', label: 'Português' },
  { code: 'pl', label: 'Polski' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
];

const MS = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
} as const;

type Unit = keyof typeof MS;

/**
 * Unit stems per language, longest-matching-wins.
 *
 * Ordered longest first within each language on purpose: in German, "Monat"
 * must be tested before "M…" would ever match something shorter, and in
 * Russian "месяц" before "мес". Getting this wrong turns months into minutes,
 * which is a filter that quietly lies rather than one that visibly fails.
 */
const STEMS: Record<LanguageCode, Array<[string, Unit]>> = {
  en: [['second', 'second'], ['minute', 'minute'], ['hour', 'hour'], ['day', 'day'], ['week', 'week'], ['month', 'month'], ['year', 'year']],
  de: [['sekunde', 'second'], ['minute', 'minute'], ['stunde', 'hour'], ['tag', 'day'], ['woche', 'week'], ['monat', 'month'], ['jahr', 'year']],
  es: [['segundo', 'second'], ['minuto', 'minute'], ['hora', 'hour'], ['día', 'day'], ['dia', 'day'], ['semana', 'week'], ['mes', 'month'], ['año', 'year'], ['ano', 'year']],
  fr: [['seconde', 'second'], ['minute', 'minute'], ['heure', 'hour'], ['jour', 'day'], ['semaine', 'week'], ['mois', 'month'], ['année', 'year'], ['an', 'year']],
  it: [['secondo', 'second'], ['minuto', 'minute'], ['ora', 'hour'], ['giorno', 'day'], ['settimana', 'week'], ['mese', 'month'], ['mesi', 'month'], ['anno', 'year'], ['anni', 'year']],
  nl: [['seconde', 'second'], ['minuut', 'minute'], ['uur', 'hour'], ['dag', 'day'], ['week', 'week'], ['maand', 'month'], ['jaar', 'year']],
  pt: [['segundo', 'second'], ['minuto', 'minute'], ['hora', 'hour'], ['dia', 'day'], ['semana', 'week'], ['mês', 'month'], ['mes', 'month'], ['ano', 'year']],
  pl: [['sekund', 'second'], ['minut', 'minute'], ['godzin', 'hour'], ['dzień', 'day'], ['dni', 'day'], ['tydzień', 'week'], ['tygodn', 'week'], ['miesiąc', 'month'], ['miesię', 'month'], ['rok', 'year'], ['lat', 'year']],
  tr: [['saniye', 'second'], ['dakika', 'minute'], ['saat', 'hour'], ['gün', 'day'], ['hafta', 'week'], ['ay', 'month'], ['yıl', 'year']],
  id: [['detik', 'second'], ['menit', 'minute'], ['jam', 'hour'], ['hari', 'day'], ['minggu', 'week'], ['bulan', 'month'], ['tahun', 'year']],
  ru: [['секунд', 'second'], ['минут', 'minute'], ['час', 'hour'], ['день', 'day'], ['дня', 'day'], ['дней', 'day'], ['недел', 'week'], ['месяц', 'month'], ['год', 'year'], ['года', 'year'], ['лет', 'year']],
  ja: [['秒', 'second'], ['分', 'minute'], ['時間', 'hour'], ['日', 'day'], ['週間', 'week'], ['か月', 'month'], ['ヶ月', 'month'], ['年', 'year']],
  ko: [['초', 'second'], ['분', 'minute'], ['시간', 'hour'], ['일', 'day'], ['주', 'week'], ['개월', 'month'], ['년', 'year']],
  zh: [['秒', 'second'], ['分钟', 'minute'], ['小时', 'hour'], ['天', 'day'], ['周', 'week'], ['个月', 'month'], ['年', 'year']],
};

// Longest stem first, so "月" never wins where "か月" applies.
for (const list of Object.values(STEMS)) list.sort((a, b) => b[0].length - a[0].length);

/** Number, then whatever word follows it — the only shape common to all of them. */
const PAIR = /(\d+)\s*([^\d\s]{1,12})/gu;

/**
 * How old the text says something is, in milliseconds, or null if it does not
 * say — in which case the caller keeps the item. Over-showing costs one video;
 * over-hiding empties the feed and looks like a bug.
 */
export function parseAge(text: string, language: LanguageCode): number | null {
  const stems = STEMS[language] ?? STEMS.en;
  const haystack = text.toLowerCase();

  PAIR.lastIndex = 0;
  for (let match = PAIR.exec(haystack); match; match = PAIR.exec(haystack)) {
    const amount = Number(match[1]);
    const word = match[2];
    if (!Number.isFinite(amount)) continue;

    for (const [stem, unit] of stems) {
      if (word.startsWith(stem)) return amount * MS[unit];
    }
  }
  return null;
}

/**
 * What language the page is in, from YouTube's own `<html lang>`.
 *
 * Detection beats asking: the setting exists for when this is wrong, not as the
 * first line of defence. Unknown languages fall back to English rather than to
 * "no filtering", because an English stem list still catches an English tile on
 * a mislabelled page.
 */
export function detectLanguage(): LanguageCode {
  const raw = document.documentElement.lang || navigator.language || 'en';
  const base = raw.toLowerCase().split('-')[0];
  return (LANGUAGES.find((l) => l.code === base)?.code ?? 'en') as LanguageCode;
}
