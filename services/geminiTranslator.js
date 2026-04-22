import translate from 'google-translate-api-x';

/**
 * Translate a single English string to Telugu using free Google Translate.
 * Returns empty string on failure — never throws.
 */
export async function translateToTelugu(text) {
  if (!text || text.trim() === '') return '';
  try {
    const res = await translate(text, { from: 'en', to: 'te' });
    return res.text || '';
  } catch (err) {
    console.error('[Translator] Error translating to Telugu:', err?.message || err);
    return '';
  }
}

/**
 * Translate multiple fields in one batch.
 * @param {Object} fields - { columnName: 'English text', ... }
 * @returns {Object} - { columnName: 'Telugu text', ... }
 * Never throws — returns {} on failure.
 */
export async function translateFields(fields) {
  const entries = Object.entries(fields).filter(([, v]) => v && v.trim() !== '');
  if (entries.length === 0) return {};

  const result = {};

  // Translate each field individually so partial failures don't lose everything
  await Promise.all(
    entries.map(async ([key, value]) => {
      try {
        const res = await translate(value, { from: 'en', to: 'te' });
        if (res.text) {
          result[key] = res.text;
        }
      } catch (err) {
        console.error(`[Translator] Error translating field "${key}":`, err?.message || err);
        // Skip this field — result[key] stays undefined
      }
    })
  );

  return result;
}