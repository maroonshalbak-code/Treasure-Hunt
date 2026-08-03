import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import ar from '../locales/ar.json'
import he from '../locales/he.json'

const RTL_LANGS = ['ar', 'he']

export function applyLanguage(lang) {
  i18n.changeLanguage(lang)
  const isRtl = RTL_LANGS.includes(lang)
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
  document.documentElement.lang = lang
}

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ar: { translation: ar }, he: { translation: he } },
    lng: localStorage.getItem('lang') || 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })

// Apply direction on initial load
applyLanguage(i18n.language)

export default i18n
