<script lang="ts">
  import { i18n, setLang, t } from '$lib/i18n.svelte'
</script>

<footer class="text-subtle mt-16 mb-10 flex flex-col items-center gap-3 text-center text-xs">
  <p class="text-sm">{t('poweredBy')}</p>
  <p class="max-w-[640px] leading-[18px]">{t('footnote')}</p>
  <button type="button" class="hover:text-foreground underline-offset-4 hover:underline sm:hidden" onclick={() => setLang(i18n.lang === 'en' ? 'zh' : 'en')}>
    {t('language')}
  </button>
</footer>
