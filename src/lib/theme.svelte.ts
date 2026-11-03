export type Mode = 'light' | 'dark'

export const theme = $state({ mode: (document.documentElement.classList.contains('dark') ? 'dark' : 'light') as Mode })

export function toggleTheme() {
  theme.mode = theme.mode === 'dark' ? 'light' : 'dark'
  document.documentElement.classList.toggle('dark', theme.mode === 'dark')
  localStorage.setItem('theme', theme.mode)
}
