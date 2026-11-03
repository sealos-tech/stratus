<script lang="ts">
  import { t } from '$lib/i18n.svelte'
</script>

<footer class="text-subtle mt-16 mb-10 flex flex-col items-center gap-3 text-center text-xs">
  <p class="text-sm">{t('poweredBy')}</p>
  <p class="max-w-[640px] leading-[18px]">{t('footnote')}</p>
</footer>
