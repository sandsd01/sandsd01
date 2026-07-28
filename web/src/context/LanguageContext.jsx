import { createContext, useCallback, useContext, useState } from 'react'
import { translations } from '../i18n/translations'

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => localStorage.getItem('language') || 'en')

  const changeLanguage = useCallback((lang) => {
    setLanguage(lang)
    localStorage.setItem('language', lang)
  }, [])

  const t = useCallback(
    (key) => translations[language]?.[key] ?? translations.en[key] ?? key,
    [language]
  )

  return (
    <LanguageContext.Provider value={{ language, setLanguage: changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
